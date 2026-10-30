import { analyzeComplaint } from './ai/index.js';
import { heuristicBrief } from './ai/heuristic.js';
import { scorePriority, combineWithAi } from './priority.js';
import { detectDuplicates, duplicateCountFor } from './duplicates.js';
import { embed } from './embeddings.js';
import { recomputeHotspots } from './hotspots.js';
import { getAllSettings } from '../db.js';
import { nowIso, parseJson } from '../util.js';
import { CATEGORY_LABELS } from '../config.js';

/**
 * Complaint processing pipeline.
 *
 * The complaint is always persisted BEFORE this runs. A failure here updates the
 * ai_status to 'failed' and leaves the record usable; it never deletes data.
 */

const inFlight = new Set();

export function isProcessing(id) {
  return inFlight.has(id);
}

export async function processComplaint(db, complaintId, { recomputeClusters = true } = {}) {
  if (inFlight.has(complaintId)) return { skipped: true, reason: 'already-processing' };
  inFlight.add(complaintId);
  const settings = getAllSettings(db);
  db.run("UPDATE complaints SET ai_status = 'processing', updated_at = ? WHERE id = ?", nowIso(), complaintId);

  try {
    const complaint = db.get('SELECT * FROM complaints WHERE id = ?', complaintId);
    if (!complaint) throw new Error('Complaint not found');

    complaint.relatedCount = duplicateCountFor(db, complaintId);
    const result = await analyzeComplaint(complaint, settings);

    const autoCategory = complaint.category_source === 'ai';
    const finalCategory = autoCategory ? result.category : complaint.category;
    const categorySource = autoCategory
      ? (result.source === 'ai' ? 'ai' : 'heuristic')
      : (complaint.category_source === 'admin' ? 'admin' : 'citizen');
    const aiCategory = result.predictedCategory || result.category;
    const embedding = embed(complaint.description);
    const summary = result.summary || complaint.description.slice(0, 280);
    const aiStatus = result.fallbackUsed ? 'fallback' : 'done';

    const imageAnalysis = result.imageAnalysis
      || (complaint.image_path
        ? {
          available: false,
          note: 'No image-analysis model is configured. The photo is retained as supporting evidence but was not interpreted by AI.',
        }
        : null);

    db.transaction(() => {
      db.run(
        `UPDATE complaints SET
           description = description,
           category = ?,
           category_source = ?,
           category_confidence = ?,
           ai_summary = ?,
           ai_category = ?,
           ai_category_confidence = ?,
           ai_source = ?,
           ai_status = ?,
           ai_error = ?,
           ai_model = ?,
           embedding = ?,
           image_analysis = ?,
           updated_at = ?
         WHERE id = ?`,
        finalCategory,
        categorySource,
        result.categoryConfidence ?? null,
        summary,
        aiCategory,
        result.categoryConfidence ?? null,
        result.source,
        aiStatus,
        result.error || null,
        result.model || null,
        JSON.stringify(embedding),
        imageAnalysis ? JSON.stringify(imageAnalysis) : null,
        nowIso(),
        complaintId
      );
    });

    // Duplicate detection (advisory only, never auto-merges).
    let detection = { candidates: [], created: 0 };
    let detectionError = null;
    try {
      detection = detectDuplicates(db, complaintId, settings);
    } catch (err) {
      detectionError = err.message;
    }
    const duplicateCount = detection.candidates.length;

    // Explainable priority scoring + optional AI adjustment.
    const rule = scorePriority({
      description: complaint.description,
      category: finalCategory,
      duplicateCount,
      hasImage: Boolean(complaint.image_path),
      imageAnalyzed: Boolean(imageAnalysis?.available && imageAnalysis?.findings),
    });
    const combined = combineWithAi(rule, {
      priority: result.priority,
      priorityReason: result.priorityReason,
      safetyHazards: result.safetyHazards,
      missingInformation: result.missingInformation,
    });

    const briefParts = [
      result.actionBrief?.trim() || '',
    ].filter(Boolean);
    let brief = briefParts.join('\n\n') || heuristicBrief({
      summary,
      category: finalCategory,
      address: complaint.address,
      relatedCount: duplicateCount,
      priority: combined.priority,
      factors: combined.factors.filter((f) => f.points > 0).map((f) => f.reason),
      missing: combined.uncertainty || [],
      hazards: combined.hazards || [],
    });
    if (!/AI-generated|Automated brief/i.test(brief)) {
      brief += '\n— Automated brief. Not a verified diagnosis.';
    }
    if (result.source === 'heuristic') {
      brief += '\nSource: local transparent rules (no language model configured or available).';
    }

    const current = db.get('SELECT priority_overridden_by, final_priority, priority_review_required FROM complaints WHERE id = ?', complaintId);
    const overridden = Boolean(current?.priority_overridden_by);
    const reviewRequired = combined.reviewRequired || Boolean(result.priority === 'critical') || Boolean(current?.priority_review_required);

    db.run(
      `UPDATE complaints SET
         recommended_priority = ?,
         final_priority = ?,
         priority_score = ?,
         priority_explanation = ?,
         priority_factors = ?,
         priority_source = ?,
         priority_review_required = ?,
         action_brief = ?,
         ai_error = COALESCE(ai_error, ?),
         updated_at = ?
       WHERE id = ?`,
      combined.priority,
      overridden ? current.final_priority : combined.priority,
      combined.score,
      combined.explanation,
      JSON.stringify({
        factors: combined.factors,
        uncertainty: combined.uncertainty || [],
        hazards: combined.hazards || [],
        aiPriority: combined.aiPriority || null,
        duplicateCount,
        scoreBeforeFloor: combined.scoreBeforeFloor,
      }),
      combined.source,
      reviewRequired ? 1 : 0,
      brief,
      detectionError ? `Duplicate detection failed: ${detectionError}` : null,
      nowIso(),
      complaintId
    );

    // Admin notification when something needs attention.
    if (reviewRequired) {
      db.run(
        `INSERT INTO notifications (complaint_id, audience, kind, title, body, created_at)
         VALUES (?, 'admin', 'priority_review', ?, ?, ?)`,
        complaintId,
        `Priority review: ${complaint.public_id}`,
        `${CATEGORY_LABELS[finalCategory] || finalCategory} — recommended ${combined.priority.toUpperCase()}. ${combined.reviewRequired ? 'Automated hazard flag requires human verification.' : 'Automated recommendation should be confirmed.'}`,
        nowIso()
      );
    }

    db.run(
      `INSERT INTO audit_logs (actor_id, actor_label, action, entity_type, entity_id, details, ip, created_at)
       VALUES (NULL, 'CivicAI pipeline', 'ai.processed', 'complaint', ?, ?, NULL, ?)`,
      String(complaintId),
      JSON.stringify({
        source: result.source,
        model: result.model,
        fallback: Boolean(result.fallbackUsed),
        error: result.error || null,
        category: finalCategory,
        priority: combined.priority,
        duplicates: duplicateCount,
        aiStatus,
      }),
      nowIso()
    );

    if (recomputeClusters) {
      try {
        recomputeHotspots(db, settings);
      } catch (err) {
        db.run(
          `INSERT INTO audit_logs (actor_id, actor_label, action, entity_type, entity_id, details, ip, created_at)
           VALUES (NULL, 'CivicAI pipeline', 'hotspots.error', 'hotspot', NULL, ?, NULL, ?)`,
          JSON.stringify({ error: err.message }), nowIso()
        );
      }
    }

    return {
      complaintId,
      source: result.source,
      fallback: Boolean(result.fallbackUsed),
      aiStatus,
      category: finalCategory,
      priority: combined.priority,
      priorityReviewRequired: reviewRequired,
      duplicates: detection.candidates,
      aiError: result.error || null,
      warning: result.fallbackReason || null,
    };
  } catch (err) {
    db.run(
      `UPDATE complaints SET ai_status = 'failed', ai_error = ?, updated_at = ? WHERE id = ?`,
      `Processing failed: ${err.message}`.slice(0, 500),
      nowIso(),
      complaintId
    );
    db.run(
      `INSERT INTO audit_logs (actor_id, actor_label, action, entity_type, entity_id, details, ip, created_at)
       VALUES (NULL, 'CivicAI pipeline', 'ai.failed', 'complaint', ?, ?, NULL, ?)`,
      String(complaintId), JSON.stringify({ error: err.message }), nowIso()
    );
    return { complaintId, aiStatus: 'failed', error: err.message };
  } finally {
    inFlight.delete(complaintId);
  }
}

/** Fire-and-forget processing for the submit endpoint. */
export function queueProcessing(db, complaintId) {
  const run = () => {
    processComplaint(db, complaintId).catch((err) => {
      console.error('[civicai] background processing failed', err);
    });
  };
  if (typeof setImmediate === 'function') setImmediate(run);
  else setTimeout(run, 0);
}

export function prioritySnapshot(complaint) {
  return {
    recommended: complaint.recommended_priority,
    final: complaint.final_priority,
    score: complaint.priority_score,
    explanation: complaint.priority_explanation,
    factors: parseJson(complaint.priority_factors, {}),
    source: complaint.priority_source,
    reviewRequired: Boolean(complaint.priority_review_required),
  };
}
