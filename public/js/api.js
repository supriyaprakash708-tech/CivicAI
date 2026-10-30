/**
 * Thin fetch wrapper. All calls are same-origin and include the session cookie.
 * Errors are normalised into ApiError so pages can show field-level messages.
 */

export class ApiError extends Error {
  constructor(message, status = 0, code = null, details = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
  get field() {
    return this.details && typeof this.details === 'object' ? this.details.field || null : null;
  }
}

function buildQuery(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '' || value === 'all') continue;
    search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

async function request(path, { method = 'GET', body, form, headers = {}, signal } = {}) {
  const opts = {
    method,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...headers },
    signal,
  };
  if (form instanceof FormData) {
    opts.body = form;
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(path, opts);
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0, 'NETWORK');
  }

  const contentType = response.headers.get('content-type') || '';
  let payload = null;
  if (contentType.includes('application/json')) {
    payload = await response.json().catch(() => null);
  } else {
    payload = await response.text().catch(() => '');
  }

  if (!response.ok) {
    const message = (payload && typeof payload === 'object' && payload.error)
      ? payload.error
      : `Request failed (${response.status})`;
    throw new ApiError(message, response.status, payload?.code || null, payload?.details || null);
  }
  return payload;
}

const get = (path, params) => request(`${path}${buildQuery(params)}`);
const post = (path, body) => request(path, { method: 'POST', body });
const patch = (path, body) => request(path, { method: 'PATCH', body });

function fileNameFrom(header, fallback) {
  if (!header) return fallback;
  const match = /filename="?([^";]+)"?/i.exec(header);
  return match ? match[1] : fallback;
}

/** Download CSV with the current filters, keeping the session cookie. */
async function downloadCsv(params = {}) {
  let response;
  try {
    response = await fetch(`/api/admin/export.csv${buildQuery(params)}`, {
      credentials: 'same-origin',
      headers: { Accept: 'text/csv' },
    });
  } catch {
    throw new ApiError('Could not reach the server for the export.', 0, 'NETWORK');
  }
  if (!response.ok) {
    let message = 'Export failed.';
    try {
      const data = await response.json();
      message = data?.error || message;
    } catch { /* not JSON */ }
    throw new ApiError(message, response.status);
  }
  const blob = await response.blob();
  const filename = fileNameFrom(response.headers.get('content-disposition'), 'civicai-complaints.csv');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return filename;
}

export const api = {
  /* -------------------------------- public -------------------------------- */
  meta: () => request('/api/meta'),
  publicStats: () => request('/api/public/stats'),
  publicHotspots: () => request('/api/public/hotspots'),
  track: (complaintId, trackingCode) => post('/api/track', { complaintId, trackingCode }),
  submitComplaint: (form, idempotencyKey) => request('/api/complaints', {
    method: 'POST',
    form,
    headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
  }),
  myComplaints: () => request('/api/my/complaints'),
  myComplaint: (publicId) => request(`/api/my/complaints/${encodeURIComponent(publicId)}`),

  /* --------------------------------- auth --------------------------------- */
  me: () => request('/api/auth/me'),
  login: (email, password) => post('/api/auth/login', { email, password }),
  demoOfficer: () => post('/api/auth/demo-officer', {}),
  signup: (name, email, password) => post('/api/auth/signup', { name, email, password }),
  logout: () => post('/api/auth/logout', {}),
  changePassword: (currentPassword, newPassword) => post('/api/auth/password', { currentPassword, newPassword }),
  adminUsers: () => request('/api/auth/users'),

  /* -------------------------------- admin --------------------------------- */
  stats: (params) => get('/api/admin/stats', params),
  complaints: (params) => get('/api/admin/complaints', params),
  complaint: (id) => request(`/api/admin/complaints/${encodeURIComponent(id)}`),
  changeStatus: (id, body) => post(`/api/admin/complaints/${encodeURIComponent(id)}/status`, body),
  assign: (id, body) => post(`/api/admin/complaints/${encodeURIComponent(id)}/assign`, body),
  overridePriority: (id, body) => post(`/api/admin/complaints/${encodeURIComponent(id)}/priority`, body),
  addComment: (id, body) => post(`/api/admin/complaints/${encodeURIComponent(id)}/comment`, body),
  correct: (id, body) => patch(`/api/admin/complaints/${encodeURIComponent(id)}`, body),
  reanalyze: (id) => post(`/api/admin/complaints/${encodeURIComponent(id)}/reanalyze`, {}),
  unmerge: (id, body) => post(`/api/admin/complaints/${encodeURIComponent(id)}/unmerge`, body),

  duplicates: (params) => get('/api/admin/duplicates', params),
  reviewDuplicate: (id, body) => post(`/api/admin/duplicates/${encodeURIComponent(id)}/review`, body),

  hotspots: () => request('/api/admin/hotspots'),
  recomputeHotspots: () => post('/api/admin/hotspots/recompute', {}),

  analytics: (params) => get('/api/admin/analytics', params),
  audit: (params) => get('/api/admin/audit', params),
  notifications: (params) => get('/api/admin/notifications', params),
  settings: () => request('/api/admin/settings'),
  saveSettings: (body) => patch('/api/admin/settings', body),
  exportCsv: downloadCsv,

  /* -------------------------------- helpers ------------------------------- */
  imageUrl(complaint, trackingCode = null) {
    if (!complaint?.imageAvailable) return null;
    if (complaint.imageUrl) return complaint.imageUrl;
    const publicId = complaint.publicId;
    if (!publicId) return null;
    return `/api/complaints/public/${encodeURIComponent(publicId)}/image${trackingCode ? `?code=${encodeURIComponent(trackingCode)}` : ''}`;
  },
};

export { buildQuery, request };
