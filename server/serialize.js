import { CATEGORY_LABELS, STATUS_LABELS } from './config.js';
import { parseJson } from './util.js';

/** Public-facing urgency wording — avoids presenting AI as ground truth. */
export function publicUrgency(priority, reviewRequired) {
  if (!priority) return { key: 'pending', label: 'Being assessed' };
  const map = {
    critical: reviewRequired ? 'Urgent — priority review' : 'Urgent',
    high: 'High attention',
    medium: 'Standard',
    low: 'Routine',
  };
  return { key: priority, label: map[priority] || 'Standard' };
}

export function publicComplaint(row, { includeReporter = false } = {}) {
  const priority = row.final_priority || row.recommended_priority || null;
  return {
    publicId: row.public_id,
    description: row.description,
    category: row.category,
    categoryLabel: CATEGORY_LABELS[row.category] || row.category,
    categorySource: row.category_source,
    address: row.address,
    area: row.area,
    lat: row.lat,
    lng: row.lng,
    imageAvailable: Boolean(row.image_path),
    imageUrl: row.image_path ? `/api/complaints/public/${row.public_id}/image` : null,
    summary: row.ai_summary,
    aiStatus: row.ai_status,
    aiSource: row.ai_source,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status] || row.status,
    urgency: publicUrgency(priority, row.priority_review_required),
    priorityReviewRequired: Boolean(row.priority_review_required),
    assignedTeam: row.assigned_team,
    resolutionDetails: row.resolution_details,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
    mergedInto: row.merged_into_id
      ? { publicId: row.merged_into_public_id || null }
      : null,
    isSynthetic: Boolean(row.is_synthetic),
    ...(includeReporter ? { reporterName: row.reporter_name, reporterContact: row.reporter_contact } : {}),
  };
}

export function publicHistory(rows) {
  return rows
    .map((h) => ({
      from: h.from_status,
      to: h.to_status,
      label: STATUS_LABELS[h.to_status] || h.to_status,
      publicUpdate: h.public_update,
      at: h.created_at,
      actor: h.actor_label,
    }))
    .filter((h) => h.publicUpdate || h.from !== h.to);
}

export function adminComplaint(row, { history = [], duplicates = [], reporter = true } = {}) {
  const priority = row.final_priority || row.recommended_priority || null;
  return {
    id: row.id,
    publicId: row.public_id,
    description: row.description,
    summary: row.ai_summary,
    category: row.category,
    categoryLabel: CATEGORY_LABELS[row.category] || row.category,
    categorySource: row.category_source,
    categoryConfidence: row.category_confidence,
    aiCategory: row.ai_category,
    aiCategoryConfidence: row.ai_category_confidence,
    aiSource: row.ai_source,
    aiStatus: row.ai_status,
    aiError: row.ai_error,
    aiModel: row.ai_model,
    imageAvailable: Boolean(row.image_path),
    imageUrl: row.image_path ? `/api/admin/complaints/${row.id}/image` : null,
    imageAnalysis: parseJson(row.image_analysis, null),
    address: row.address,
    area: row.area,
    lat: row.lat,
    lng: row.lng,
    recommendedPriority: row.recommended_priority,
    finalPriority: row.final_priority,
    priority,
    priorityScore: row.priority_score,
    priorityExplanation: row.priority_explanation,
    priorityFactors: parseJson(row.priority_factors, {}),
    prioritySource: row.priority_source,
    priorityReviewRequired: Boolean(row.priority_review_required),
    priorityOverride: row.priority_overridden_by
      ? { by: row.priority_overridden_by_name || null, reason: row.priority_override_reason, at: row.priority_overridden_at }
      : null,
    actionBrief: row.action_brief,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status] || row.status,
    assignedTeam: row.assigned_team,
    assignedTo: row.assigned_to,
    assignedAt: row.assigned_at,
    resolutionDetails: row.resolution_details,
    resolvedAt: row.resolved_at,
    mergedInto: row.merged_into_id
      ? { id: row.merged_into_id, publicId: row.merged_into_public_id || null }
      : null,
    mergedCount: row.merged_count || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isSynthetic: Boolean(row.is_synthetic),
    ...(reporter ? { reporterName: row.reporter_name, reporterContact: row.reporter_contact, reporterUserId: row.user_id } : {}),
    history: history.map((h) => ({
      id: h.id,
      from: h.from_status,
      to: h.to_status,
      label: STATUS_LABELS[h.to_status] || h.to_status,
      publicUpdate: h.public_update,
      internalNote: h.internal_note,
      actor: h.actor_label,
      at: h.created_at,
    })),
    duplicates,
  };
}

export function adminListRow(row) {
  return {
    id: row.id,
    publicId: row.public_id,
    description: row.description,
    category: row.category,
    categoryLabel: CATEGORY_LABELS[row.category] || row.category,
    address: row.address,
    area: row.area,
    lat: row.lat,
    lng: row.lng,
    priority: row.final_priority || row.recommended_priority || null,
    recommendedPriority: row.recommended_priority,
    finalPriority: row.final_priority,
    priorityReviewRequired: Boolean(row.priority_review_required),
    status: row.status,
    statusLabel: STATUS_LABELS[row.status] || row.status,
    assignedTeam: row.assigned_team,
    assignedTo: row.assigned_to,
    duplicatePending: row.pending_dupes || 0,
    duplicateMaxSimilarity: row.max_similarity ?? null,
    mergedInto: row.merged_into_id,
    mergedCount: row.merged_count || 0,
    aiStatus: row.ai_status,
    aiSource: row.ai_source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isSynthetic: Boolean(row.is_synthetic),
  };
}
