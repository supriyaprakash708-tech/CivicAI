/**
 * Shared UI primitives. Everything rendered through the `html` tag is escaped
 * unless explicitly wrapped in `raw()`. This is the only safe way to inject
 * user-supplied complaint text into the DOM.
 */

/* ------------------------------- escaping -------------------------------- */

const ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
}

class Raw {
  constructor(value) {
    this.value = value == null ? '' : String(value);
  }
  toString() {
    return this.value;
  }
}

export const raw = (value) => new Raw(value);

function renderValue(value) {
  if (value == null || value === false || value === true) return '';
  if (value instanceof Raw) return value.value;
  if (Array.isArray(value)) return value.map(renderValue).join('');
  return escapeHtml(value);
}

/** Tagged template returning a Raw fragment built from escaped values. */
export function html(strings, ...values) {
  let out = '';
  for (let i = 0; i < strings.length; i += 1) {
    out += strings[i];
    if (i < values.length) out += renderValue(values[i]);
  }
  return new Raw(out);
}

/* -------------------------------- icons ---------------------------------- */

const ICONS = new Set([
  'alert', 'pin', 'camera', 'check', 'check-circle', 'clock', 'search', 'menu', 'x',
  'arrow-right', 'arrow-left', 'arrow-up-right', 'clipboard', 'chart', 'layers', 'users',
  'settings', 'download', 'bell', 'log-out', 'shield', 'sparkles', 'file', 'filter',
  'refresh', 'trash', 'copy', 'info', 'chevron-down', 'plus', 'map', 'list', 'home',
  'activity', 'lock', 'eye', 'send', 'calendar', 'filter-x',
]);

export function icon(name, cls = '') {
  const safe = ICONS.has(name) ? name : 'info';
  return raw(`<svg class="icon ${cls}" aria-hidden="true" focusable="false"><use href="#i-${safe}"></use></svg>`);
}

/* ------------------------------ taxonomies -------------------------------- */

export const CATEGORY_META = {
  roads: { label: 'Roads and potholes', short: 'Roads', color: '#b45309', icon: 'layers' },
  waste: { label: 'Waste management', short: 'Waste', color: '#15803d', icon: 'trash' },
  drainage: { label: 'Waterlogging and drainage', short: 'Drainage', color: '#0369a1', icon: 'activity' },
  streetlights: { label: 'Streetlights', short: 'Streetlights', color: '#a16207', icon: 'sparkles' },
  water: { label: 'Water supply', short: 'Water', color: '#0891b2', icon: 'activity' },
  safety: { label: 'Public safety', short: 'Safety', color: '#b91c1c', icon: 'shield' },
  infrastructure: { label: 'Public infrastructure', short: 'Infrastructure', color: '#6d28d9', icon: 'home' },
  other: { label: 'Other civic issues', short: 'Other', color: '#64748b', icon: 'file' },
};

export const PRIORITY_META = {
  critical: { label: 'Critical', color: '#dc2626', rank: 3 },
  high: { label: 'High', color: '#ea580c', rank: 2 },
  medium: { label: 'Medium', color: '#d97706', rank: 1 },
  low: { label: 'Low', color: '#0f766e', rank: 0 },
};

export const STATUS_META = {
  submitted: { label: 'Submitted', color: '#64748b' },
  under_review: { label: 'Under review', color: '#0284c7' },
  assigned: { label: 'Assigned', color: '#4f46e5' },
  in_progress: { label: 'In progress', color: '#d97706' },
  resolved: { label: 'Resolved', color: '#16a34a' },
  rejected: { label: 'Rejected', color: '#94a3b8' },
  awaiting_information: { label: 'Awaiting information', color: '#ca8a04' },
  reopened: { label: 'Reopened', color: '#9333ea' },
};

export const MAIN_FLOW = ['submitted', 'under_review', 'assigned', 'in_progress', 'resolved'];

export function categoryMeta(key) {
  return CATEGORY_META[key] || { ...CATEGORY_META.other, label: key || 'Other' };
}
export function categoryLabel(key, fallback) {
  return CATEGORY_META[key]?.label || fallback || key || 'Other';
}
export function priorityMeta(key) {
  return PRIORITY_META[key] || { label: key || 'Pending', color: '#94a3b8', rank: -1 };
}
export function statusMeta(key) {
  return STATUS_META[key] || { label: key || 'Unknown', color: '#94a3b8' };
}

/* ------------------------------- badges ---------------------------------- */

export function categoryBadge(key, label) {
  const meta = categoryMeta(key);
  return raw(`<span class="badge badge--muted"><i class="cat-dot" style="background:${meta.color}"></i>${escapeHtml(label || meta.label)}</span>`);
}

export function priorityBadge(priority, { review = false, label } = {}) {
  if (!priority) return raw('<span class="badge badge--pending">Being assessed</span>');
  const meta = priorityMeta(priority);
  const text = label || meta.label;
  return raw(`<span class="badge badge--${escapeHtml(priority)}">${escapeHtml(text)}</span>${review ? ` <span class="badge badge--review">${icon('alert')} review</span>` : ''}`);
}

export function statusBadge(status, label) {
  const meta = statusMeta(status);
  return raw(`<span class="badge badge--${escapeHtml(status)}">${escapeHtml(label || meta.label)}</span>`);
}

export function aiBadge(source, status) {
  if (status === 'failed') return raw('<span class="badge badge--review">Analysis failed</span>');
  if (status === 'processing') return raw('<span class="badge badge--ai"><span class="spinner spinner--dark" style="width:10px;height:10px"></span> Analysing</span>');
  if (status === 'pending') return raw('<span class="badge badge--pending">Queued</span>');
  if (source === 'ai') return raw('<span class="badge badge--ai">AI-assisted</span>');
  if (source === 'heuristic') return raw('<span class="badge badge--heuristic">Local rules</span>');
  return raw('<span class="badge badge--muted">Not analysed</span>');
}

export function sourceLabel(source) {
  return ({ ai: 'AI provider', heuristic: 'Local transparent rules', none: 'Not analysed' })[source] || source || 'Not analysed';
}

export function aiStatusLabel(status) {
  return ({
    pending: 'Queued',
    processing: 'Analysing',
    done: 'Completed',
    fallback: 'Completed with local fallback',
    failed: 'Failed — record preserved',
  })[status] || status || 'Unknown';
}

/* ------------------------------ formatting -------------------------------- */

const DATE_FMT = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const DATETIME_FMT = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : DATE_FMT.format(d);
}

export function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : DATETIME_FMT.format(d);
}

export function relativeTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const diff = Date.now() - d.getTime();
  const abs = Math.abs(diff);
  const minute = 60000;
  const hour = 3600000;
  const day = 86400000;
  if (abs < minute) return diff >= 0 ? 'just now' : 'in a moment';
  if (abs < hour) return diff >= 0 ? `${Math.floor(abs / minute)} min ago` : `in ${Math.floor(abs / minute)} min`;
  if (abs < day) return diff >= 0 ? `${Math.floor(abs / hour)} hr ago` : `in ${Math.floor(abs / hour)} hr`;
  if (abs < 7 * day) return diff >= 0 ? `${Math.floor(abs / day)} d ago` : `in ${Math.floor(abs / day)} d`;
  return formatDate(value);
}

export function formatNumber(value) {
  return new Intl.NumberFormat().format(Number(value) || 0);
}

export function formatPercent(value, digits = 0) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return `${Number(value).toFixed(digits)}%`;
}

export function formatDistance(meters) {
  if (meters == null || Number.isNaN(Number(meters))) return 'unknown distance';
  const m = Number(meters);
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

export function formatDays(value) {
  if (value == null) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (n < 1) return `${Math.max(1, Math.round(n * 24))} hr`;
  return `${n.toFixed(n < 10 ? 1 : 0)} days`;
}

export function pluralize(count, singular, plural = `${singular}s`) {
  return `${formatNumber(count)} ${Number(count) === 1 ? singular : plural}`;
}

export function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

/* ------------------------------- fragments -------------------------------- */

export function emptyState({ title, message, iconName = 'layers', action = '' }) {
  return html`
    <div class="empty">
      <div class="empty-icon">${icon(iconName)}</div>
      <h3>${title}</h3>
      <p>${message}</p>
      ${action ? raw(action) : ''}
    </div>
  `;
}

export function statusStepper(history = [], currentStatus) {
  const byStatus = new Map();
  for (const h of history) byStatus.set(h.to, h);
  const currentIndex = MAIN_FLOW.indexOf(currentStatus);
  const special = !MAIN_FLOW.includes(currentStatus) ? currentStatus : null;

  const items = MAIN_FLOW.map((status, index) => {
    const entry = byStatus.get(status);
    const done = entry && (index < currentIndex || currentStatus === 'resolved');
    const current = status === currentStatus;
    return html`
      <li class="${done ? 'is-done' : ''} ${current ? 'is-current' : ''}">
        <span class="dot">${done && !current ? icon('check') : raw(String(index + 1))}</span>
        <span>
          <span class="step-label">${statusMeta(status).label}</span>
          <span class="step-time">${entry ? formatDateTime(entry.at) : current ? 'Current stage' : 'Not reached'}</span>
        </span>
      </li>
    `;
  });

  if (special) {
    items.push(html`
      <li class="is-current">
        <span class="dot">${icon('alert')}</span>
        <span>
          <span class="step-label">${statusMeta(special).label}</span>
          <span class="step-time">${byStatus.get(special) ? formatDateTime(byStatus.get(special).at) : 'Current stage'}</span>
        </span>
      </li>
    `);
  }

  return html`<ol class="stepper">${items}</ol>`;
}

export function timeline(history = [], { includeInternal = false } = {}) {
  if (!history.length) {
    return emptyState({ title: 'No updates yet', message: 'Status changes and public updates will appear here.', iconName: 'clock' });
  }
  const ordered = history.slice().reverse();
  return html`
    <ol class="timeline">
      ${ordered.map((h) => {
        const internalOnly = !h.publicUpdate && h.internalNote;
        return html`
          <li class="timeline-item ${internalOnly ? 'is-internal' : ''}">
            <div class="timeline-head">
              <strong>${h.label || statusMeta(h.to).label}</strong>
              <time datetime="${h.at}">${formatDateTime(h.at)}</time>
              ${h.actor ? html`<span class="text-xs text-muted">${h.actor}</span>` : ''}
            </div>
            ${h.publicUpdate ? html`<div class="timeline-body">${h.publicUpdate}</div>` : ''}
            ${includeInternal && h.internalNote ? html`<div class="timeline-note">Internal: ${h.internalNote}</div>` : ''}
          </li>
        `;
      })}
    </ol>
  `;
}

export function pagination({ page = 1, pages = 1, total = 0, pageSize = 20, hrefFor }) {
  const make = (p, label, cls = '') => {
    if (typeof hrefFor === 'function') {
      return html`<a class="${cls}" href="${hrefFor(p)}">${label}</a>`;
    }
    return html`<button type="button" class="page-btn ${cls}" data-page="${p}">${label}</button>`;
  };
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  const end = Math.min(pages, start + 4);
  const nums = [];
  for (let p = start; p <= end; p += 1) {
    nums.push(p === page
      ? html`<span class="is-current" aria-current="page">${p}</span>`
      : make(p, p));
  }
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return html`
    <div class="pagination">
      <span>Showing <strong>${from}–${to}</strong> of <strong>${formatNumber(total)}</strong></span>
      <div class="page-btns">
        ${make(Math.max(1, page - 1), icon('arrow-left'), `is-disabled-placeholder ${page <= 1 ? 'is-disabled' : ''}`)}
        ${nums}
        ${make(Math.min(pages, page + 1), icon('arrow-right'), page >= pages ? 'is-disabled' : '')}
      </div>
    </div>
  `;
}

export function skeletonCards(n = 4) {
  return html`<div class="stat-grid">${Array.from({ length: n }, () => html`<div class="skeleton skeleton-card"></div>`)}</div>`;
}

export function skeletonRows(n = 5) {
  return html`<div class="loading-block">${Array.from({ length: n }, () => html`<div class="skeleton skeleton-row"></div>`)}</div>`;
}

/* --------------------------------- toast ---------------------------------- */

let toastStack;
export function toast(message, { type = 'success', title = '', duration = 4200 } = {}) {
  if (!toastStack) {
    toastStack = document.createElement('div');
    toastStack.className = 'toast-stack';
    toastStack.setAttribute('role', 'status');
    toastStack.setAttribute('aria-live', 'polite');
    document.body.append(toastStack);
  }
  const iconName = type === 'error' ? 'alert' : type === 'info' ? 'info' : 'check-circle';
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.innerHTML = String(html`
    ${icon(iconName)}
    <div>
      ${title ? html`<strong>${title}</strong>` : ''}
      <span>${message}</span>
    </div>
  `);
  toastStack.append(el);
  const remove = () => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 220);
  };
  if (duration > 0) setTimeout(remove, duration);
  el.addEventListener('click', remove);
  return el;
}

/* --------------------------------- dialog --------------------------------- */

function makeDialog(className = '') {
  const dialog = document.createElement('dialog');
  dialog.className = `modal ${className}`.trim();
  document.body.append(dialog);
  return dialog;
}

function bodyMarkup(body) {
  if (body instanceof Raw) return body.value;
  if (body == null) return '';
  if (typeof body === 'string') return body;
  if (Array.isArray(body)) return body.map(bodyMarkup).join('');
  return String(body);
}

/**
 * Show a modal and resolve with the chosen action's `value`, or null when
 * dismissed. Actions: { label, value, className, autofocus }.
 */
export function showModal({ title, subtitle = '', body = '', actions = [], className = '', dismissible = true }) {
  const dialog = makeDialog(className);
  const actionButtons = actions.map((action, index) => `
    <button type="button" class="btn ${action.className || 'btn-secondary'}" data-modal-action="${escapeHtml(action.value ?? `action-${index}`)}" ${action.autofocus ? 'autofocus' : ''}>
      ${bodyMarkup(action.label)}
    </button>`).join('');
  dialog.innerHTML = String(html`
    <div class="modal-head">
      <div>
        <h3>${title}</h3>
        ${subtitle ? html`<p>${subtitle}</p>` : ''}
      </div>
      <button type="button" class="modal-close" data-modal-close aria-label="Close dialog">${icon('x')}</button>
    </div>
    <div class="modal-body">${raw(bodyMarkup(body))}</div>
    ${actions.length ? html`<div class="modal-foot">${raw(actionButtons)}</div>` : ''}
  `);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      dialog.close();
      resolve(value);
    };
    dialog.querySelector('[data-modal-close]')?.addEventListener('click', () => finish(null));
    dialog.querySelectorAll('[data-modal-action]').forEach((btn) => {
      btn.addEventListener('click', () => finish(btn.dataset.modalAction));
    });
    dialog.addEventListener('cancel', (event) => {
      if (!dismissible) event.preventDefault();
      else finish(null);
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (!settled) {
        settled = true;
        resolve(null);
      }
    });
    dialog.showModal();
  });
}

export function confirmDialog({
  title = 'Are you sure?',
  message = '',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  details = '',
} = {}) {
  return showModal({
    title,
    body: html`<p class="mb-0">${message}</p>${details ? html`<div class="notice notice--warn mt-2">${icon('alert')}<div>${details}</div></div>` : ''}`,
    actions: [
      { label: cancelLabel, value: 'cancel', className: 'btn-secondary' },
      { label: confirmLabel, value: 'confirm', className: danger ? 'btn-danger-solid' : 'btn-primary', autofocus: true },
    ],
  }).then((value) => value === 'confirm');
}

/**
 * Prompt for a required text value. Resolves with the string, or null if the
 * user cancels. Validation happens inline without closing the dialog.
 */
export function promptDialog({
  title,
  message = '',
  label = 'Details',
  placeholder = '',
  confirmLabel = 'Save',
  minLength = 0,
  multiline = true,
  danger = false,
  note = '',
}) {
  const inputId = `prompt-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve) => {
    const dialog = makeDialog();
    dialog.innerHTML = String(html`
      <div class="modal-head">
        <div>
          <h3>${title}</h3>
          ${message ? html`<p>${message}</p>` : ''}
        </div>
        <button type="button" class="modal-close" data-close aria-label="Close dialog">${icon('x')}</button>
      </div>
      <div class="modal-body">
        <div class="field">
          <label class="label" for="${inputId}">${label}${minLength ? html`<span class="optional">${minLength}+ characters</span>` : ''}</label>
          ${multiline
            ? html`<textarea class="textarea" id="${inputId}" rows="4" placeholder="${placeholder}"></textarea>`
            : html`<input class="input" id="${inputId}" placeholder="${placeholder}" />`}
          <div class="field-error" data-error hidden></div>
          ${note ? html`<p class="field-help">${note}</p>` : ''}
        </div>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn btn-secondary" data-cancel>Cancel</button>
        <button type="button" class="btn ${danger ? 'btn-danger-solid' : 'btn-primary'}" data-confirm>${confirmLabel}</button>
      </div>
    `);
    const input = dialog.querySelector('#' + inputId);
    const error = dialog.querySelector('[data-error]');
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      dialog.close();
      resolve(value);
    };
    const submit = () => {
      const value = input.value.trim();
      if (value.length < minLength) {
        error.hidden = false;
        error.textContent = `Please enter at least ${minLength} characters.`;
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return;
      }
      finish(value);
    };
    dialog.querySelector('[data-close]').addEventListener('click', () => finish(null));
    dialog.querySelector('[data-cancel]').addEventListener('click', () => finish(null));
    dialog.querySelector('[data-confirm]').addEventListener('click', submit);
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(null);
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (!settled) {
        settled = true;
        resolve(null);
      }
    });
    dialog.showModal();
    setTimeout(() => input.focus(), 30);
  });
}

export function openImageModal(src, alt = 'Complaint photo', caption = '') {
  const dialog = makeDialog('modal--image');
  dialog.innerHTML = `
    <div class="modal-head" style="background:#fff">
      <div><h3>Attached photo</h3>${caption ? `<p>${escapeHtml(caption)}</p>` : ''}</div>
      <button type="button" class="modal-close" data-close aria-label="Close image">${icon('x')}</button>
    </div>
    <div class="modal-body"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" /></div>`;
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
}

/* ------------------------------- utilities -------------------------------- */

export async function copyText(text, successMessage = 'Copied to clipboard') {
  try {
    await navigator.clipboard.writeText(String(text));
    toast(successMessage);
    return true;
  } catch {
    // Fallback for non-secure contexts.
    const area = document.createElement('textarea');
    area.value = String(text);
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    if (ok) toast(successMessage);
    else toast('Could not copy automatically. Select the text and copy it manually.', { type: 'error' });
    return ok;
  }
}

export function serializeForm(form) {
  const data = {};
  new FormData(form).forEach((value, key) => {
    if (typeof value === 'string') data[key] = value.trim();
  });
  return data;
}

export function setFormAlert(el, message = '') {
  if (!el) return;
  el.hidden = !message;
  const text = el.querySelector('[data-alert-text]');
  if (text) text.textContent = message;
  else el.textContent = message;
}

export function setBusy(button, busy, busyLabel = 'Working…') {
  if (!button) return;
  if (busy) {
    button.dataset.original = button.innerHTML;
    button.disabled = true;
    button.classList.add('is-loading');
    button.innerHTML = `<span class="spinner"></span><span>${escapeHtml(busyLabel)}</span>`;
  } else {
    button.disabled = false;
    button.classList.remove('is-loading');
    if (button.dataset.original) {
      button.innerHTML = button.dataset.original;
      delete button.dataset.original;
    }
  }
}

export function debounce(fn, wait = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function termList(items, cls = 'compare-reasons') {
  if (!items?.length) return '';
  return html`<div class="${cls}">${items.map((t) => html`<span>${t}</span>`)}</div>`;
}

/* --------------------------- tracking storage ----------------------------- */

const TRACK_KEY = 'civicai.trackedReports';

export function trackedReports() {
  try {
    const value = JSON.parse(localStorage.getItem(TRACK_KEY) || '[]');
    return Array.isArray(value) ? value.filter((v) => v && v.complaintId) : [];
  } catch {
    return [];
  }
}

export function rememberTracking(entry) {
  const list = trackedReports().filter((item) => item.complaintId !== entry.complaintId);
  list.unshift({ ...entry, savedAt: new Date().toISOString() });
  try { localStorage.setItem(TRACK_KEY, JSON.stringify(list.slice(0, 25))); } catch { /* storage may be unavailable */ }
}

export function forgetTracking(complaintId) {
  const list = trackedReports().filter((item) => item.complaintId !== complaintId);
  try { localStorage.setItem(TRACK_KEY, JSON.stringify(list)); } catch { /* ignore */ }
  return list;
}

export function findTracked(complaintId) {
  return trackedReports().find((item) => item.complaintId === String(complaintId).toUpperCase()) || null;
}

/* ------------------------------ URL helpers ------------------------------- */

export function queryString(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === 'all') continue;
    search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export function hrefFor(path, params = {}) {
  return `#${path}${queryString(params)}`;
}

export function parseHash() {
  const rawHash = window.location.hash.replace(/^#/, '') || '/';
  const [pathPart, queryPart = ''] = rawHash.split('?');
  const path = pathPart.startsWith('/') ? pathPart : `/${pathPart}`;
  const query = Object.fromEntries(new URLSearchParams(queryPart));
  return { path: path.replace(/\/+$/, '') || '/', query };
}

export function scrollTop() {
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}
