import fs from 'node:fs';
import path from 'node:path';
import { config, CATEGORY_KEYS } from '../../config.js';
import { analyzeRemote } from './remote.js';
import { analyzeHeuristic } from './heuristic.js';

/**
 * AI pipeline entry point.
 *
 * Provider interface:
 *   analyze({ description, categoryHint, address, lat, lng, relatedCount, image, settings })
 *   -> { source, model, category, summary, priority, ... }
 *
 * If AI is unavailable, misconfigured, times out, or returns malformed data,
 * the caller receives a clearly labelled fallback (`source: 'heuristic'`) plus
 * `error`, never a fabricated AI result.
 */

export function resolveImage(complaint) {
  if (!complaint.image_path) return null;
  const file = path.join(config.uploadDir, path.basename(complaint.image_path));
  try {
    if (!fs.existsSync(file)) return null;
    return {
      mime: complaint.image_mime || 'image/jpeg',
      buffer: fs.readFileSync(file),
      filename: complaint.image_path,
    };
  } catch {
    return null;
  }
}

export async function analyzeComplaint(complaint, settings = {}) {
  const image = resolveImage(complaint);
  const categoryHint = complaint.category && complaint.category_source === 'citizen' ? complaint.category : null;
  const base = {
    description: complaint.description,
    categoryHint,
    address: complaint.address,
    lat: complaint.lat,
    lng: complaint.lng,
    relatedCount: complaint.relatedCount || 0,
    image,
    settings,
  };

  let error = null;
  if (config.ai.enabled && config.ai.apiKey && settings.aiEnabled !== false) {
    try {
      const result = await analyzeRemote(base);
      if (!CATEGORY_KEYS.includes(result.category)) throw new Error('Invalid category returned');
      if (image && !result.imageAnalysis) {
        result.imageAnalysis = {
          available: false,
          note: 'An image was attached but no image findings were returned by the provider.',
        };
      }
      return { ...result, error: null, fallbackUsed: false };
    } catch (err) {
      error = err.message;
    }
  }

  const fallback = analyzeHeuristic({
    description: complaint.description,
    categoryHint,
    address: complaint.address,
    relatedCount: complaint.relatedCount || 0,
    imageAvailable: Boolean(image),
  });
  return {
    ...fallback,
    model: 'civicai-local-rules-v1',
    error,
    fallbackUsed: true,
    fallbackReason: config.ai.apiKey
      ? `AI provider unavailable or returned an invalid response${error ? `: ${error}` : ''}. Local rules were used instead.`
      : 'No AI provider is configured (AI_API_KEY is empty). Local transparent rules were used instead.',
  };
}

export { analyzeHeuristic, analyzeRemote };
