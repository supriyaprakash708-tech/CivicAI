import { CATEGORY_LABELS, CATEGORY_KEYS, PRIORITIES } from '../../config.js';
import { extractDuration, extractAffected } from './text.js';

/**
 * Deterministic local analysis engine.
 *
 * This is the documented FALLBACK when no AI provider is configured or the
 * provider fails. Outputs are labelled `heuristic` everywhere in the UI/API so
 * they are never presented as results from a language model.
 */

const RULES = {
  roads: [
    /\bpothole/i, /\broad (hole|damage|crack|collapse)/i, /\bhole in the (road|street)/i,
    /\b(speed breaker|asphalt|tar road|carriageway|footpath|sidewalk|pavement)\b/i,
    /\b(road|street) (is )?(broken|damaged|cratered|caving)/i,
  ],
  waste: [
    /\b(garbage|trash|rubbish|litter|solid waste|dumping|dump yard)\b/i,
    /\b(bin|bins|dustbin|dumpster)\b/i, /\b(waste|refuse) (collection|pickup|not collected)\b/i,
    /\b(overflowing|smell|stench|pests?|mosquito|flies)\b.{0,60}\b(garbage|bin|waste|trash)\b/i,
  ],
  drainage: [
    /\b(drain|drainage|sewer|sewage|gutter|stormwater|storm water)\b/i,
    /\b(waterlog\w*|water log\w*|flood\w*|standing water|stagnant water|water accumulation)\b/i,
    /\b(blocked drain|drain blocked|overflowing drain|sewer overflow)\b/i,
  ],
  streetlights: [
    /\b(street ?lights?|street ?lamps?|lamp posts?|lamps?|light poles?|lighting)\b/i,
    /\b(dark (street|road|area)|no light|unlit|light not working|flickering light|bulb)\b/i,
  ],
  water: [
    /\b(water supply|no water|water cut|water shortage|water interruption)\b/i,
    /\b(pipe|pipeline|water line|tap|tanker|borewell|reservoir)\b.{0,50}\b(burst|leak|broken|dry|contaminat|repair|interrupt)/i,
    /\b(muddy|dirty|contaminated|brown)\b.{0,24}\bwater\b/i,
  ],
  safety: [
    /\b(live|exposed|fallen|dangling) (electric(al)? )?(wire|cable|line)\b/i,
    /\b(open|missing|broken) (manhole|drain cover|sewer cover)\b/i,
    /\b(danger|hazard|unsafe|accident|injur|electrocut|gas leak|fire)\b/i,
    /\b(stray (dog|dogs|animal)|collapse|collapsed building|sinkhole)\b/i,
  ],
  infrastructure: [
    /\b(bench|park|playground|swing|public toilet|bus shelter|community hall)\b/i,
    /\b(wall|building|bridge|public property|signboard|signage|fence)\b.{0,60}\b(broken|damaged|collapse|graffiti|vandal)/i,
    /\b(paint|peeling|minor maintenance)\b/i,
  ],
};

export function heuristicCategory(description) {
  const text = String(description || '');
  const scores = Object.fromEntries(CATEGORY_KEYS.map((k) => [k, 0]));
  for (const [category, rules] of Object.entries(RULES)) {
    for (const re of rules) {
      const matches = text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`));
      if (matches) scores[category] += 1 + Math.min(2, matches.length - 1) * 0.5;
    }
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topKey, topScore] = ranked[0];
  const total = ranked.reduce((sum, [, v]) => sum + v, 0);
  if (topScore === 0) {
    return { category: 'other', confidence: 0.25, scores, method: 'keyword-rules' };
  }
  const confidence = Math.max(0.35, Math.min(0.95, topScore / Math.max(2, total)));
  return { category: topKey, confidence: Number(confidence.toFixed(2)), scores, method: 'keyword-rules' };
}

export function extractiveSummary(description, maxChars = 260) {
  const clean = String(description || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) {
    return clean.replace(/^([a-z])/, (m) => m.toUpperCase()) + (/[.!?]$/.test(clean) ? '' : '.');
  }
  const sentences = clean.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  if (sentences.length === 1) {
    const cut = clean.slice(0, maxChars);
    return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
  }
  const keywords = /(pothole|garbage|drain|flood|water|light|wire|road|school|hospital|days?|weeks?|residents?|apartment|broken|blocked|overflow|leak|danger|hazard|children)/i;
  const scored = sentences.map((s, i) => ({
    s,
    i,
    score: (keywords.test(s) ? 2 : 0) + Math.min(2, s.split(/\s+/).length / 12) + (i === 0 ? 1.5 : 0),
  })).sort((a, b) => b.score - a.score);
  const picked = [];
  let length = 0;
  for (const item of scored) {
    if (length + item.s.length > maxChars - 1 && picked.length) break;
    picked.push(item);
    length += item.s.length + 1;
  }
  picked.sort((a, b) => a.i - b.i);
  let out = picked.map((p) => p.s).join(' ');
  if (out.length > maxChars) out = `${out.slice(0, out.lastIndexOf(' '))}…`;
  else if (!/[.!?…]$/.test(out)) out += '…';
  return out.replace(/^([a-z])/, (m) => m.toUpperCase());
}

const ACTION_STEPS = {
  roads: 'Inspect and cordon the affected section if it is unsafe, then schedule pothole or surface repair.',
  waste: 'Verify the bin/collection point, clear the accumulated waste, and review collection frequency in this area.',
  drainage: 'Inspect and clear the drain/stormwater line, then check for repeated blockages in the immediate area.',
  streetlights: 'Check the pole, bulb and feeder circuit; restore lighting and inspect neighbouring poles.',
  water: 'Check supply pressure and the local pipe network, isolate any leak, and inform affected residents of restoration time.',
  safety: 'Dispatch a qualified safety team for on-site verification. Treat the reported hazard as unconfirmed until inspected.',
  infrastructure: 'Inspect the asset, secure the area if needed, and raise a maintenance work order.',
  other: 'Route to the general operations team for triage and on-site verification.',
};

export function heuristicBrief({ summary, category, address, relatedCount = 0, priority, factors = [], missing = [], hazards = [] }) {
  const lines = [];
  lines.push(`Problem: ${summary}`);
  lines.push(`Location: ${address || 'Location not provided — verify before dispatch.'}`);
  lines.push(`Related reports: ${relatedCount} similar report(s) currently linked or flagged.`);
  lines.push(`Suggested priority: ${priority.toUpperCase()} (automated recommendation, requires human confirmation).`);
  if (factors.length) lines.push(`Supporting evidence: ${factors.slice(0, 4).join('; ')}.`);
  if (hazards.length) lines.push(`Hazard indicators: ${hazards.join('; ')}.`);
  lines.push(`Suggested next step: ${ACTION_STEPS[category] || ACTION_STEPS.other}`);
  const uncertainty = [];
  if (missing.length) uncertainty.push(...missing);
  if (relatedCount > 1) uncertainty.push('Similarity between reports does not prove a shared root cause.');
  if (!address) uncertainty.push('No address was supplied.');
  if (uncertainty.length) lines.push(`Uncertainties: ${uncertainty.join(' ')}`);
  lines.push('— Automated brief generated from submitted data. Not a verified diagnosis.');
  return lines.join('\n');
}

export function analyzeHeuristic({ description, categoryHint, address, relatedCount = 0, imageAvailable = false }) {
  const categoryResult = heuristicCategory(description);
  const category = categoryHint || categoryResult.category;
  const summary = extractiveSummary(description);
  const duration = extractDuration(description);
  const affected = extractAffected(description);
  const hazards = [];
  if (/\b(live|exposed|fallen|dangling)\b.{0,20}\b(wire|cable|line)\b/i.test(description)) hazards.push('Possible exposed or live electrical line');
  if (/\b(open|missing|broken)\s+(manhole|drain cover|sewer cover)\b/i.test(description)) hazards.push('Open or missing manhole cover');
  if (/\b(gas leak|fire|collaps(e|ed|ing)|sinkhole|electrocut)/i.test(description)) hazards.push('Potential immediate public-safety hazard');
  const missing = [];
  if (!address) missing.push('No address or coordinates were supplied.');
  if (!duration) missing.push('Duration of the problem was not stated.');
  if (!affected) missing.push('Number of affected people was not stated.');
  return {
    source: 'heuristic',
    model: 'civicai-local-rules-v1',
    category,
    predictedCategory: categoryResult.category,
    categoryConfidence: categoryHint ? null : categoryResult.confidence,
    summary,
    priority: null,
    priorityReason: null,
    safetyHazards: hazards,
    missingInformation: missing,
    imageAnalysis: imageAvailable
      ? {
        available: false,
        note: 'No image-analysis model is configured. The photo was stored as supporting evidence but was not interpreted by AI.',
      }
      : null,
    actionBrief: heuristicBrief({ summary, category, address, relatedCount, priority: 'pending', missing, hazards }),
  };
}

export { CATEGORY_LABELS, PRIORITIES };
