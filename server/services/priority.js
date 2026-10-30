import { CATEGORY_LABELS, PRIORITIES } from '../config.js';
import { clampNumber } from '../util.js';

/**
 * Transparent, configurable rule-based priority assessment.
 *
 * Design goals:
 *  - never invent safety details: points are only awarded for text that exists;
 *  - every point is attributable to a named factor with evidence;
 *  - imminent-hazard phrases trigger a human-review flag and a critical floor;
 *  - admins can override, with a mandatory reason (handled by the workflow).
 */

const IMMINENT_HAZARDS = [
  { re: /\b(live|exposed|fallen|dangling|loose)\s+(electric(al)?\s+)?(wire|cable|line)\b/i, label: 'Possible live/exposed electrical line' },
  { re: /\b(sparking|electrocut\w*|shock(?:ing)?)\b/i, label: 'Electrical shock or sparking reported' },
  { re: /\b(gas leak|leaking gas|smell of gas)\b/i, label: 'Reported gas leak' },
  { re: /\b(fire|burning|smoke)\b/i, label: 'Fire or smoke reported' },
  { re: /\b(open|missing|broken)\s+(manhole|drain cover|sewer cover)\b/i, label: 'Open or missing manhole cover' },
  { re: /\b(sink ?hole|road (has )?collapsed|bridge (is )?collaps\w*|wall (has )?collapsed|building (is )?collaps\w*)\b/i, label: 'Possible structural collapse' },
  { re: /\b(sewage|raw sewage)\s+(on|in|flowing|overflow\w*)\b/i, label: 'Raw sewage exposure' },
  { re: /\b(sharp|broken glass|exposed rebar|nails?)\b/i, label: 'Sharp or exposed material hazard' },
  { re: /\b(child(ren)?|kids?)\b.{0,60}\b(play|walk|near|school)\b/i, label: 'Hazard near children' },
];

const SAFETY_RISK = [
  { re: /\b(danger(ous)?|hazard(ous)?|unsafe|risk of|accident)\b/i, label: 'Explicit safety risk language' },
  { re: /\b(night|dark|unlit|no light)\b/i, label: 'Risk intensified at night / unlit area' },
  { re: /\b(elderly|disabled|wheelchair|blind)\b/i, label: 'Vulnerable road users mentioned' },
  { re: /\b(injur\w*|hurt|accident)\b/i, label: 'Injury or accident mentioned' },
  { re: /\b(deep|large|huge|massive|severe|major)\b/i, label: 'Severity described as significant' },
];

const IMPACT_TERMS = [
  { re: /\b(main road|highway|junction|bus stand|bus stop|market|station)\b/i, label: 'High-traffic public location', points: 6 },
  { re: /\b(school|college|hospital|clinic|temple|mosque|church)\b/i, label: 'Sensitive public facility nearby', points: 6 },
  { re: /\b(apartment|residents|families|households|neighbou?rs?|colony|street)\b/i, label: 'Residential impact mentioned', points: 4 },
  { re: /\b(entire|whole|many|several|dozens|hundreds)\b/i, label: 'Multiple people or a wide area affected', points: 4 },
  { re: /\b(children|elderly|patients?|disabled)\b/i, label: 'Vulnerable group affected', points: 5 },
];

const HEALTH_RISK = [
  { re: /\b(overflow\w*|garbage|trash|sewage|stagnant|standing water|flood\w*|pests?|mosquito\w*|insects?|smell|stench|contaminat\w*)\b/i, label: 'Public-health or sanitation risk indicators' },
];

const GENERAL_SEVERITY = [
  { re: /\b(blocked|burst|leaking|leak|broken|damaged|collapsed?|cracked|no water|out of order|not working)\b/i, label: 'Infrastructure is reported as non-functional or damaged' },
];

const CATEGORY_BASE = {
  safety: 18,
  water: 10,
  drainage: 10,
  roads: 9,
  streetlights: 8,
  waste: 8,
  infrastructure: 6,
  other: 4,
};

function extractDurationDays(text) {
  const lower = text.toLowerCase()
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/g, (m) => ({
      one: '1', two: '2', three: '3', four: '4', five: '5',
      six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
    }[m]));
  const patterns = [
    { re: /(\d+)\s*(?:days?|d)\b/, mult: 1 },
    { re: /(\d+)\s*(?:weeks?|wks?)\b/, mult: 7 },
    { re: /(\d+)\s*(?:months?|mos?)\b/, mult: 30 },
    { re: /(\d+)\s*(?:hours?|hrs?)\b/, mult: 1 / 24 },
  ];
  let best = 0;
  for (const p of patterns) {
    const m = lower.match(p.re);
    if (m) best = Math.max(best, Number(m[1]) * p.mult);
  }
  if (!best) {
    if (/\b(since (last|yesterday)|yesterday|last night)\b/.test(lower)) best = 1;
    else if (/\b(for (days|weeks)|long time|months)\b/.test(lower)) best = 7;
  }
  return best;
}

export function scorePriority({ description = '', category = 'other', duplicateCount = 0, hasImage = false, imageAnalyzed = false }) {
  const text = String(description);
  const factors = [];
  let score = CATEGORY_BASE[category] ?? 4;
  factors.push({
    key: 'category',
    label: `Category baseline (${CATEGORY_LABELS[category] || category})`,
    points: score,
    reason: 'Some categories carry a higher default public impact.',
  });

  // Duration
  const durationDays = extractDurationDays(text);
  let durationPoints = 0;
  if (durationDays >= 7) durationPoints = 10;
  else if (durationDays >= 3) durationPoints = 7;
  else if (durationDays >= 1) durationPoints = 4;
  else if (durationDays > 0) durationPoints = 2;
  if (durationPoints) {
    score += durationPoints;
    factors.push({
      key: 'duration',
      label: 'Reported duration',
      points: durationPoints,
      reason: `The description references an issue lasting roughly ${durationDays < 1 ? 'under a day' : `${Math.round(durationDays)} day(s)`}.`,
    });
  } else {
    factors.push({
      key: 'duration',
      label: 'Reported duration',
      points: 0,
      reason: 'No duration was stated; this is an uncertainty, not an assumption.',
    });
  }

  // Severity language
  let severityPoints = 0;
  const severityEvidence = [];
  for (const term of SAFETY_RISK) {
    if (term.re.test(text)) {
      severityPoints = Math.max(severityPoints, /deep|large|huge|massive|severe|major/i.test(term.re.source) ? 8 : 5);
      severityEvidence.push(term.label);
    }
  }
  if (severityEvidence.length) {
    score += severityPoints;
    factors.push({
      key: 'severity',
      label: 'Severity language',
      points: severityPoints,
      reason: severityEvidence.join('; '),
    });
  }

  const generalEvidence = [...GENERAL_SEVERITY, ...HEALTH_RISK]
    .filter((t) => t.re.test(text))
    .map((t) => t.label);
  if (generalEvidence.length) {
    const points = Math.min(13, generalEvidence.length * 7);
    score += points;
    factors.push({
      key: 'condition',
      label: 'Reported condition / public-health risk',
      points,
      reason: generalEvidence.join('; '),
    });
  }

  // Imminent hazards
  const hazards = IMMINENT_HAZARDS.filter((h) => h.re.test(text)).map((h) => h.label);
  let hazardPoints = 0;
  if (hazards.length) {
    hazardPoints = 35;
    score += hazardPoints;
    factors.push({
      key: 'safety',
      label: 'Immediate safety hazard indicators',
      points: hazardPoints,
      reason: hazards.join('; '),
    });
  } else {
    const risks = SAFETY_RISK.filter((r) => r.re.test(text)).map((r) => r.label);
    if (risks.length) {
      hazardPoints = 10;
      score += hazardPoints;
      factors.push({
        key: 'safety',
        label: 'Safety-risk language (not an imminent hazard)',
        points: hazardPoints,
        reason: risks.join('; '),
      });
    } else {
      factors.push({
        key: 'safety',
        label: 'Safety indicators',
        points: 0,
        reason: 'No explicit safety hazard was found in the description. Absence of evidence is not proof of safety.',
      });
    }
  }

  // Impact
  let impactPoints = 0;
  const impactEvidence = [];
  for (const term of IMPACT_TERMS) {
    if (term.re.test(text)) {
      impactPoints += term.points;
      impactEvidence.push(term.label);
    }
  }
  impactPoints = Math.min(20, impactPoints);
  if (impactPoints) {
    score += impactPoints;
    factors.push({
      key: 'impact',
      label: 'Potential public impact',
      points: impactPoints,
      reason: impactEvidence.join('; '),
    });
  }

  // Corroboration from suspected/confirmed duplicates
  if (duplicateCount > 0) {
    const dupPoints = Math.min(10, duplicateCount * 4);
    score += dupPoints;
    factors.push({
      key: 'repetition',
      label: 'Repeated reports',
      points: dupPoints,
      reason: `${duplicateCount} similar report(s) were detected nearby. This increases urgency but does not prove a shared cause.`,
    });
  }

  if (hasImage) {
    const imgPoints = imageAnalyzed ? 4 : 2;
    score += imgPoints;
    factors.push({
      key: 'evidence',
      label: 'Photographic evidence attached',
      points: imgPoints,
      reason: imageAnalyzed
        ? 'An image was attached and analysed; visual findings are supporting evidence only.'
        : 'A photo was attached but no image-analysis model was available, so it was not interpreted by AI.',
    });
  }

  score = Math.round(clampNumber(score, 0, 100));
  const originalScore = score;
  if (hazards.length) score = Math.max(score, 75);

  let priority;
  if (score >= 70) priority = 'critical';
  else if (score >= 50) priority = 'high';
  else if (score >= 30) priority = 'medium';
  else priority = 'low';

  const reviewRequired = hazards.length > 0 || priority === 'critical';
  const parts = factors.filter((f) => f.points > 0).map((f) => `${f.label.toLowerCase()} (+${f.points})`);
  let explanation = `Recommended ${priority} priority (rule score ${score}/100).`;
  if (parts.length) explanation += ` Contributing factors: ${parts.join(', ')}.`;
  else explanation += ' No aggravating factors were found in the available description.';
  if (hazards.length) {
    explanation += ' An immediate-hazard phrase was detected, so the score has a critical floor and the report is flagged for prompt human verification.';
  }
  if (duplicateCount > 0) {
    explanation += ' Repeated nearby reports influenced the score; geographic and textual similarity alone do not confirm a common cause.';
  }
  explanation += ' This is an automated recommendation, not a verified classification.';

  const factorOut = factors.map((f) => ({ ...f, points: f.key === 'category' ? f.points : f.points }));
  return {
    priority,
    score,
    scoreBeforeFloor: originalScore,
    factors: factorOut,
    explanation,
    reviewRequired,
    hazards,
    durationDays,
    source: 'rules',
    uncertainty: hazards.length === 0 && duplicateCount === 0
      ? ['Safety and affected population were not confirmed; the assessment is based only on the submitted text.']
      : [],
  };
}

export function hasImminentHazard(description) {
  return IMMINENT_HAZARDS.some((h) => h.re.test(String(description || '')));
}

/** Merge an AI priority suggestion with the transparent rule score (safety-first). */
export function combineWithAi(ruleResult, aiResult) {
  if (!aiResult || !PRIORITIES.includes(aiResult.priority)) return ruleResult;
  const order = { low: 0, medium: 1, high: 2, critical: 3 };
  const aiHigher = order[aiResult.priority] > order[ruleResult.priority];
  const out = { ...ruleResult, source: ruleResult.source === 'rules' ? 'rules+ai' : ruleResult.source };
  if (aiHigher) {
    out.priority = aiResult.priority;
    out.explanation += ` The AI analysis suggested ${aiResult.priority} priority${aiResult.priorityReason ? `: ${aiResult.priorityReason}` : '.'}`;
  }
  if (aiResult.safetyHazards?.length) {
    out.uncertainty = [...(out.uncertainty || []), ...aiResult.safetyHazards.map((h) => `AI noted: ${h}`)];
    if (order[aiResult.priority] >= 2) out.reviewRequired = true;
  }
  if (aiResult.missingInformation?.length) {
    out.uncertainty = [...(out.uncertainty || []), ...aiResult.missingInformation.map((m) => `Missing information: ${m}`)];
  }
  out.aiPriority = aiResult.priority;
  return out;
}
