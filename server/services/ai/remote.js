import { CATEGORIES, CATEGORY_KEYS, PRIORITIES, config } from '../../config.js';

/**
 * Optional OpenAI-compatible AI provider.
 * Never trusted blindly: the response is parsed and schema-validated, and any
 * failure is surfaced to the caller so it can use the labelled fallback.
 */

const SYSTEM_PROMPT = `You are a careful civic-complaint analyst for a municipal authority.
You MUST return a single JSON object and nothing else.

Rules:
- Base every statement ONLY on the complaint text and supplied metadata. Never invent facts, causes, injuries, or hazards.
- The summary must preserve location, duration and reported impact when present, and must not add details.
- Safety hazards may ONLY be listed if explicitly described or directly implied by the text.
- If information is missing (e.g. duration, affected people, exact location), add it to missingInformation.
- Priority guidance: critical = credible immediate danger to life/public safety; high = significant disruption or health risk; medium = service degradation; low = minor maintenance.
- Do not claim certainty. Recommendations are advisory and will be reviewed by a human.
- actionBrief: 3-6 short lines covering problem, location, related reports, suggested next steps and uncertainties.`;

const RESPONSE_SHAPE = `{
  "category": one of ${JSON.stringify(CATEGORY_KEYS)},
  "categoryConfidence": number 0..1,
  "summary": "concise factual summary (max 300 chars)",
  "priority": one of ["critical","high","medium","low"],
  "priorityReason": "one or two sentences tied to the text",
  "safetyHazards": ["only hazards explicitly described"],
  "missingInformation": ["important missing facts"],
  "actionBrief": "short action brief",
  "imageFindings": "only if an image was supplied, otherwise null"
}`;

export async function analyzeRemote({ description, categoryHint, address, lat, lng, relatedCount = 0, image = null, settings = {} }) {
  if (!config.ai.enabled || settings.aiEnabled === false) {
    throw new Error('AI provider is disabled');
  }
  if (!config.ai.apiKey) throw new Error('AI_API_KEY is not configured');

  const userParts = [];
  userParts.push(`Complaint text:\n"""${description}"""`);
  if (categoryHint) userParts.push(`Citizen-selected category: ${categoryHint}`);
  if (address) userParts.push(`Address (self-reported): ${address}`);
  if (lat != null && lng != null) userParts.push(`Coordinates: ${lat}, ${lng}`);
  userParts.push(`Nearby similar reports already detected: ${relatedCount}`);
  userParts.push(`Respond with JSON exactly in this shape:\n${RESPONSE_SHAPE}`);

  const content = [{ type: 'text', text: userParts.join('\n\n') }];
  if (image && config.ai.imageAnalysis) {
    content.push({
      type: 'image_url',
      image_url: { url: `data:${image.mime};base64,${image.buffer.toString('base64')}` },
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.ai.timeoutMs);
  let response;
  try {
    response = await fetch(`${config.ai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.ai.apiKey}`,
      },
      body: JSON.stringify({
        model: config.ai.model,
        temperature: 0.1,
        max_tokens: 700,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content },
        ],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error(err.name === 'AbortError' ? `AI request timed out after ${config.ai.timeoutMs}ms` : `AI request failed: ${err.message}`);
  }
  clearTimeout(timer);

  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.error?.message || '';
    } catch { /* ignore */ }
    throw new Error(`AI provider returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('AI provider returned a non-JSON HTTP response');
  }
  const raw = payload?.choices?.[0]?.message?.content;
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('AI provider returned an empty completion');

  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```\s*$/, ''));
  } catch {
    throw new Error('AI response was not valid JSON');
  }

  // ------------------------- strict validation -------------------------
  const errors = [];
  if (!CATEGORY_KEYS.includes(parsed.category)) errors.push('invalid category');
  if (!PRIORITIES.includes(parsed.priority)) errors.push('invalid priority');
  if (typeof parsed.summary !== 'string' || parsed.summary.trim().length < 8) errors.push('summary missing');
  if (parsed.summary && parsed.summary.length > 600) errors.push('summary too long');
  if (parsed.safetyHazards && !Array.isArray(parsed.safetyHazards)) errors.push('safetyHazards must be an array');
  if (errors.length) throw new Error(`AI response failed validation: ${errors.join(', ')}`);

  const conf = Number(parsed.categoryConfidence);
  return {
    source: 'ai',
    model: config.ai.model,
    category: parsed.category,
    categoryConfidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : null,
    summary: parsed.summary.trim().slice(0, 600),
    priority: parsed.priority,
    priorityReason: typeof parsed.priorityReason === 'string' ? parsed.priorityReason.slice(0, 500) : '',
    safetyHazards: (parsed.safetyHazards || []).filter((s) => typeof s === 'string').slice(0, 6),
    missingInformation: (parsed.missingInformation || []).filter((s) => typeof s === 'string').slice(0, 6),
    imageAnalysis: image
      ? {
        available: config.ai.imageAnalysis,
        note: config.ai.imageAnalysis
          ? 'Vision analysis was requested from the configured provider. Findings are supporting evidence only.'
          : 'An image was attached but vision analysis is disabled (AI_IMAGE_ANALYSIS=false). The photo was not interpreted.',
        findings: typeof parsed.imageFindings === 'string' ? parsed.imageFindings : null,
      }
      : null,
    actionBrief: typeof parsed.actionBrief === 'string' ? parsed.actionBrief.slice(0, 1500) : '',
    categoryLabel: CATEGORIES.find((c) => c.key === parsed.category)?.label,
  };
}
