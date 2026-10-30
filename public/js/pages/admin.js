/**
 * Administrator console pages.
 *
 * Every page is rendered from live API responses. Actions mutate the record and
 * then re-fetch the current route, so the UI never drifts from the server state.
 */
import { api } from '../api.js';
import {
  html, raw, icon, escapeHtml, formatDate, formatDateTime, relativeTime, formatNumber,
  formatPercent, formatDistance, formatDays, categoryMeta, categoryLabel, priorityMeta,
  statusMeta, categoryBadge, statusBadge, priorityBadge, statusStepper, timeline, emptyState,
  toast, setFormAlert, setBusy, confirmDialog, promptDialog, openImageModal, copyText,
  termList, initials, pluralize, aiBadge, aiStatusLabel, sourceLabel, hrefFor, pagination,
} from '../ui.js';
import { lineChart, donutChart, barList } from '../charts.js';
import { createMap } from '../map.js';

const safe = async (promise, fallback = null) => {
  try { return await promise; } catch { return fallback; }
};

const TEAM_BY_CATEGORY = {
  roads: 'Roads & Paving',
  waste: 'Sanitation',
  drainage: 'Drainage & Stormwater',
  streetlights: 'Electrical Services',
  water: 'Water Utilities',
  safety: 'Public Safety',
  infrastructure: 'Parks & Buildings',
  other: 'General Operations',
};

const OPEN_STATUSES = ['submitted', 'under_review', 'assigned', 'in_progress', 'awaiting_information', 'reopened'];

function pageHead({ title, subtitle, actions = null }) {
  return html`
    <div class="page-head">
      <div>
        <h1>${title}</h1>
        ${subtitle ? html`<p>${subtitle}</p>` : ''}
      </div>
      ${actions ? html`<div class="page-actions">${actions}</div>` : ''}
    </div>
  `;
}

function statCard({ label, value, meta = '', iconName = 'clipboard', variant = '', href = null }) {
  const cls = `stat-card${variant ? ` stat-card--${variant}` : ''}`;
  const body = html`
    <div class="stat-top">
      <span class="stat-label">${label}</span>
      <span class="stat-icon">${icon(iconName)}</span>
    </div>
    <div class="stat-value">${value}</div>
    ${meta ? html`<div class="stat-meta">${meta}</div>` : ''}
  `;
  if (href) {
    return html`<a class="${cls}" href="${href}" style="text-decoration:none;color:inherit">${body}</a>`;
  }
  return html`<div class="${cls}">${body}</div>`;
}

function selectField(name, label, options, selected, allLabel = 'All') {
  const current = selected == null ? '' : String(selected);
  return html`
    <div class="field">
      <label class="label" for="filter-${name}">${label}</label>
      <select class="select" id="filter-${name}" name="${name}">
        ${allLabel ? html`<option value="">${allLabel}</option>` : ''}
        ${options.map((option) => html`
          <option value="${option.value}" ${String(option.value) === current ? raw('selected') : ''}>${option.label}</option>
        `)}
      </select>
    </div>
  `;
}

function inputField(name, label, value, { type = 'text', placeholder = '', wide = false, help = '', min = null, max = null, step = null } = {}) {
  return html`
    <div class="field ${wide ? 'field--wide' : ''}">
      <label class="label" for="filter-${name}">${label}</label>
      <input class="input" id="filter-${name}" name="${name}" type="${type}" value="${value ?? ''}"
        placeholder="${placeholder}" ${min != null ? raw(`min="${min}"`) : ''} ${max != null ? raw(`max="${max}"`) : ''}
        ${step != null ? raw(`step="${step}"`) : ''} />
      ${help ? html`<p class="field-help">${help}</p>` : ''}
    </div>
  `;
}

function ageInDays(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Number.isFinite(ms) ? Math.max(0, ms / 86400000) : null;
}

function shortDetails(details) {
  if (details == null) return '—';
  if (typeof details === 'string') return details;
  try {
    const pairs = Object.entries(details)
      .filter(([, value]) => value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && !value.length))
      .slice(0, 5)
      .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
    return pairs.join(' · ') || '—';
  } catch {
    return '—';
  }
}

/* ========================================================================== */
/* Dashboard                                                                  */
/* ========================================================================== */

export async function renderAdminDashboard(ctx) {
  const [stats, hotspotData] = await Promise.all([
    api.stats(),
    safe(api.hotspots(), { hotspots: [] }),
  ]);
  const summary = stats.summary;
  const recent = stats.recent || [];
  const hotspots = hotspotData?.hotspots || [];
  const categories = (stats.byCategory || []).filter((c) => c.count > 0);
  const prioritySegments = ['critical', 'high', 'medium', 'low'].map((key) => ({
    label: priorityMeta(key).label,
    count: stats.byPriority?.[key] || 0,
    color: priorityMeta(key).color,
  }));

  return {
    title: 'Dashboard — CivicAI Admin',
    html: html`
      ${pageHead({
        title: 'Operations dashboard',
        subtitle: 'Live intake, workload and review queues computed from stored complaints. No figures are hardcoded.',
        actions: html`
          <a class="btn btn-secondary" href="#/admin/analytics">${icon('chart')} Analytics</a>
          <a class="btn btn-primary" href="#/admin/complaints">${icon('list')} Open complaint queue</a>
        `,
      })}

      <div class="stat-grid">
        ${statCard({
          label: 'All reports', value: formatNumber(summary.total), iconName: 'clipboard',
          meta: `${formatNumber(summary.open)} open · ${formatNumber(summary.active)} with a team`,
          href: '#/admin/complaints',
        })}
        ${statCard({
          label: 'Critical & high', value: formatNumber(summary.criticalHigh), iconName: 'alert', variant: 'critical',
          meta: `${formatNumber(summary.critical)} critical · ${formatNumber(summary.high)} high`,
          href: '#/admin/complaints?priority=critical',
        })}
        ${statCard({
          label: 'Duplicate review', value: formatNumber(summary.duplicatePending), iconName: 'layers', variant: 'dupe',
          meta: 'Similarity candidates awaiting a human decision',
          href: '#/admin/duplicates',
        })}
        ${statCard({
          label: 'Resolved', value: formatPercent(summary.resolutionRate, 1), iconName: 'check-circle', variant: 'resolved',
          meta: `${formatNumber(summary.resolved)} closed as resolved`,
          href: '#/admin/complaints?status=resolved',
        })}
        ${statCard({
          label: 'Average resolution', value: summary.avgResolutionDays != null ? formatDays(summary.avgResolutionDays) : '—', iconName: 'clock', variant: 'time',
          meta: 'From submission to resolution',
        })}
      </div>

      <div class="admin-grid mt-2">
        <div class="stack">
          <section class="card">
            <div class="card-head">
              <div><h3>Intake over time</h3><p>Daily reports and resolutions across the current filter.</p></div>
              <span class="badge badge--muted">${icon('calendar')} ${formatNumber(stats.filters?.days || 30)} days</span>
            </div>
            <div class="chart-body">${lineChart(stats.timeline || [], { label: 'Complaints reported and resolved' })}</div>
          </section>

          <section class="card">
            <div class="card-head">
              <div><h3>Recent reports</h3><p>The newest intake, ordered by submission time.</p></div>
              <a class="btn btn-sm btn-secondary" href="#/admin/complaints">View all ${icon('arrow-right')}</a>
            </div>
            ${recent.length ? html`
              <div class="table-wrap">
                <table class="data-table">
                  <thead><tr><th>Report</th><th>Priority</th><th>Status</th><th>Team</th><th>Received</th></tr></thead>
                  <tbody>
                    ${recent.map((row) => html`
                      <tr>
                        <td class="cell-main">
                          <a href="#/admin/complaints/${row.id}">${row.public_id}</a>
                          <p>${row.description}</p>
                        </td>
                        <td>${priorityBadge(row.priority, { review: Boolean(row.priority_review_required) })}</td>
                        <td>${statusBadge(row.status)}</td>
                        <td class="nowrap">${row.assigned_team || html`<span class="text-muted">Unassigned</span>`}</td>
                        <td class="nowrap text-xs text-muted">${relativeTime(row.created_at)}</td>
                      </tr>
                    `)}
                  </tbody>
                </table>
              </div>
            ` : html`<div class="card-body">${emptyState({ title: 'No reports yet', message: 'Submitted complaints will appear here as soon as they arrive.', iconName: 'clipboard' })}</div>`}
          </section>
        </div>

        <div class="stack">
          <section class="card">
            <div class="card-head">
              <div><h3>Review needs a human</h3><p>Similar reports are never merged automatically.</p></div>
              <span class="badge badge--dupe">${formatNumber(summary.duplicatePending)} pending</span>
            </div>
            <div class="card-body">
              <div class="notice notice--mint">
                ${icon('shield')}
                <div>Similarity combines text, address, category, distance and time. It is evidence for review, not proof of duplication.</div>
              </div>
              <a class="btn btn-primary btn-block mt-2" href="#/admin/duplicates">
                ${icon('layers')} Open duplicate queue
              </a>
            </div>
          </section>

          <section class="card">
            <div class="card-head">
              <div><h3>Priority mix</h3><p>Current final priorities after any administrator overrides.</p></div>
            </div>
            <div class="card-body">${donutChart(prioritySegments, { centerLabel: 'Reports' })}</div>
          </section>

          <section class="card">
            <div class="card-head">
              <div><h3>Categories</h3><p>Volume by civic category.</p></div>
            </div>
            <div class="card-body">
              ${barList(categories, {
                colorFor: (item) => categoryMeta(item.key).color,
                hrefFor: (item) => hrefFor('/admin/complaints', { category: item.key }),
                emptyMessage: 'No categorised reports yet.',
              })}
            </div>
          </section>

          <section class="card">
            <div class="card-head">
              <div><h3>Hotspots</h3><p>Proximity clusters from stored coordinates.</p></div>
              <a class="btn btn-sm btn-secondary" href="#/admin/map">Map ${icon('arrow-up-right')}</a>
            </div>
            <div class="card-body">
              ${hotspots.length ? hotspots.slice(0, 3).map((spot) => html`
                <div class="hotspot-mini">
                  <div class="hotspot-count">${formatNumber(spot.count)}<small>reports</small></div>
                  <div>
                    <strong>${spot.categories?.length ? spot.categories.map((c) => c.label || c.key).slice(0, 2).join(' · ') : 'Mixed categories'}</strong>
                    <p>${spot.insight}</p>
                  </div>
                </div>
              `) : emptyState({ title: 'No clusters found', message: 'Hotspots appear when several geolocated reports fall within the configured radius.', iconName: 'map' })}
            </div>
          </section>
        </div>
      </div>
    `,
    mount() {},
  };
}

/* ========================================================================== */
/* Complaints list                                                            */
/* ========================================================================== */

export async function renderAdminComplaints(ctx) {
  const query = ctx.query || {};
  const page = Math.max(1, Number(query.page) || 1);
  const params = {
    page,
    pageSize: Math.min(100, Math.max(5, Number(query.pageSize) || 20)),
    sort: query.sort || 'newest',
    status: query.status,
    category: query.category,
    priority: query.priority,
    team: query.team,
    area: query.area,
    q: query.q,
    from: query.from,
    to: query.to,
  };
  const data = await api.complaints(params);
  const filters = data.filters || {};
  const meta = ctx.state.meta || {};
  const categories = meta.categories || Object.keys(categoryMeta).map((key) => ({ key, label: categoryLabel(key) }));
  const teams = meta.teams || [];
  const statuses = meta.statuses || Object.keys(statusMeta).map((key) => ({ key, label: statusMeta(key).label }));
  const areas = data.areas || [];
  const hasFilters = Boolean(filters.status || filters.category || filters.priority || filters.team || filters.area || filters.q || filters.from || filters.to);
  const baseParams = {
    status: filters.status || '', category: filters.category || '', priority: filters.priority || '',
    team: filters.team || '', area: filters.area || '', q: filters.q || '',
    from: filters.from || '', to: filters.to || '', sort: query.sort || 'newest',
  };

  return {
    title: 'Complaints — CivicAI Admin',
    html: html`
      ${pageHead({
        title: 'Complaint queue',
        subtitle: 'Filter, triage and export the live complaint register. Every row opens the full decision record.',
        actions: html`
          <button class="btn btn-secondary" type="button" data-export>${icon('download')} Export CSV</button>
        `,
      })}

      <section class="card">
        <div class="card-body" style="padding-bottom:.85rem">
          <form id="complaintsFilter" class="filters" novalidate>
            ${inputField('q', 'Search', query.q || '', { wide: true, placeholder: 'Complaint ID, description, address or area' })}
            ${selectField('status', 'Status', statuses.map((s) => ({ value: s.key, label: s.label || statusMeta(s.key).label })), filters.status, 'All statuses')}
            ${selectField('category', 'Category', categories.map((c) => ({ value: c.key, label: c.label || categoryLabel(c.key) })), filters.category, 'All categories')}
            ${selectField('priority', 'Priority', ['critical', 'high', 'medium', 'low'].map((p) => ({ value: p, label: priorityMeta(p).label })), filters.priority, 'All priorities')}
            ${teams.length ? selectField('team', 'Team', teams.map((team) => ({ value: team, label: team })), filters.team, 'All teams') : ''}
            ${areas.length ? selectField('area', 'Area', areas.map((area) => ({ value: area, label: area })), filters.area, 'All areas') : ''}
            ${inputField('from', 'From', query.from || '', { type: 'date' })}
            ${inputField('to', 'To', query.to || '', { type: 'date' })}
            <div class="field">
              <label class="label" for="filter-sort">Sort</label>
              <select class="select" id="filter-sort" name="sort">
                ${[
                  ['newest', 'Newest first'], ['oldest', 'Oldest first'], ['priority', 'Priority'],
                  ['updated', 'Recently updated'], ['status', 'Status'], ['category', 'Category'],
                  ['public_id', 'Complaint ID'],
                ].map(([value, label]) => html`
                  <option value="${value}" ${String(query.sort || 'newest') === value ? raw('selected') : ''}>${label}</option>
                `)}
              </select>
            </div>
            <div class="field">
              <span class="label">&nbsp;</span>
              <div class="row" style="gap:.4rem;flex-wrap:nowrap">
                <button class="btn btn-primary" type="submit">${icon('filter')} Apply</button>
                <a class="btn btn-ghost" href="#/admin/complaints">${icon('filter-x')} Reset</a>
              </div>
            </div>
          </form>
          <div class="row mt-2" style="justify-content:space-between">
            <span class="text-xs text-muted">
              ${formatNumber(data.total)} ${Number(data.total) === 1 ? 'report' : 'reports'} match
              ${hasFilters ? 'the current filters' : 'the register'}.
            </span>
            ${hasFilters ? html`
              <div class="filter-chips">
                ${filters.status ? html`<span class="filter-chip">Status: ${statusMeta(filters.status).label}</span>` : ''}
                ${filters.category ? html`<span class="filter-chip">Category: ${categoryLabel(filters.category)}</span>` : ''}
                ${filters.priority ? html`<span class="filter-chip">Priority: ${priorityMeta(filters.priority).label}</span>` : ''}
                ${filters.team ? html`<span class="filter-chip">Team: ${filters.team}</span>` : ''}
                ${filters.area ? html`<span class="filter-chip">Area: ${filters.area}</span>` : ''}
                ${filters.q ? html`<span class="filter-chip">Search: ${filters.q}</span>` : ''}
              </div>
            ` : ''}
          </div>
        </div>
      </section>

      <section class="card mt-2">
        ${data.complaints.length ? html`
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Report</th><th>Category</th><th>Priority</th><th>Status</th>
                  <th>Assignment</th><th>Received</th><th class="num">Open</th>
                </tr>
              </thead>
              <tbody>
                ${data.complaints.map((row) => html`
                  <tr>
                    <td class="cell-main">
                      <a href="#/admin/complaints/${row.id}">${row.publicId}</a>
                      <p>${row.description}</p>
                      <div class="meta-line">
                        ${row.duplicatePending ? html`<span class="badge badge--dupe">${icon('layers')} ${row.duplicatePending} duplicate ${Number(row.duplicatePending) === 1 ? 'candidate' : 'candidates'}</span>` : ''}
                        ${row.mergedInto ? html`<span class="badge badge--muted">Merged into #${row.mergedInto}</span>` : ''}
                        ${row.isSynthetic ? html`<span class="badge badge--muted">Demo record</span>` : ''}
                        <span>${icon('pin')} ${row.address || row.area || 'No address supplied'}</span>
                      </div>
                    </td>
                    <td>${categoryBadge(row.category)}</td>
                    <td>${priorityBadge(row.priority, { review: row.priorityReviewRequired })}</td>
                    <td>${statusBadge(row.status)}</td>
                    <td class="nowrap">
                      ${row.assignedTeam ? html`<strong>${row.assignedTeam}</strong>${row.assignedTo ? html`<div class="text-xs text-muted">${row.assignedTo}</div>` : ''}` : html`<span class="text-muted">Unassigned</span>`}
                    </td>
                    <td class="nowrap text-xs text-muted" title="${formatDateTime(row.createdAt)}">${relativeTime(row.createdAt)}</td>
                    <td class="num"><a class="btn btn-sm btn-secondary" href="#/admin/complaints/${row.id}" aria-label="Open ${row.publicId}">${icon('arrow-right')}</a></td>
                  </tr>
                `)}
              </tbody>
            </table>
          </div>
          <div class="card-body" style="border-top:1px solid var(--line);padding-top:.8rem">
            ${pagination({
              page: data.page, pages: data.pages, total: data.total, pageSize: data.pageSize,
              hrefFor: (p) => hrefFor('/admin/complaints', { ...baseParams, page: p }),
            })}
          </div>
        ` : html`
          <div class="card-body">
            ${emptyState({
              title: 'No complaints match',
              message: hasFilters ? 'Try widening or clearing the filters.' : 'New complaints will appear here as they are submitted.',
              iconName: 'filter',
              action: hasFilters ? '<a class="btn btn-secondary" href="#/admin/complaints">Clear filters</a>' : '',
            })}
          </div>
        `}
      </section>
    `,
    mount(root) {
      const form = root.querySelector('#complaintsFilter');
      form?.addEventListener('submit', (event) => {
        event.preventDefault();
        const values = {};
        new FormData(form).forEach((value, key) => {
          const text = String(value).trim();
          if (text) values[key] = text;
        });
        window.location.hash = hrefFor('/admin/complaints', values);
      });

      const exportButton = root.querySelector('[data-export]');
      exportButton?.addEventListener('click', async () => {
        setBusy(exportButton, true, 'Preparing…');
        try {
          const name = await api.exportCsv(baseParams);
          toast(`Exported ${name}.`, { title: 'CSV ready' });
        } catch (err) {
          toast(err.message || 'The export failed.', { type: 'error' });
        } finally {
          setBusy(exportButton, false);
        }
      });
    },
  };
}

/* ========================================================================== */
/* Complaint detail                                                           */
/* ========================================================================== */

export async function renderAdminComplaint(ctx) {
  const id = Number(ctx.params.id);
  const [data, usersData] = await Promise.all([
    api.complaint(id),
    safe(api.adminUsers(), { users: [] }),
  ]);
  return complaintDetailPage(ctx, data, usersData?.users || []);
}

function complaintDetailPage(ctx, data, users) {
  const c = data.complaint;
  const factors = Array.isArray(c.priorityFactors?.factors) ? c.priorityFactors.factors : [];
  const score = c.priorityScore == null ? null : Number(c.priorityScore);
  const recommendedTeam = c.assignedTeam || TEAM_BY_CATEGORY[c.category] || 'General Operations';
  const hasCoords = c.lat != null && c.lng != null;
  const age = ageInDays(c.createdAt);
  const duplicates = Array.isArray(c.duplicates) ? c.duplicates : [];
  const pendingDuplicates = duplicates.filter((d) => d.status === 'pending');
  const history = Array.isArray(c.history) ? c.history : [];
  const transitions = Array.isArray(data.transitions) ? data.transitions : [];
  const maxFactor = Math.max(35, ...factors.map((f) => Number(f.points) || 0));

  return {
    title: `${c.publicId} — CivicAI Admin`,
    html: html`
      ${pageHead({
        title: c.publicId,
        subtitle: `${c.categoryLabel}${c.area ? ` · ${c.area}` : ''}${c.address ? ` · ${c.address}` : ''}`,
        actions: html`
          <a class="btn btn-secondary" href="#/admin/complaints">${icon('arrow-left')} Back to queue</a>
          <button class="btn btn-secondary" type="button" data-copy-id>${icon('copy')} Copy ID</button>
        `,
      })}

      <section class="card">
        <div class="detail-head">
          <div>
            <div class="id-line">
              ${statusBadge(c.status)}
              ${priorityBadge(c.priority, { review: c.priorityReviewRequired })}
              ${c.mergedInto ? html`<span class="badge badge--dupe">${icon('layers')} Merged into ${c.mergedInto.publicId || `#${c.mergedInto.id}`}</span>` : ''}
              ${c.isSynthetic ? html`<span class="badge badge--muted">Demo record</span>` : ''}
            </div>
            <h1>${c.publicId}</h1>
            <div class="detail-meta">
              <span>${icon('calendar')} Submitted ${formatDateTime(c.createdAt)}</span>
              <span>${icon('clock')} ${age != null ? pluralize(Math.floor(age), 'day') + ' old' : 'Age unknown'}</span>
              <span>${icon('pin')} ${c.address || c.area || 'No location text'}</span>
              <span>${icon('users')} ${c.reporterName || 'Anonymous reporter'}</span>
            </div>
          </div>
          <div class="row" style="justify-content:flex-end">
            ${aiBadge(c.aiSource, c.aiStatus)}
            ${c.priorityOverride ? html`<span class="badge badge--review">${icon('alert')} Priority overridden</span>` : ''}
          </div>
        </div>
        <div class="detail-body">
          ${c.summary ? html`
            <div class="ai-summary">
              <strong>${sourceLabel(c.aiSource)} summary${c.aiStatus === 'fallback' ? ' (local fallback)' : ''}</strong>
              ${c.summary}
            </div>
            <div class="mt-2"></div>
          ` : ''}
          <div class="detail-description">${c.description}</div>

          ${c.actionBrief ? html`
            <div class="mt-2">
              <h3 style="font-size:.9rem;margin-bottom:.4rem">${icon('clipboard')} Suggested action brief</h3>
              <div class="action-brief">${c.actionBrief}</div>
              <p class="field-help mt-1">Generated from the report and local triage rules. Verify on site before acting.</p>
            </div>
          ` : ''}

          <div class="grid grid-2 mt-2" style="gap:1rem">
            <dl class="kv">
              <dt>Category</dt><dd>${categoryBadge(c.category)}${c.categorySource === 'admin' ? html` <span class="badge badge--review">corrected</span>` : ''}</dd>
              <dt>Area</dt><dd>${c.area || '—'}</dd>
              <dt>Coordinates</dt><dd>${hasCoords ? `${Number(c.lat).toFixed(5)}, ${Number(c.lng).toFixed(5)}` : 'Not supplied'}</dd>
              <dt>Assigned team</dt><dd>${c.assignedTeam || 'Unassigned'}</dd>
              <dt>Assignee</dt><dd>${c.assignedTo || '—'}</dd>
            </dl>
            <dl class="kv">
              <dt>Reporter</dt><dd>${c.reporterName || 'Anonymous'}</dd>
              <dt>Contact</dt><dd>${c.reporterContact || 'Not provided'}</dd>
              <dt>AI source</dt><dd>${sourceLabel(c.aiSource)}</dd>
              <dt>Analysis</dt><dd>${aiStatusLabel(c.aiStatus)}</dd>
              <dt>Model</dt><dd>${c.aiModel || 'Local rules'}</dd>
            </dl>
          </div>
          <p class="field-help mt-1">Reporter contact details are visible to signed-in administrators only.</p>
        </div>
      </section>

      <div class="admin-grid mt-2">
        <div class="stack">
          <section class="card">
            <div class="card-head">
              <div><h3>Status workflow</h3><p>Allowed transitions are enforced by the server. Every change is timestamped and audited.</p></div>
              <div class="row">${statusBadge(c.status)}</div>
            </div>
            <div class="card-body">
              ${transitions.length ? html`
                <form id="statusForm" novalidate>
                  <div class="form-grid">
                    <div class="field">
                      <label class="label" for="statusNext">Move to</label>
                      <select class="select" id="statusNext" name="status">
                        ${transitions.map((status) => html`<option value="${status}">${statusMeta(status).label}</option>`)}
                      </select>
                    </div>
                    <div class="field">
                      <label class="label" for="statusPublic">Public update <span class="optional">optional</span></label>
                      <input class="input" id="statusPublic" name="publicUpdate" maxlength="1000" placeholder="Shown to the citizen with the status change" />
                    </div>
                    <div class="field span-2">
                      <label class="label" for="statusInternal">Internal note <span class="optional">optional</span></label>
                      <textarea class="textarea" id="statusInternal" name="internalNote" rows="3" maxlength="2000" placeholder="Staff-only context; visible in the audit trail"></textarea>
                    </div>
                    <div class="field span-2" data-status-extra="rejected" hidden>
                      <label class="label" for="statusReason">Reason for rejection <span class="required">required</span></label>
                      <textarea class="textarea" id="statusReason" name="reason" rows="3" maxlength="1000" placeholder="Explain the decision (at least 8 characters)"></textarea>
                    </div>
                    <div class="field span-2" data-status-extra="resolved" hidden>
                      <label class="label" for="statusResolution">Resolution details <span class="required">required</span></label>
                      <textarea class="textarea" id="statusResolution" name="resolutionDetails" rows="4" maxlength="2000" placeholder="What was done, by whom and when (at least 10 characters)"></textarea>
                    </div>
                  </div>
                  <div class="form-alert mt-2" id="statusAlert" hidden>${icon('alert')}<span data-alert-text></span></div>
                  <div class="row mt-2">
                    <button class="btn btn-primary" type="submit" id="statusSubmit">${icon('check-circle')} Update status</button>
                    <span class="text-xs text-muted">The citizen is notified of the public update.</span>
                  </div>
                </form>
              ` : html`
                <div class="notice notice--warn">
                  ${icon('alert')}
                  <div><strong>No status change is available.</strong> This record is locked in <em>${statusMeta(c.status).label}</em> by the workflow.</div>
                </div>
              `}
            </div>
          </section>

          <section class="card">
            <div class="card-head">
              <div><h3>Duplicate review</h3><p>Similar reports are candidates only. A human must confirm, link or reject each pair.</p></div>
              <span class="badge badge--dupe">${formatNumber(pendingDuplicates.length)} pending</span>
            </div>
            <div class="card-body">
              ${c.mergedInto ? html`
                <div class="notice notice--warn mb-2">
                  ${icon('layers')}
                  <div class="grow">
                    <strong>This report is merged into ${c.mergedInto.publicId || `#${c.mergedInto.id}`}.</strong>
                    The original record is preserved. Updates for the pair are tracked together.
                  </div>
                  <button class="btn btn-sm btn-secondary" type="button" data-unmerge>Unmerge</button>
                </div>
              ` : ''}
              ${duplicates.length ? duplicates.map((dupe) => {
                const otherId = dupe.direction === 'outgoing' ? dupe.relatedId : dupe.primaryId;
                const otherPublicId = dupe.direction === 'outgoing' ? dupe.relatedPublicId : dupe.primaryPublicId;
                return html`
                  <div class="dupe-item">
                    <div class="dupe-head">
                      <div class="row" style="gap:.45rem">
                        <a href="#/admin/complaints/${otherId}" class="mono">${otherPublicId || `#${otherId}`}</a>
                        ${statusBadge(dupe.status)}
                      </div>
                      <span class="similarity">
                        ${Math.round(Number(dupe.similarity || 0) * 100)}% combined
                        <span class="meter"><i style="width:${Math.round(Number(dupe.similarity || 0) * 100)}%"></i></span>
                      </span>
                    </div>
                    <p>${dupe.daysApart != null ? `Reported ${formatNumber(dupe.daysApart)} days apart` : 'Creation dates unavailable'} · ${formatDistance(dupe.distanceM)} apart · text ${Math.round(Number(dupe.textSimilarity || 0) * 100)}%</p>
                    ${termList(dupe.reasons || [])}
                    ${dupe.reviewNote ? html`<p class="mt-1"><strong>Review note:</strong> ${dupe.reviewNote}</p>` : ''}
                    ${dupe.status === 'pending' ? html`
                      <div class="compare-actions">
                        ${!c.mergedInto ? html`
                          <button class="btn btn-sm btn-primary" type="button" data-dupe-action="merge" data-link-id="${dupe.id}" data-primary-id="${c.id}">Merge duplicate into this report</button>
                          <button class="btn btn-sm btn-secondary" type="button" data-dupe-action="merge" data-link-id="${dupe.id}" data-primary-id="${otherId}">Merge this report into duplicate</button>
                        ` : ''}
                        <button class="btn btn-sm btn-secondary" type="button" data-dupe-action="link" data-link-id="${dupe.id}">Link as related</button>
                        <button class="btn btn-sm btn-ghost" type="button" data-dupe-action="reject" data-link-id="${dupe.id}">Not a duplicate</button>
                      </div>
                    ` : html`
                      <p class="mt-1 text-xs text-muted">Reviewed${dupe.reviewedAt ? ` ${relativeTime(dupe.reviewedAt)}` : ''}. The link is retained for the audit trail.</p>
                    `}
                  </div>
                `;
              }) : emptyState({ title: 'No duplicate candidates', message: 'This report has no stored similarity candidates above the current threshold.', iconName: 'layers' })}
              ${data.mergedReports?.length ? html`
                <div class="mt-2">
                  <h4 style="font-size:.82rem;margin-bottom:.4rem">Merged reports</h4>
                  ${data.mergedReports.map((report) => html`
                    <div class="saved-track">
                      <a class="mono grow" href="#/admin/complaints/${report.id}">${report.publicId}</a>
                      ${statusBadge(report.status)}
                      <span class="text-xs text-muted">${formatDate(report.createdAt)}</span>
                    </div>
                  `)}
                </div>
              ` : ''}
            </div>
          </section>

          <section class="card">
            <div class="card-head">
              <div><h3>Workflow history</h3><p>Public updates and internal notes in chronological order.</p></div>
            </div>
            <div class="card-body">
              ${statusStepper(history, c.status)}
              <hr style="border:0;border-top:1px solid var(--line);margin:1.1rem 0" />
              ${timeline(history, { includeInternal: true })}
            </div>
          </section>

          <section class="card">
            <div class="card-head">
              <div><h3>Audit trail</h3><p>Administrative actions recorded for this complaint.</p></div>
              <span class="badge badge--muted">${formatNumber(data.audit?.length || 0)} entries</span>
            </div>
            <div class="card-body">
              ${data.audit?.length ? html`
                <div class="table-wrap">
                  <table class="data-table">
                    <thead><tr><th>When</th><th>Action</th><th>Actor</th><th>Details</th></tr></thead>
                    <tbody>
                      ${data.audit.map((entry) => html`
                        <tr>
                          <td class="nowrap text-xs">${formatDateTime(entry.at)}</td>
                          <td><code>${entry.action}</code></td>
                          <td class="text-xs">${entry.actor || 'System'}</td>
                          <td class="text-xs text-muted">${shortDetails(entry.details)}</td>
                        </tr>
                      `)}
                    </tbody>
                  </table>
                </div>
              ` : html`<p class="text-small text-muted mb-0">No administrative audit entries yet.</p>`}
            </div>
          </section>
        </div>

        <div class="stack">
          <section class="card">
            <div class="card-head">
              <div><h3>Priority assessment</h3><p>Transparent factors, not an oracle.</p></div>
              ${priorityBadge(c.priority, { review: c.priorityReviewRequired })}
            </div>
            <div class="card-body">
              ${score != null ? html`
                <div class="priority-score">
                  <div class="score-dial" style="--score:${Math.max(0, Math.min(100, score))};--score-color:${priorityMeta(c.priority).color}">${Math.round(score)}</div>
                  <div>
                    <strong>${c.priority ? priorityMeta(c.priority).label : 'Pending'} priority</strong>
                    <div class="text-xs text-muted">Recommendation: ${c.recommendedPriority ? priorityMeta(c.recommendedPriority).label : 'not yet assessed'}${c.finalPriority ? ` · Final: ${priorityMeta(c.finalPriority).label}` : ''}</div>
                    <div class="text-xs text-muted">Source: ${c.prioritySource || 'rules'}</div>
                  </div>
                </div>
              ` : html`<div class="notice">${icon('clock')}<div>Analysis has not produced a priority score yet.</div></div>`}

              ${c.priorityExplanation ? html`<p class="text-small text-muted mt-2">${c.priorityExplanation}</p>` : ''}
              ${c.priorityReviewRequired ? html`
                <div class="notice notice--warn mt-2">
                  ${icon('alert')}
                  <div><strong>Human review required.</strong> A hazard indicator or critical recommendation needs verification before work is scheduled.</div>
                </div>
              ` : ''}

              ${factors.length ? html`
                <div class="factor-list mt-2">
                  ${factors.map((factor) => html`
                    <div class="factor">
                      <span class="factor-name">${factor.label || factor.key}</span>
                      <span class="factor-points">+${formatNumber(factor.points)}</span>
                      <span class="factor-track"><i class="factor-fill" style="width:${Math.max(0, Math.min(100, ((Number(factor.points) || 0) / maxFactor) * 100))}%"></i></span>
                      ${factor.reason ? html`<span class="factor-reason">${factor.reason}</span>` : ''}
                    </div>
                  `)}
                </div>
              ` : html`<p class="text-small text-muted mt-2">No factor breakdown is stored for this report.</p>`}

              ${c.priorityFactors?.uncertainty?.length ? html`
                <div class="notice notice--info mt-2">
                  ${icon('info')}
                  <div><strong>Stated uncertainty</strong>${c.priorityFactors.uncertainty.map((item) => html`<div>${item}</div>`)}</div>
                </div>
              ` : ''}
              ${c.priorityFactors?.hazards?.length ? html`
                <div class="notice notice--warn mt-2">
                  ${icon('alert')}
                  <div><strong>Hazard phrases detected</strong>${c.priorityFactors.hazards.map((item) => html`<div>${item}</div>`)}</div>
                </div>
              ` : ''}

              ${c.priorityOverride ? html`
                <div class="override-history">
                  <strong>Administrator override:</strong> ${priorityMeta(c.priority).label}${c.priorityOverride.by ? ` by ${c.priorityOverride.by}` : ''}${c.priorityOverride.at ? ` on ${formatDateTime(c.priorityOverride.at)}` : ''}.
                  <div>Reason: ${c.priorityOverride.reason || 'Not recorded'}</div>
                </div>
              ` : ''}

              <form id="priorityForm" class="mt-2" novalidate>
                <div class="field">
                  <label class="label" for="priorityNext">Override final priority</label>
                  <select class="select" id="priorityNext" name="priority">
                    ${['critical', 'high', 'medium', 'low'].map((priority) => html`
                      <option value="${priority}" ${c.priority === priority ? raw('selected') : ''}>${priorityMeta(priority).label}</option>
                    `)}
                  </select>
                </div>
                <div class="field mt-1">
                  <label class="label" for="priorityReason">Reason <span class="required">required</span></label>
                  <textarea class="textarea" id="priorityReason" name="reason" rows="3" maxlength="1000" placeholder="Explain why the recommendation is being changed (at least 10 characters)"></textarea>
                </div>
                <div class="form-alert mt-1" id="priorityAlert" hidden>${icon('alert')}<span data-alert-text></span></div>
                <button class="btn btn-secondary btn-block mt-1" type="submit" id="prioritySubmit">${icon('shield')} Record override</button>
              </form>
            </div>
          </section>

          <section class="card">
            <div class="card-head">
              <div><h3>Assign work</h3><p>Assignment moves intake into a team's queue.</p></div>
            </div>
            <div class="card-body">
              <dl class="kv mb-2">
                <dt>Team</dt><dd>${c.assignedTeam || 'Unassigned'}</dd>
                <dt>Assignee</dt><dd>${c.assignedTo || '—'}</dd>
                <dt>Assigned</dt><dd>${c.assignedAt ? formatDateTime(c.assignedAt) : 'Not yet assigned'}</dd>
              </dl>
              <form id="assignForm" novalidate>
                <div class="field">
                  <label class="label" for="assignTeam">Team</label>
                  <select class="select" id="assignTeam" name="team">
                    ${(data.teams || []).map((team) => html`
                      <option value="${team}" ${team === recommendedTeam ? raw('selected') : ''}>${team}</option>
                    `)}
                  </select>
                </div>
                <div class="field mt-1">
                  <label class="label" for="assignee">Assignee <span class="optional">optional</span></label>
                  <input class="input" id="assignee" name="assignee" list="adminUsers" value="${c.assignedTo || ''}" placeholder="Named officer or crew" />
                  <datalist id="adminUsers">
                    ${users.map((user) => html`<option value="${user.name}">${user.email}</option>`)}
                  </datalist>
                </div>
                <div class="field mt-1">
                  <label class="label" for="assignNote">Internal note <span class="optional">optional</span></label>
                  <textarea class="textarea" id="assignNote" name="note" rows="2" maxlength="1000" placeholder="Instructions for the team"></textarea>
                </div>
                <div class="form-alert mt-1" id="assignAlert" hidden>${icon('alert')}<span data-alert-text></span></div>
                <button class="btn btn-primary btn-block mt-1" type="submit" id="assignSubmit">${icon('users')} Assign report</button>
              </form>
            </div>
          </section>

          <section class="card">
            <div class="card-head">
              <div><h3>Location &amp; evidence</h3><p>Stored coordinates and the uploaded photo, if any.</p></div>
            </div>
            <div class="card-body">
              ${hasCoords ? html`
                <div class="map-shell"><div id="detailMap"></div></div>
                <p class="field-help mt-1">Schematic map. Marker position is derived from the stored latitude and longitude.</p>
              ` : html`<div class="notice">${icon('pin')}<div>No coordinates were supplied for this report.</div></div>`}
              ${c.imageAvailable ? html`
                <figure class="image-panel mt-2" style="cursor:zoom-in" data-open-image>
                  <img src="${c.imageUrl}" alt="Complaint photo for ${c.publicId}" loading="lazy" />
                  <figcaption>Attached photo · click to enlarge. ${c.imageAnalysis ? 'Image analysis output is shown below.' : 'Image analysis is not enabled; the photo is stored as evidence only.'}</figcaption>
                </figure>
              ` : html`<p class="text-small text-muted mt-2 mb-0">No photo was attached.</p>`}
              ${c.imageAnalysis ? html`
                <details class="mt-2">
                  <summary class="text-small">Image analysis output</summary>
                  <pre class="action-brief mt-1" style="font-size:.72rem">${JSON.stringify(c.imageAnalysis, null, 2)}</pre>
                </details>
              ` : ''}
              ${c.aiError ? html`<div class="notice notice--danger mt-2">${icon('alert')}<div><strong>Analysis error.</strong> ${c.aiError}</div></div>` : ''}
              <button class="btn btn-secondary btn-block mt-2" type="button" data-reanalyze>${icon('refresh')} Re-run analysis</button>
              <p class="field-help mt-1">Re-analysis refreshes category, summary, priority and duplicate candidates. Existing human decisions are retained.</p>
            </div>
          </section>

          <section class="card">
            <div class="card-head">
              <div><h3>Corrections</h3><p>Fix classification or location while preserving the original record in the audit trail.</p></div>
            </div>
            <div class="card-body">
              <form id="correctForm" novalidate>
                <div class="field">
                  <label class="label" for="correctCategory">Category</label>
                  <select class="select" id="correctCategory" name="category">
                    ${(ctx.state.meta?.categories || Object.keys(categoryMeta).map((key) => ({ key, label: categoryLabel(key) }))).map((cat) => html`
                      <option value="${cat.key}" ${cat.key === c.category ? raw('selected') : ''}>${cat.label || categoryLabel(cat.key)}</option>
                    `)}
                  </select>
                </div>
                <div class="field mt-1">
                  <label class="label" for="correctSummary">Summary</label>
                  <textarea class="textarea" id="correctSummary" name="summary" rows="3" maxlength="600">${c.summary || ''}</textarea>
                </div>
                <div class="field mt-1">
                  <label class="label" for="correctAddress">Address</label>
                  <input class="input" id="correctAddress" name="address" maxlength="300" value="${c.address || ''}" />
                </div>
                <div class="field mt-1">
                  <label class="label" for="correctArea">Area</label>
                  <input class="input" id="correctArea" name="area" maxlength="100" value="${c.area || ''}" />
                </div>
                <div class="form-grid mt-1">
                  <div class="field">
                    <label class="label" for="correctLat">Latitude <span class="optional">optional</span></label>
                    <input class="input" id="correctLat" name="lat" type="number" step="0.000001" min="-90" max="90" value="${c.lat ?? ''}" />
                  </div>
                  <div class="field">
                    <label class="label" for="correctLng">Longitude <span class="optional">optional</span></label>
                    <input class="input" id="correctLng" name="lng" type="number" step="0.000001" min="-180" max="180" value="${c.lng ?? ''}" />
                  </div>
                </div>
                <div class="form-alert mt-1" id="correctAlert" hidden>${icon('alert')}<span data-alert-text></span></div>
                <button class="btn btn-secondary btn-block mt-1" type="submit" id="correctSubmit">${icon('check')} Save corrections</button>
              </form>
            </div>
          </section>

          <section class="card">
            <div class="card-head">
              <div><h3>Add an update</h3><p>Public updates notify the citizen; internal notes stay staff-only.</p></div>
            </div>
            <div class="card-body">
              <form id="commentForm" novalidate>
                <div class="field">
                  <label class="label" for="commentPublic">Public update <span class="optional">optional</span></label>
                  <textarea class="textarea" id="commentPublic" name="publicUpdate" rows="3" maxlength="1000" placeholder="What the citizen should know"></textarea>
                </div>
                <div class="field mt-1">
                  <label class="label" for="commentInternal">Internal note <span class="optional">optional</span></label>
                  <textarea class="textarea" id="commentInternal" name="internalNote" rows="3" maxlength="2000" placeholder="Staff-only note"></textarea>
                </div>
                <div class="form-alert mt-1" id="commentAlert" hidden>${icon('alert')}<span data-alert-text></span></div>
                <button class="btn btn-primary btn-block mt-1" type="submit" id="commentSubmit">${icon('send')} Add update</button>
              </form>
            </div>
          </section>
        </div>
      </div>
    `,
    mount(root) {
      const statusForm = root.querySelector('#statusForm');
      if (statusForm) {
        const select = statusForm.querySelector('[name="status"]');
        const alert = root.querySelector('#statusAlert');
        const syncExtras = () => {
          root.querySelectorAll('[data-status-extra]').forEach((el) => {
            el.hidden = el.dataset.statusExtra !== select.value;
          });
        };
        syncExtras();
        select.addEventListener('change', syncExtras);
        statusForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          const status = select.value;
          const reason = statusForm.querySelector('[name="reason"]')?.value.trim() || '';
          const resolutionDetails = statusForm.querySelector('[name="resolutionDetails"]')?.value.trim() || '';
          if (status === 'rejected' && reason.length < 8) {
            setFormAlert(alert, 'Please explain the rejection in at least 8 characters.');
            return;
          }
          if (status === 'resolved' && resolutionDetails.length < 10) {
            setFormAlert(alert, 'Resolution details of at least 10 characters are required.');
            return;
          }
          setFormAlert(alert, '');
          const button = statusForm.querySelector('#statusSubmit');
          setBusy(button, true, 'Updating…');
          try {
            await api.changeStatus(c.id, {
              status,
              publicUpdate: statusForm.querySelector('[name="publicUpdate"]').value.trim() || undefined,
              internalNote: statusForm.querySelector('[name="internalNote"]').value.trim() || undefined,
              reason: reason || undefined,
              resolutionDetails: resolutionDetails || undefined,
            });
            toast('Status updated and the change recorded.', { title: 'Workflow updated' });
            ctx.refresh();
          } catch (err) {
            setBusy(button, false);
            setFormAlert(alert, err.message || 'Could not update the status.');
          }
        });
      }

      root.querySelector('[data-copy-id]')?.addEventListener('click', () => copyText(c.publicId, 'Complaint ID copied'));

      root.querySelector('[data-open-image]')?.addEventListener('click', () => {
        if (c.imageUrl) openImageModal(c.imageUrl, `Complaint photo for ${c.publicId}`, c.publicId);
      });

      root.querySelector('[data-reanalyze]')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        setBusy(button, true, 'Analysing…');
        try {
          const result = await api.reanalyze(c.id);
          toast(`Analysis refreshed using ${sourceLabel(result.result?.source)}.`, { title: 'Analysis complete' });
          if (result.warning) toast(result.warning, { type: 'info', duration: 6500 });
          ctx.refresh();
        } catch (err) {
          setBusy(button, false);
          toast(err.message || 'Analysis could not be completed.', { type: 'error' });
        }
      });

      root.querySelectorAll('[data-dupe-action]').forEach((button) => {
        button.addEventListener('click', async () => {
          const action = button.dataset.dupeAction;
          const linkId = Number(button.dataset.linkId);
          const primaryId = button.dataset.primaryId ? Number(button.dataset.primaryId) : undefined;
          let note = '';
          if (action === 'reject') {
            note = await promptDialog({
              title: 'Not a duplicate',
              message: 'Record why these reports are different. This note becomes part of the review trail.',
              label: 'Review note',
              minLength: 5,
              confirmLabel: 'Reject candidate',
              danger: true,
            });
            if (note == null) return;
          } else if (action === 'link') {
            note = await promptDialog({
              title: 'Link reports as related',
              message: 'Both records stay independent, but the relationship is recorded.',
              label: 'Review note (optional)',
              multiline: true,
              confirmLabel: 'Link reports',
              note: 'Linking does not merge statuses or close either report.',
            });
            if (note == null) return;
          } else {
            const otherId = primaryId === c.id
              ? (c.duplicates.find((d) => d.id === linkId && d.direction === 'outgoing')?.relatedId)
              : c.id;
            const primaryLabel = primaryId === c.id ? c.publicId : `report #${otherId || ''}`;
            const ok = await confirmDialog({
              title: 'Confirm duplicate merge',
              message: `One report will be marked as merged into ${primaryLabel}. The original record is preserved and can be unmerged with a reason.`,
              details: 'Merging changes how the duplicate is tracked, so verify that both reports describe the same physical issue.',
              confirmLabel: 'Merge reports',
              danger: true,
            });
            if (!ok) return;
          }
          setBusy(button, true, 'Saving…');
          try {
            const result = await api.reviewDuplicate(linkId, {
              decision: action,
              primaryId,
              note: note || undefined,
            });
            const labels = { merge: 'Reports merged.', link: 'Reports linked.', reject: 'Candidate rejected.' };
            toast(labels[action] || 'Review recorded.', { title: 'Duplicate review' });
            const targetId = result.detail?.complaint?.id;
            if (targetId && targetId !== c.id) ctx.go(`/admin/complaints/${targetId}`);
            else ctx.refresh();
          } catch (err) {
            setBusy(button, false);
            toast(err.message || 'The review decision could not be saved.', { type: 'error' });
          }
        });
      });

      root.querySelector('[data-unmerge]')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        const note = await promptDialog({
          title: 'Unmerge this report',
          message: 'The report will be tracked independently again. Record why the merge is being undone.',
          label: 'Reason',
          minLength: 5,
          confirmLabel: 'Unmerge',
          danger: true,
        });
        if (note == null) return;
        setBusy(button, true, 'Unmerging…');
        try {
          await api.unmerge(c.id, { note });
          toast('Report unmerged and tracked independently.', { title: 'Duplicate link removed' });
          ctx.refresh();
        } catch (err) {
          setBusy(button, false);
          toast(err.message || 'The report could not be unmerged.', { type: 'error' });
        }
      });

      const priorityForm = root.querySelector('#priorityForm');
      priorityForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const alert = root.querySelector('#priorityAlert');
        const reason = priorityForm.querySelector('[name="reason"]').value.trim();
        if (reason.length < 10) {
          setFormAlert(alert, 'Please explain the override in at least 10 characters.');
          return;
        }
        const button = priorityForm.querySelector('#prioritySubmit');
        setBusy(button, true, 'Saving…');
        try {
          await api.overridePriority(c.id, {
            priority: priorityForm.querySelector('[name="priority"]').value,
            reason,
          });
          toast('Priority override recorded with a reason.', { title: 'Priority updated' });
          ctx.refresh();
        } catch (err) {
          setBusy(button, false);
          setFormAlert(alert, err.message || 'Could not update the priority.');
        }
      });

      const assignForm = root.querySelector('#assignForm');
      assignForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const alert = root.querySelector('#assignAlert');
        const button = assignForm.querySelector('#assignSubmit');
        setBusy(button, true, 'Assigning…');
        try {
          await api.assign(c.id, {
            team: assignForm.querySelector('[name="team"]').value,
            assignee: assignForm.querySelector('[name="assignee"]').value.trim() || undefined,
            note: assignForm.querySelector('[name="note"]').value.trim() || undefined,
          });
          toast('Assignment saved and the citizen notified.', { title: 'Work assigned' });
          ctx.refresh();
        } catch (err) {
          setBusy(button, false);
          setFormAlert(alert, err.message || 'Could not assign the report.');
        }
      });

      const correctForm = root.querySelector('#correctForm');
      correctForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const alert = root.querySelector('#correctAlert');
        const button = correctForm.querySelector('#correctSubmit');
        const lat = correctForm.querySelector('[name="lat"]').value.trim();
        const lng = correctForm.querySelector('[name="lng"]').value.trim();
        if ((lat && !lng) || (!lat && lng)) {
          setFormAlert(alert, 'Latitude and longitude must be provided together.');
          return;
        }
        const body = {
          category: correctForm.querySelector('[name="category"]').value,
          summary: correctForm.querySelector('[name="summary"]').value.trim(),
          address: correctForm.querySelector('[name="address"]').value.trim(),
          area: correctForm.querySelector('[name="area"]').value.trim(),
        };
        if (lat && lng) {
          body.lat = Number(lat);
          body.lng = Number(lng);
        }
        setBusy(button, true, 'Saving…');
        try {
          await api.correct(c.id, body);
          toast('Corrections saved with an audit entry.', { title: 'Record corrected' });
          ctx.refresh();
        } catch (err) {
          setBusy(button, false);
          setFormAlert(alert, err.message || 'Could not save the corrections.');
        }
      });

      const commentForm = root.querySelector('#commentForm');
      commentForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const alert = root.querySelector('#commentAlert');
        const button = commentForm.querySelector('#commentSubmit');
        const publicUpdate = commentForm.querySelector('[name="publicUpdate"]').value.trim();
        const internalNote = commentForm.querySelector('[name="internalNote"]').value.trim();
        if (!publicUpdate && !internalNote) {
          setFormAlert(alert, 'Enter a public update, an internal note, or both.');
          return;
        }
        setBusy(button, true, 'Adding…');
        try {
          await api.addComment(c.id, { publicUpdate: publicUpdate || undefined, internalNote: internalNote || undefined });
          toast(publicUpdate ? 'Update added and the citizen notified.' : 'Internal note added.', { title: 'Update recorded' });
          ctx.refresh();
        } catch (err) {
          setBusy(button, false);
          setFormAlert(alert, err.message || 'Could not add the update.');
        }
      });

      const mapEl = root.querySelector('#detailMap');
      if (mapEl && hasCoords) {
        createMap(mapEl, {
          complaints: [{
            id: c.id, publicId: c.publicId, category: c.category, description: c.description,
            status: c.status, priority: c.priority, lat: c.lat, lng: c.lng, area: c.area, address: c.address,
          }],
          selectedId: c.id,
          showHotspots: false,
          legend: false,
          compact: false,
        });
      }
    },
  };
}

/* ========================================================================== */
/* Duplicate review                                                           */
/* ========================================================================== */

export async function renderAdminDuplicates(ctx) {
  const status = ['pending', 'confirmed', 'linked', 'rejected'].includes(ctx.query.status) ? ctx.query.status : 'pending';
  const page = Math.max(1, Number(ctx.query.page) || 1);
  const data = await api.duplicates({ status, page, pageSize: 20 });
  const links = data.links || [];

  const compareCard = (entry, role) => html`
    <div class="compare-card">
      <div class="row" style="justify-content:space-between">
        <span class="text-xs text-muted">${role}</span>
        ${statusBadge(entry.status)}
      </div>
      <h4><a href="#/admin/complaints/${entry.id}">${entry.publicId}</a></h4>
      <div class="compare-meta">
        ${categoryBadge(entry.category)}
        <span>${icon('calendar')} ${formatDate(entry.createdAt)}</span>
      </div>
      <p>${entry.description}</p>
      <div class="compare-meta">
        <span>${icon('pin')} ${entry.address || 'No address'}</span>
        ${entry.mergedInto ? html`<span class="badge badge--muted">Already merged</span>` : ''}
      </div>
    </div>
  `;

  return {
    title: 'Duplicate review — CivicAI Admin',
    html: html`
      ${pageHead({
        title: 'Duplicate review',
        subtitle: 'Similarity is generated by a transparent combination of text, address, category, distance and time. Nothing is merged automatically.',
        actions: html`<span class="badge badge--dupe">${icon('layers')} ${formatNumber(data.pendingTotal)} pending</span>`,
      })}

      <div class="tabs" role="tablist" aria-label="Duplicate review status">
        ${[
          ['pending', 'Pending'],
          ['confirmed', 'Merged'],
          ['linked', 'Linked'],
          ['rejected', 'Rejected'],
        ].map(([key, label]) => html`
          <a class="tab ${key === status ? 'is-active' : ''}" role="tab" aria-selected="${key === status ? 'true' : 'false'}" href="${hrefFor('/admin/duplicates', { status: key })}">
            ${label}${key === 'pending' ? html` <span class="badge badge--dupe">${formatNumber(data.pendingTotal)}</span>` : ''}
          </a>
        `)}
      </div>

      <div class="notice notice--mint mt-2">
        ${icon('info')}
        <div><strong>Advisory, never automatic.</strong> ${data.thresholdNote || 'A candidate score is evidence for a human decision, not proof of duplication.'}</div>
      </div>

      <div class="stack mt-2">
        ${links.length ? links.map((link) => html`
          <section class="card">
            <div class="card-head">
              <div>
                <h3>Candidate #${link.id} ${statusBadge(link.status)}</h3>
                <p>Created ${formatDateTime(link.createdAt)} · ${link.method || 'combines text, address, distance and time'}</p>
              </div>
              <span class="compare-score" style="margin:0">
                ${icon('activity')} <strong>${Math.round(Number(link.similarity) * 100)}%</strong> combined similarity
              </span>
            </div>
            <div class="card-body">
              <div class="compare-grid">
                ${compareCard(link.primary, 'Primary report')}
                <div class="compare-vs" aria-hidden="true">VS</div>
                ${compareCard(link.related, 'Related report')}
              </div>
              <div class="row mt-2" style="gap:1rem">
                <span class="text-xs text-muted">Text similarity: <strong>${Math.round(Number(link.textSimilarity) * 100)}%</strong></span>
                <span class="text-xs text-muted">Distance: <strong>${formatDistance(link.distanceM)}</strong></span>
                <span class="text-xs text-muted">Reported: <strong>${formatNumber(link.daysApart)} days apart</strong></span>
              </div>
              <div class="mt-1">${termList(link.reasons || [])}</div>
              ${link.reviewNote ? html`<div class="notice notice--info mt-2">${icon('info')}<div><strong>Review note:</strong> ${link.reviewNote}</div></div>` : ''}

              ${link.status === 'pending' ? html`
                <div class="compare-actions">
                  <button class="btn btn-primary" type="button" data-dupe-decision="merge" data-primary-id="${link.related.id}" data-link-id="${link.id}">
                    ${icon('layers')} Merge left into right
                  </button>
                  <button class="btn btn-secondary" type="button" data-dupe-decision="merge" data-primary-id="${link.primary.id}" data-link-id="${link.id}">
                    ${icon('layers')} Merge right into left
                  </button>
                  <button class="btn btn-secondary" type="button" data-dupe-decision="link" data-link-id="${link.id}">${icon('activity')} Link as related</button>
                  <button class="btn btn-ghost" type="button" data-dupe-decision="reject" data-link-id="${link.id}">${icon('x')} Not a duplicate</button>
                </div>
              ` : html`
                <p class="text-xs text-muted mt-2 mb-0">
                  Reviewed${link.reviewedAt ? ` ${formatDateTime(link.reviewedAt)}` : ''}. This decision is retained in the audit trail.
                </p>
              `}
            </div>
          </section>
        `) : html`
          <section class="card">
            <div class="card-body">
              ${emptyState({
                title: status === 'pending' ? 'No pending candidates' : `No ${status} duplicate links`,
                message: status === 'pending'
                  ? 'New candidates are created automatically when reports look similar. Review them here before merging.'
                  : 'Links appear here after a human review decision.',
                iconName: 'layers',
              })}
            </div>
          </section>
        `}
      </div>

      ${data.pages > 1 ? html`
        <div class="card mt-2"><div class="card-body">
          ${pagination({
            page: data.page, pages: data.pages, total: data.total, pageSize: data.pageSize,
            hrefFor: (p) => hrefFor('/admin/duplicates', { status, page: p }),
          })}
        </div></div>
      ` : ''}
    `,
    mount(root) {
      root.querySelectorAll('[data-dupe-decision]').forEach((button) => {
        button.addEventListener('click', async () => {
          const decision = button.dataset.dupeDecision;
          const linkId = Number(button.dataset.linkId);
          const primaryId = button.dataset.primaryId ? Number(button.dataset.primaryId) : undefined;
          let note = '';
          if (decision === 'reject') {
            note = await promptDialog({
              title: 'Reject duplicate candidate',
              message: 'Explain why the reports are not duplicates. The note is preserved in the review history.',
              label: 'Review note',
              minLength: 5,
              confirmLabel: 'Reject candidate',
              danger: true,
            });
            if (note == null) return;
          } else if (decision === 'link') {
            note = await promptDialog({
              title: 'Link reports as related',
              message: 'Keep both records independent while recording the relationship.',
              label: 'Review note (optional)',
              confirmLabel: 'Link reports',
            });
            if (note == null) return;
          } else {
            const ok = await confirmDialog({
              title: 'Merge these reports?',
              message: 'One report is marked as merged into the other. Both records are preserved and the decision can be reversed with a reason.',
              details: 'Confirm that the reports describe the same physical issue at the same location.',
              confirmLabel: 'Merge reports',
              danger: true,
            });
            if (!ok) return;
          }
          setBusy(button, true, 'Saving…');
          try {
            await api.reviewDuplicate(linkId, { decision, primaryId, note: note || undefined });
            toast(
              decision === 'merge' ? 'Reports merged and records linked.' : decision === 'link' ? 'Reports linked as related.' : 'Candidate rejected.',
              { title: 'Review saved' },
            );
            ctx.refresh();
          } catch (err) {
            setBusy(button, false);
            toast(err.message || 'The decision could not be saved.', { type: 'error' });
          }
        });
      });
    },
  };
}

/* ========================================================================== */
/* Map & hotspots                                                             */
/* ========================================================================== */

export async function renderAdminMap(ctx) {
  const query = ctx.query || {};
  const params = {
    pageSize: 100,
    sort: 'newest',
    status: query.status,
    category: query.category,
    priority: query.priority,
    area: query.area,
  };
  const [hotspotData, complaintData] = await Promise.all([
    api.hotspots(),
    api.complaints(params),
  ]);
  const hotspots = hotspotData?.hotspots || [];
  const complaints = complaintData?.complaints || [];
  const meta = ctx.state.meta || {};
  const categories = meta.categories || Object.keys(categoryMeta).map((key) => ({ key, label: categoryLabel(key) }));
  const statuses = meta.statuses || Object.keys(statusMeta).map((key) => ({ key, label: statusMeta(key).label }));
  const parameters = hotspotData?.parameters || {};
  const mapped = complaints.filter((c) => c.lat != null && c.lng != null);

  return {
    title: 'Map & hotspots — CivicAI Admin',
    html: html`
      ${pageHead({
        title: 'Map & hotspots',
        subtitle: 'Complaint locations and DBSCAN proximity clusters. A hotspot is a pattern for inspection, not a confirmed shared cause.',
        actions: html`
          <a class="btn btn-secondary" href="${hrefFor('/admin/complaints', { category: query.category, status: query.status })}">${icon('list')} Open filtered queue</a>
          <button class="btn btn-primary" type="button" data-recompute>${icon('refresh')} Recompute hotspots</button>
        `,
      })}

      <div class="stat-grid">
        ${statCard({ label: 'Mapped reports', value: formatNumber(mapped.length), meta: `Showing up to 100 of ${formatNumber(complaintData.total)} matching reports`, iconName: 'pin', href: hrefFor('/admin/complaints', { category: query.category, status: query.status }) })}
        ${statCard({ label: 'Hotspots', value: formatNumber(hotspots.length), meta: 'Current stored clusters', iconName: 'map' })}
        ${statCard({ label: 'Cluster radius', value: `${formatNumber(parameters.epsMeters)} m`, meta: `Minimum ${formatNumber(parameters.minPoints)} reports`, iconName: 'activity' })}
        ${statCard({ label: 'Geolocated reports', value: formatNumber(parameters.geolocatedComplaints), meta: 'Used by the last calculation', iconName: 'layers' })}
      </div>

      <div class="admin-grid mt-2">
        <section class="card">
          <div class="card-head">
            <div><h3>City map</h3><p>Click a marker for details. Pan, zoom and reset with the map controls.</p></div>
            <span class="badge badge--muted">${formatNumber(mapped.length)} markers</span>
          </div>
          <form id="mapFilter" class="map-filters" novalidate>
            ${selectField('category', 'Category', categories.map((c) => ({ value: c.key, label: c.label || categoryLabel(c.key) })), query.category, 'All categories')}
            ${selectField('status', 'Status', statuses.map((s) => ({ value: s.key, label: s.label || statusMeta(s.key).label })), query.status, 'All statuses')}
            ${selectField('priority', 'Priority', ['critical', 'high', 'medium', 'low'].map((p) => ({ value: p, label: priorityMeta(p).label })), query.priority, 'All priorities')}
            <div class="field" style="flex:0 0 auto">
              <span class="label">&nbsp;</span>
              <button class="btn btn-primary btn-sm" type="submit">${icon('filter')} Apply</button>
            </div>
            <label class="row text-xs text-muted" style="flex:0 0 auto;gap:.4rem">
              <input type="checkbox" data-hotspots-toggle checked /> Show hotspot rings
            </label>
          </form>
          <div class="map-shell" style="border:0;border-radius:0">
            <div id="adminMap"></div>
            ${!mapped.length ? html`<div class="map-empty"><div>${icon('pin')}<p>No geolocated reports match these filters.</p></div></div>` : ''}
          </div>
          <div class="card-foot">${hotspotData.note}</div>
        </section>

        <div class="map-side">
          <section class="card">
            <div class="card-head">
              <div><h3>Detected hotspots</h3><p>Rule-generated insight from stored coordinates.</p></div>
              <span class="badge badge--dupe">${formatNumber(hotspots.length)}</span>
            </div>
            <div class="card-body stack-sm">
              ${hotspots.length ? hotspots.map((spot) => html`
                <article class="hotspot-card">
                  <header>
                    <div>
                      <h4>${formatNumber(spot.count)} reports within ${formatNumber(spot.radiusM)} m</h4>
                      <p class="text-xs text-muted">Computed ${relativeTime(spot.computedAt)}</p>
                    </div>
                    <span class="badge badge--dupe">${icon('map')} cluster</span>
                  </header>
                  <p>${spot.insight}</p>
                  <div class="tag-list">
                    ${(spot.categories || []).map((cat) => html`<span class="chip">${cat.label || cat.key} · ${cat.count}</span>`)}
                  </div>
                  <div class="suggested">
                    <strong>Suggested inspection brief</strong>
                    ${spot.suggestedAction}
                  </div>
                  <div class="row mt-1">
                    ${(spot.publicIds || []).slice(0, 3).map((publicId) => html`
                      <a class="chip mono" href="${hrefFor('/admin/complaints', { q: publicId })}">${publicId}</a>
                    `)}
                    ${(spot.publicIds || []).length > 3 ? html`<span class="text-xs text-muted">+${formatNumber(spot.publicIds.length - 3)} more</span>` : ''}
                  </div>
                </article>
              `) : emptyState({ title: 'No clusters found', message: 'There are not enough nearby reports for the current radius and minimum points.', iconName: 'map' })}
            </div>
          </section>

          <section class="card">
            <div class="card-head"><div><h3>Calculation settings</h3><p>Stored parameters used for the latest run.</p></div></div>
            <div class="card-body">
              <dl class="kv">
                <dt>Radius</dt><dd>${formatNumber(parameters.epsMeters)} m</dd>
                <dt>Minimum points</dt><dd>${formatNumber(parameters.minPoints)}</dd>
                <dt>Geolocated reports</dt><dd>${formatNumber(parameters.geolocatedComplaints)}</dd>
                <dt>Computed</dt><dd>${hotspotData.computedAt ? formatDateTime(hotspotData.computedAt) : 'Never'}</dd>
              </dl>
              <div class="notice mt-2">
                ${icon('info')}
                <div>Adjust hotspot radius and minimum points in <a href="#/admin/settings">settings</a>, then recompute. Clustering excludes rejected and already-merged records.</div>
              </div>
            </div>
          </section>
        </div>
      </div>
    `,
    mount(root) {
      const mapEl = root.querySelector('#adminMap');
      const map = mapEl ? createMap(mapEl, {
        complaints: mapped,
        hotspots,
        showHotspots: true,
        legend: true,
      }) : null;

      root.querySelector('[data-hotspots-toggle]')?.addEventListener('change', (event) => {
        map?.update({ showHotspots: event.target.checked });
      });

      const form = root.querySelector('#mapFilter');
      form?.addEventListener('submit', (event) => {
        event.preventDefault();
        const values = {};
        new FormData(form).forEach((value, key) => {
          const text = String(value).trim();
          if (text) values[key] = text;
        });
        window.location.hash = hrefFor('/admin/map', values);
      });

      root.querySelector('[data-recompute]')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        setBusy(button, true, 'Recomputing…');
        try {
          const result = await api.recomputeHotspots();
          toast(`Recalculated ${formatNumber(result.hotspots?.length || 0)} hotspots from ${formatNumber(result.parameters?.geolocatedComplaints || 0)} geolocated reports.`, { title: 'Hotspots updated' });
          ctx.refresh();
        } catch (err) {
          setBusy(button, false);
          toast(err.message || 'Hotspots could not be recomputed.', { type: 'error' });
        }
      });
    },
  };
}

/* ========================================================================== */
/* Assignments                                                                */
/* ========================================================================== */

export async function renderAdminAssignments(ctx) {
  const statuses = OPEN_STATUSES;
  const [stats, ...results] = await Promise.all([
    safe(api.stats(), null),
    ...statuses.map((status) => safe(api.complaints({ status, pageSize: 100, sort: 'priority' }), { complaints: [], total: 0 })),
  ]);

  const seen = new Set();
  const open = [];
  for (const result of results) {
    for (const row of result?.complaints || []) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      open.push(row);
    }
  }
  const rank = { critical: 0, high: 1, medium: 2, low: 3 };
  open.sort((a, b) => {
    const pr = (rank[a.priority] ?? 4) - (rank[b.priority] ?? 4);
    if (pr !== 0) return pr;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });

  const unassigned = open.filter((row) => !row.assignedTeam);
  const intake = open.filter((row) => ['submitted', 'under_review'].includes(row.status));
  const teams = ctx.state.meta?.teams || [];
  const groups = new Map();
  for (const team of teams) groups.set(team, []);
  groups.set('Unassigned', unassigned);
  for (const row of open) {
    if (!row.assignedTeam) continue;
    if (!groups.has(row.assignedTeam)) groups.set(row.assignedTeam, []);
    groups.get(row.assignedTeam).push(row);
  }
  const teamWorkload = [...groups.entries()]
    .filter(([, rows]) => rows.length)
    .map(([team, rows]) => ({ label: team, key: team, count: rows.length }))
    .sort((a, b) => b.count - a.count);

  const summary = stats?.summary || null;

  return {
    title: 'Assignments — CivicAI Admin',
    html: html`
      ${pageHead({
        title: 'Assignment board',
        subtitle: 'Open work grouped by team, with the highest-priority intake first. Assignment is performed on the complaint record so every step is audited.',
        actions: html`<a class="btn btn-secondary" href="#/admin/complaints?status=submitted">${icon('list')} Full complaint queue</a>`,
      })}

      <div class="stat-grid">
        ${statCard({ label: 'Unassigned', value: formatNumber(unassigned.length), meta: 'Open reports without a team', iconName: 'users', href: '#/admin/complaints?status=submitted' })}
        ${statCard({ label: 'In intake', value: formatNumber(intake.length), meta: 'Submitted or under review', iconName: 'clipboard' })}
        ${statCard({ label: 'Active with teams', value: formatNumber(open.filter((r) => r.assignedTeam).length), meta: 'Assigned, in progress or reopened', iconName: 'activity' })}
        ${statCard({ label: 'High priority open', value: open.filter((r) => ['critical', 'high'].includes(r.priority)).length, meta: 'Critical and high work not yet resolved', iconName: 'alert', variant: 'critical' })}
      </div>

      <div class="admin-grid mt-2">
        <section class="card">
          <div class="card-head">
            <div><h3>Priority intake</h3><p>Submitted and under-review reports, sorted by urgency and age.</p></div>
            <span class="badge badge--muted">${formatNumber(intake.length)}</span>
          </div>
          ${intake.length ? html`
            <div class="table-wrap">
              <table class="data-table">
                <thead><tr><th>Report</th><th>Priority</th><th>Status</th><th>Age</th><th class="num">Action</th></tr></thead>
                <tbody>
                  ${intake.slice(0, 15).map((row) => html`
                    <tr>
                      <td class="cell-main">
                        <a href="#/admin/complaints/${row.id}">${row.publicId}</a>
                        <p>${row.description}</p>
                        <div class="meta-line">${categoryBadge(row.category)}<span>${row.area || row.address || 'No location'}</span></div>
                      </td>
                      <td>${priorityBadge(row.priority, { review: row.priorityReviewEnabled || row.priorityReviewRequired })}</td>
                      <td>${statusBadge(row.status)}</td>
                      <td class="nowrap text-xs text-muted">${relativeTime(row.createdAt)}</td>
                      <td class="num"><a class="btn btn-sm btn-primary" href="#/admin/complaints/${row.id}">Assign</a></td>
                    </tr>
                  `)}
                </tbody>
              </table>
            </div>
            ${intake.length > 15 ? html`<div class="card-foot">Showing the 15 most urgent of ${formatNumber(intake.length)} intake reports. Use the complaint queue for the full list.</div>` : ''}
          ` : html`<div class="card-body">${emptyState({ title: 'Intake is clear', message: 'No submitted or under-review reports are waiting for triage.', iconName: 'check-circle' })}</div>`}
        </section>

        <section class="card">
          <div class="card-head">
            <div><h3>Team workload</h3><p>Open reports currently attached to each team.</p></div>
          </div>
          <div class="card-body">
            ${barList(teamWorkload, {
              colorFor: (item) => (item.key === 'Unassigned' ? '#d97706' : '#14948a'),
              hrefFor: (item) => (item.key === 'Unassigned' ? hrefFor('/admin/complaints', { status: 'submitted' }) : hrefFor('/admin/complaints', { team: item.key })),
              emptyMessage: 'No open work is currently assigned.',
            })}
            ${summary ? html`
              <div class="notice notice--mint mt-2">
                ${icon('activity')}
                <div><strong>${formatNumber(summary.active)}</strong> reports with a team, <strong>${formatNumber(summary.open)}</strong> still in intake, and <strong>${formatNumber(summary.criticalHigh)}</strong> critical or high across all open work.</div>
              </div>
            ` : ''}
          </div>
        </section>
      </div>

      <section class="card mt-2">
        <div class="card-head">
          <div><h3>Team queues</h3><p>The most urgent open reports in each team. Assign or reassign from the complaint record.</p></div>
          <span class="badge badge--muted">${formatNumber(open.length)} open reports</span>
        </div>
        <div class="card-body">
          <div class="grid grid-3">
            ${[...groups.entries()].filter(([, rows]) => rows.length).map(([team, rows]) => html`
              <div class="dupe-item">
                <div class="dupe-head">
                  <strong>${team}</strong>
                  <span class="badge badge--muted">${formatNumber(rows.length)}</span>
                </div>
                <div class="stack-sm mt-1">
                  ${rows.slice(0, 4).map((row) => html`
                    <div class="row" style="justify-content:space-between;gap:.4rem">
                      <a class="mono text-xs" href="#/admin/complaints/${row.id}">${row.publicId}</a>
                      ${priorityBadge(row.priority)}
                      <span class="text-xs text-muted nowrap">${relativeTime(row.createdAt)}</span>
                    </div>
                  `)}
                </div>
                ${rows.length > 4 ? html`<a class="text-xs mt-1" style="display:inline-block" href="${hrefFor('/admin/complaints', { team })}">View ${formatNumber(rows.length - 4)} more ${icon('arrow-right', 'icon-sm')}</a>` : ''}
              </div>
            `)}
          </div>
        </div>
        <div class="card-foot">The board loads up to 100 reports per open status. For larger queues, use the filtered complaint register.</div>
      </section>
    `,
    mount() {},
  };
}

/* ========================================================================== */
/* Analytics                                                                  */
/* ========================================================================== */

export async function renderAdminAnalytics(ctx) {
  const days = Math.max(1, Math.min(365, Number(ctx.query.days) || 30));
  const category = ctx.query.category || '';
  const data = await api.analytics({ days, category: category || undefined });
  const stats = data.stats;
  const report = data.report;
  const summary = stats.summary;
  const meta = ctx.state.meta || {};
  const categories = meta.categories || Object.keys(categoryMeta).map((key) => ({ key, label: categoryLabel(key) }));
  const prioritySegments = ['critical', 'high', 'medium', 'low'].map((key) => ({
    label: priorityMeta(key).label,
    count: stats.byPriority?.[key] || 0,
    color: priorityMeta(key).color,
  }));
  const byCategory = (stats.byCategory || []).filter((item) => item.count > 0);

  return {
    title: 'Analytics — CivicAI Admin',
    html: html`
      ${pageHead({
        title: 'Analytics & briefings',
        subtitle: 'Operational patterns computed from stored records at request time. Automated insights are labelled and never presented as verified causes.',
        actions: html`<a class="btn btn-secondary" href="#/admin/complaints">${icon('list')} Complaint register</a>`,
      })}

      <section class="card">
        <div class="card-body">
          <form id="analyticsFilter" class="filters" novalidate>
            <div class="field">
              <label class="label" for="filter-days">Time window</label>
              <select class="select" id="filter-days" name="days">
                ${[7, 30, 90, 180, 365].map((value) => html`
                  <option value="${value}" ${Number(days) === value ? raw('selected') : ''}>Last ${value} days</option>
                `)}
              </select>
            </div>
            ${selectField('category', 'Category', categories.map((c) => ({ value: c.key, label: c.label || categoryLabel(c.key) })), category, 'All categories')}
            <div class="field">
              <span class="label">&nbsp;</span>
              <button class="btn btn-primary" type="submit">${icon('refresh')} Refresh analysis</button>
            </div>
            <div class="field grow">
              <span class="label">&nbsp;</span>
              <span class="text-xs text-muted">Generated ${formatDateTime(data.generatedAt)}</span>
            </div>
          </form>
        </div>
      </section>

      <div class="stat-grid mt-2">
        ${statCard({ label: 'Reports in window', value: formatNumber(summary.total), meta: `${formatNumber(summary.open)} still open`, iconName: 'clipboard' })}
        ${statCard({ label: 'Resolution rate', value: formatPercent(report.resolutionRate, 1), meta: `${formatNumber(summary.resolved)} resolved`, iconName: 'check-circle', variant: 'resolved' })}
        ${statCard({ label: 'Average resolution', value: report.avgResolutionDays != null ? formatDays(report.avgResolutionDays) : '—', meta: 'Submission to resolution', iconName: 'clock', variant: 'time' })}
        ${statCard({ label: 'Critical & high open', value: formatNumber(report.highPriorityOpen), meta: 'Global open work, not limited to the time filter', iconName: 'alert', variant: 'critical' })}
      </div>

      <div class="admin-grid mt-2">
        <div class="stack">
          <section class="card chart-card">
            <div class="card-head">
              <div><h3>Intake and resolution trend</h3><p>Daily reports and resolutions for the selected window.</p></div>
            </div>
            <div class="chart-body">${lineChart(stats.timeline || [], { label: 'Complaints reported and resolved' })}</div>
          </section>

          <section class="card">
            <div class="card-head">
              <div><h3>Category breakdown</h3><p>Volume and share by civic category.</p></div>
            </div>
            <div class="card-body">
              ${barList(byCategory, {
                colorFor: (item) => categoryMeta(item.key).color,
                hrefFor: (item) => hrefFor('/admin/complaints', { category: item.key }),
                emptyMessage: 'No reports in this window.',
              })}
            </div>
          </section>

          <section class="card">
            <div class="card-head">
              <div><h3>Oldest unresolved work</h3><p>Open reports with the longest elapsed time.</p></div>
            </div>
            ${report.unresolvedOldest?.length ? html`
              <div class="table-wrap">
                <table class="data-table">
                  <thead><tr><th>Report</th><th>Priority</th><th>Status</th><th>Team</th><th class="num">Age</th></tr></thead>
                  <tbody>
                    ${report.unresolvedOldest.map((row) => html`
                      <tr>
                        <td class="cell-main"><a href="#/admin/complaints/${row.id}">${row.public_id}</a><p>${categoryLabel(row.category)}</p></td>
                        <td>${priorityBadge(row.priority)}</td>
                        <td>${statusBadge(row.status)}</td>
                        <td class="nowrap">${row.assigned_team || html`<span class="text-muted">Unassigned</span>`}</td>
                        <td class="num nowrap">${formatDays(row.age_days)}</td>
                      </tr>
                    `)}
                  </tbody>
                </table>
              </div>
            ` : html`<div class="card-body"><p class="text-small text-muted mb-0">No unresolved reports.</p></div>`}
          </section>
        </div>

        <div class="stack">
          <section class="card">
            <div class="card-head"><div><h3>Priority distribution</h3><p>Final priorities after overrides.</p></div></div>
            <div class="card-body">${donutChart(prioritySegments, { centerLabel: 'Reports' })}</div>
          </section>

          <section class="card">
            <div class="card-head"><div><h3>Area concentration</h3><p>Areas with the most reports.</p></div></div>
            <div class="card-body">
              ${barList(stats.byArea || [], {
                hrefFor: (item) => hrefFor('/admin/complaints', { area: item.area }),
                emptyMessage: 'No area information stored.',
              })}
            </div>
          </section>

          <section class="card">
            <div class="card-head"><div><h3>Automated briefing</h3><p>Rule-generated summaries. Verify before acting.</p></div></div>
            <div class="card-body stack-sm">
              <dl class="kv">
                <dt>Most common category</dt>
                <dd>${report.mostCommonCategory ? `${report.mostCommonCategory.label} (${formatNumber(report.mostCommonCategory.count)})` : '—'}</dd>
                <dt>All unresolved</dt><dd>${formatNumber(report.unresolvedTotal)}</dd>
                <dt>Critical & high open</dt><dd>${formatNumber(report.highPriorityOpen)}</dd>
                <dt>Hotspots</dt><dd>${formatNumber(report.hotspots?.length || 0)}</dd>
              </dl>
              ${report.duplicateLinkedCategories?.length ? html`
                <div class="notice notice--info">
                  ${icon('layers')}
                  <div>
                    <strong>Categories with duplicate links</strong>
                    ${report.duplicateLinkedCategories.map((row) => html`<div>${categoryLabel(row.category)}: ${formatNumber(row.n)} linked ${Number(row.n) === 1 ? 'pair' : 'pairs'}</div>`)}
                  </div>
                </div>
              ` : ''}
              ${report.hotspots?.length ? html`
                <div class="notice notice--mint">
                  ${icon('map')}
                  <div><strong>${formatNumber(report.hotspots.length)} proximity hotspots</strong> are stored. Open the map to review cluster evidence.</div>
                </div>
                <a class="btn btn-secondary btn-block" href="#/admin/map">${icon('map')} Review hotspots</a>
              ` : ''}
              <p class="field-help mb-0">${report.note}</p>
            </div>
          </section>

          <section class="card">
            <div class="card-head"><div><h3>Status distribution</h3><p>Every record in the selected window.</p></div></div>
            <div class="card-body">
              ${barList(Object.entries(stats.byStatus || {}).map(([key, count]) => ({ key, label: statusMeta(key).label, count })), {
                colorFor: (item) => statusMeta(item.key).color,
                hrefFor: (item) => hrefFor('/admin/complaints', { status: item.key }),
                emptyMessage: 'No reports in this window.',
              })}
            </div>
          </section>
        </div>
      </div>
    `,
    mount(root) {
      const form = root.querySelector('#analyticsFilter');
      form?.addEventListener('submit', (event) => {
        event.preventDefault();
        const values = {};
        new FormData(form).forEach((value, key) => {
          const text = String(value).trim();
          if (text) values[key] = text;
        });
        window.location.hash = hrefFor('/admin/analytics', values);
      });
    },
  };
}

/* ========================================================================== */
/* Audit log                                                                  */
/* ========================================================================== */

export async function renderAdminAudit(ctx) {
  const page = Math.max(1, Number(ctx.query.page) || 1);
  const action = ctx.query.action || '';
  const data = await api.audit({ page, action: action || undefined, pageSize: 30 });
  const entries = data.entries || [];

  return {
    title: 'Audit log — CivicAI Admin',
    html: html`
      ${pageHead({
        title: 'Audit log',
        subtitle: 'A chronological record of administrative and security-relevant actions. Entries are append-only from the application layer.',
        actions: html`<a class="btn btn-secondary" href="${hrefFor('/admin/audit', { action })}">${icon('refresh')} Refresh</a>`,
      })}

      <section class="card">
        <div class="card-body">
          <form id="auditFilter" class="filters" novalidate>
            <div class="field field--wide">
              <label class="label" for="filter-action">Action</label>
              <select class="select" id="filter-action" name="action">
                <option value="">All actions</option>
                ${(data.actions || []).map((item) => html`
                  <option value="${item.action}" ${item.action === action ? raw('selected') : ''}>${item.action} (${formatNumber(item.n)})</option>
                `)}
              </select>
            </div>
            <div class="field">
              <span class="label">&nbsp;</span>
              <button class="btn btn-primary" type="submit">${icon('filter')} Filter</button>
            </div>
            <div class="field grow">
              <span class="label">&nbsp;</span>
              <span class="text-xs text-muted">${formatNumber(data.total)} ${Number(data.total) === 1 ? 'entry' : 'entries'} recorded</span>
            </div>
          </form>
        </div>
      </section>

      <section class="card mt-2">
        ${entries.length ? html`
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th><th>IP</th></tr></thead>
              <tbody>
                ${entries.map((entry) => html`
                  <tr>
                    <td class="nowrap text-xs" title="${entry.at}">${formatDateTime(entry.at)}</td>
                    <td class="text-xs">${entry.actor || 'System'}</td>
                    <td><code>${entry.action}</code></td>
                    <td class="text-xs nowrap">
                      ${entry.entityType === 'complaint' && entry.entityId
                        ? html`<a href="#/admin/complaints/${encodeURIComponent(entry.entityId)}">Complaint #${entry.entityId}</a>`
                        : `${entry.entityType || '—'}${entry.entityId ? ` #${entry.entityId}` : ''}`}
                    </td>
                    <td class="text-xs text-muted">${shortDetails(entry.details)}</td>
                    <td class="text-xs text-muted nowrap">${entry.ip || '—'}</td>
                  </tr>
                `)}
              </tbody>
            </table>
          </div>
          <div class="card-body" style="border-top:1px solid var(--line);padding-top:.8rem">
            ${pagination({
              page: data.page, pages: data.pages, total: data.total, pageSize: data.pageSize,
              hrefFor: (p) => hrefFor('/admin/audit', { action, page: p }),
            })}
          </div>
        ` : html`<div class="card-body">${emptyState({ title: 'No audit entries', message: 'Actions will be recorded here as administrators use the console.', iconName: 'shield' })}</div>`}
      </section>
    `,
    mount(root) {
      const form = root.querySelector('#auditFilter');
      form?.addEventListener('submit', (event) => {
        event.preventDefault();
        const value = form.querySelector('[name="action"]').value.trim();
        window.location.hash = hrefFor('/admin/audit', { action: value });
      });
    },
  };
}

/* ========================================================================== */
/* Settings                                                                   */
/* ========================================================================== */

export async function renderAdminSettings(ctx) {
  const [data, usersData] = await Promise.all([
    api.settings(),
    safe(api.adminUsers(), { users: [] }),
  ]);
  const settings = data.settings || {};
  const ai = data.ai || {};
  const environment = data.environment || {};
  const users = usersData?.users || [];

  const numberField = (name, label, value, { min = null, max = null, step = '1', help = '' } = {}) => html`
    <div class="field">
      <label class="label" for="setting-${name}">${label}</label>
      <input class="input" id="setting-${name}" name="${name}" type="number" value="${value}"
        ${min != null ? raw(`min="${min}"`) : ''} ${max != null ? raw(`max="${max}"`) : ''} step="${step}" />
      ${help ? html`<p class="field-help">${help}</p>` : ''}
    </div>
  `;

  return {
    title: 'Settings — CivicAI Admin',
    html: html`
      ${pageHead({
        title: 'System settings',
        subtitle: 'Operational thresholds take effect immediately. Provider credentials are read from environment variables and are never returned by the API.',
      })}

      <div class="admin-grid">
        <div class="stack">
          <section class="card">
            <div class="card-head">
              <div><h3>Triage &amp; evidence thresholds</h3><p>Controls duplicate candidate generation and upload limits.</p></div>
              ${icon('settings')}
            </div>
            <div class="card-body">
              <form id="settingsForm" novalidate>
                <div class="form-grid">
                  ${numberField('duplicateThreshold', 'Duplicate similarity threshold', settings.duplicateThreshold, {
                    min: 0.3, max: 0.95, step: 0.01,
                    help: 'Combined score required before a candidate is stored (0.3–0.95). Lower values create more review work.',
                  })}
                  ${numberField('duplicateMaxDistanceM', 'Duplicate maximum distance (m)', settings.duplicateMaxDistanceM, {
                    min: 1, step: 10, help: 'Reports farther apart receive less location weight in the similarity score.',
                  })}
                  ${numberField('duplicateWindowDays', 'Duplicate comparison window (days)', settings.duplicateWindowDays, {
                    min: 1, step: 1, help: 'Only complaints created within this window are compared.',
                  })}
                  ${numberField('maxImageMB', 'Maximum upload size (MB)', settings.maxImageMB, {
                    min: 1, max: 25, step: 1, help: 'Hard server cap is 25 MB. JPEG, PNG and WebP are accepted.',
                  })}
                </div>
              </form>
            </div>
          </section>

          <section class="card">
            <div class="card-head">
              <div><h3>Hotspot detection</h3><p>DBSCAN parameters over stored coordinates. Recompute from the map page after changes.</p></div>
              <a class="btn btn-sm btn-secondary" href="#/admin/map">${icon('map')} Open map</a>
            </div>
            <div class="card-body">
              <div class="form-grid">
                ${numberField('hotspotRadiusM', 'Cluster radius (m)', settings.hotspotRadiusM, { min: 1, step: 50, help: 'Maximum distance between reports in the same cluster.' })}
                ${numberField('hotspotMinPoints', 'Minimum reports per hotspot', settings.hotspotMinPoints, { min: 2, step: 1, help: 'A cluster needs at least this many reports.' })}
              </div>
            </div>
          </section>

          <section class="card">
            <div class="card-head">
              <div><h3>Public identity</h3><p>Shown in the citizen interface and public dashboard.</p></div>
            </div>
            <div class="card-body">
              <div class="field">
                <label class="label" for="setting-cityName">City name</label>
                <input class="input" id="setting-cityName" name="cityName" maxlength="120" value="${settings.cityName || ''}" />
              </div>
              <label class="row mt-2" style="gap:.5rem;align-items:flex-start">
                <input type="checkbox" name="aiEnabled" ${settings.aiEnabled ? raw('checked') : ''} style="margin-top:.25rem" />
                <span><strong>Use configured AI provider when available</strong><br />
                  <span class="text-xs text-muted">When disabled, the deterministic local fallback is used and clearly labelled. The system never invents AI output.</span>
                </span>
              </label>
              <div class="form-alert mt-2" id="settingsAlert" hidden>${icon('alert')}<span data-alert-text></span></div>
              <div class="row mt-2">
                <button class="btn btn-primary" type="submit" form="settingsForm" id="settingsSubmit">${icon('check')} Save settings</button>
                <span class="text-xs text-muted">Every change is written to the audit log.</span>
              </div>
            </div>
          </section>

          <section class="card">
            <div class="card-head">
              <div><h3>Administrator accounts</h3><p>Active accounts permitted to access this console.</p></div>
              <span class="badge badge--muted">${formatNumber(users.length)}</span>
            </div>
            <div class="card-body">
              ${users.length ? html`
                <div class="table-wrap">
                  <table class="data-table">
                    <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr></thead>
                    <tbody>
                      ${users.map((user) => html`
                        <tr>
                          <td><strong>${user.name}</strong></td>
                          <td class="text-xs">${user.email}</td>
                          <td><span class="badge badge--muted">${user.role}</span></td>
                          <td><span class="badge badge--resolved">${user.status}</span></td>
                        </tr>
                      `)}
                    </tbody>
                  </table>
                </div>
              ` : html`<p class="text-small text-muted mb-0">No administrator accounts are available.</p>`}
            </div>
          </section>
        </div>

        <div class="stack">
          <section class="card">
            <div class="card-head">
              <div><h3>AI analysis mode</h3><p>Configuration is resolved from the server environment.</p></div>
              <span class="badge ${ai.providerConfigured ? 'badge--ai' : 'badge--heuristic'}">
                ${ai.providerConfigured ? 'Provider configured' : 'Local fallback'}
              </span>
            </div>
            <div class="card-body">
              <dl class="kv">
                <dt>Mode</dt><dd>${ai.mode === 'provider' ? 'AI provider with local fallback' : 'Deterministic local rules'}</dd>
                <dt>Model</dt><dd>${ai.model || 'Not configured'}</dd>
                <dt>Enabled</dt><dd>${ai.enabled ? 'Yes' : 'No'}</dd>
                <dt>Image analysis</dt><dd>${ai.imageAnalysis ? 'Enabled' : 'Disabled — photos stored as evidence only'}</dd>
              </dl>
              <div class="notice notice--mint mt-2">
                ${icon('shield')}
                <div><strong>Transparency guarantee.</strong> Local rules and provider output are both labelled. Priority is a recommendation with visible factors; administrators make the final decision.</div>
              </div>
            </div>
          </section>

          <section class="card">
            <div class="card-head"><div><h3>Environment</h3><p>Read-only runtime information.</p></div></div>
            <div class="card-body">
              <dl class="kv">
                <dt>Environment</dt><dd>${environment.nodeEnv || 'unknown'}</dd>
                <dt>Session lifetime</dt><dd>${formatNumber(environment.sessionDays)} days</dd>
                <dt>Upload hard cap</dt><dd>${formatNumber(environment.uploadHardCapMB)} MB</dd>
                <dt>Database</dt><dd class="mono" style="font-size:.72rem">${environment.dbPath || '—'}</dd>
              </dl>
              <p class="field-help mt-2">${data.note}</p>
            </div>
          </section>

          <section class="card">
            <div class="card-head"><div><h3>Teams</h3><p>Assignment destinations available to administrators.</p></div></div>
            <div class="card-body">
              <div class="tag-list">
                ${(data.teams || []).map((team) => html`<span class="chip">${team}</span>`)}
              </div>
            </div>
          </section>

          <section class="card">
            <div class="card-head"><div><h3>Change password</h3><p>Updating the password signs out other sessions.</p></div></div>
            <div class="card-body">
              <form id="passwordForm" novalidate>
                <div class="field">
                  <label class="label" for="currentPassword">Current password</label>
                  <input class="input" id="currentPassword" name="currentPassword" type="password" autocomplete="current-password" required />
                </div>
                <div class="field mt-1">
                  <label class="label" for="newPassword">New password</label>
                  <input class="input" id="newPassword" name="newPassword" type="password" autocomplete="new-password" required />
                  <p class="field-help">At least 8 characters, including a letter and a number.</p>
                </div>
                <div class="form-alert mt-1" id="passwordAlert" hidden>${icon('alert')}<span data-alert-text></span></div>
                <button class="btn btn-secondary btn-block mt-1" type="submit" id="passwordSubmit">${icon('lock')} Update password</button>
              </form>
            </div>
          </section>
        </div>
      </div>
    `,
    mount(root) {
      const form = root.querySelector('#settingsForm');
      form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const alert = root.querySelector('#settingsAlert');
        const button = root.querySelector('#settingsSubmit');
        const readNumber = (name) => Number(form.querySelector(`[name="${name}"]`).value);
        const body = {
          duplicateThreshold: readNumber('duplicateThreshold'),
          duplicateMaxDistanceM: readNumber('duplicateMaxDistanceM'),
          duplicateWindowDays: readNumber('duplicateWindowDays'),
          maxImageMB: readNumber('maxImageMB'),
          hotspotRadiusM: readNumber('hotspotRadiusM'),
          hotspotMinPoints: readNumber('hotspotMinPoints'),
          cityName: form.querySelector('[name="cityName"]').value.trim(),
          aiEnabled: form.querySelector('[name="aiEnabled"]').checked,
        };
        if (body.duplicateThreshold < 0.3 || body.duplicateThreshold > 0.95) {
          setFormAlert(alert, 'Duplicate threshold must be between 0.3 and 0.95.');
          return;
        }
        if (!body.cityName) {
          setFormAlert(alert, 'City name is required.');
          return;
        }
        for (const key of ['duplicateMaxDistanceM', 'duplicateWindowDays', 'maxImageMB', 'hotspotRadiusM', 'hotspotMinPoints']) {
          if (!Number.isFinite(body[key]) || body[key] <= 0) {
            setFormAlert(alert, 'All numeric settings must be positive numbers.');
            return;
          }
        }
        if (body.maxImageMB > 25) {
          setFormAlert(alert, 'Maximum upload size cannot exceed 25 MB.');
          return;
        }
        setFormAlert(alert, '');
        setBusy(button, true, 'Saving…');
        try {
          await api.saveSettings(body);
          toast('Operational settings updated.', { title: 'Settings saved' });
          ctx.refresh();
        } catch (err) {
          setBusy(button, false);
          setFormAlert(alert, err.message || 'The settings could not be saved.');
        }
      });

      const passwordForm = root.querySelector('#passwordForm');
      passwordForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const alert = root.querySelector('#passwordAlert');
        const button = root.querySelector('#passwordSubmit');
        const current = passwordForm.querySelector('[name="currentPassword"]').value;
        const next = passwordForm.querySelector('[name="newPassword"]').value;
        if (next.length < 8 || !/[A-Za-z]/.test(next) || !/[0-9]/.test(next)) {
          setFormAlert(alert, 'New password must be at least 8 characters and include a letter and a number.');
          return;
        }
        setFormAlert(alert, '');
        setBusy(button, true, 'Updating…');
        try {
          await api.changePassword(current, next);
          passwordForm.reset();
          setBusy(button, false);
          toast('Password updated. Other sessions were signed out.', { title: 'Security updated' });
        } catch (err) {
          setBusy(button, false);
          setFormAlert(alert, err.message || 'The password could not be changed.');
        }
      });
    },
  };
}
