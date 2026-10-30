/**
 * CivicAI application shell and hash router.
 *
 * The frontend intentionally has no build step. This module owns three things:
 *   1. loading the public metadata and the signed-in user once at boot,
 *   2. rendering the shared public or administrator chrome around each page,
 *   3. matching `#/route` paths to page modules and guarding admin routes.
 *
 * All page content is supplied by the modules in ./pages, which render from live
 * API responses. Nothing in the shell contains dashboard statistics or demo
 * numbers.
 */
import { api, ApiError } from './api.js';
import {
  html, raw, icon, escapeHtml, formatNumber, initials, queryString, parseHash, scrollTop, toast,
  emptyState,
} from './ui.js';
import {
  renderHome, renderReport, renderTrack, renderPublic, renderLogin, renderSignup,
  renderMy, renderMyDetail,
} from './pages/citizen.js';
import {
  renderAdminDashboard, renderAdminComplaints, renderAdminComplaint, renderAdminDuplicates,
  renderAdminMap, renderAdminAssignments, renderAdminAnalytics, renderAdminAudit,
  renderAdminSettings,
} from './pages/admin.js';

const root = document.getElementById('app');

const state = {
  meta: {},
  user: null,
  ready: false,
  notifications: { items: [], pendingDuplicates: 0, pendingReports: 0 },
};

/* ========================================================================== */
/* Routes                                                                     */
/* ========================================================================== */

const ROUTES = [
  { name: 'home', pattern: /^\/$/, page: renderHome, nav: 'home' },
  { name: 'report', pattern: /^\/report$/, page: renderReport, nav: 'report' },
  { name: 'track', pattern: /^\/track$/, page: renderTrack, nav: 'track' },
  { name: 'public', pattern: /^\/public$/, page: renderPublic, nav: 'public' },
  { name: 'login', pattern: /^\/login$/, page: renderLogin, nav: null },
  { name: 'signup', pattern: /^\/signup$/, page: renderSignup, nav: null },
  { name: 'my', pattern: /^\/my$/, page: renderMy, nav: 'my' },
  { name: 'myDetail', pattern: /^\/my\/([^/]+)$/, params: ['id'], page: renderMyDetail, nav: 'my' },

  {
    name: 'adminDashboard', pattern: /^\/admin$/, page: renderAdminDashboard,
    layout: 'admin', admin: true, crumb: 'Dashboard',
  },
  {
    name: 'adminComplaints', pattern: /^\/admin\/complaints$/, page: renderAdminComplaints,
    layout: 'admin', admin: true, crumb: 'Complaints',
  },
  {
    name: 'adminComplaint', pattern: /^\/admin\/complaints\/(\d+)$/, params: ['id'], page: renderAdminComplaint,
    layout: 'admin', admin: true, crumb: 'Complaint review',
  },
  {
    name: 'adminDuplicates', pattern: /^\/admin\/duplicates$/, page: renderAdminDuplicates,
    layout: 'admin', admin: true, crumb: 'Duplicate review',
  },
  {
    name: 'adminMap', pattern: /^\/admin\/map$/, page: renderAdminMap,
    layout: 'admin', admin: true, crumb: 'Map & hotspots',
  },
  {
    name: 'adminAssignments', pattern: /^\/admin\/assignments$/, page: renderAdminAssignments,
    layout: 'admin', admin: true, crumb: 'Assignments',
  },
  {
    name: 'adminAnalytics', pattern: /^\/admin\/analytics$/, page: renderAdminAnalytics,
    layout: 'admin', admin: true, crumb: 'Analytics',
  },
  {
    name: 'adminAudit', pattern: /^\/admin\/audit$/, page: renderAdminAudit,
    layout: 'admin', admin: true, crumb: 'Audit log',
  },
  {
    name: 'adminSettings', pattern: /^\/admin\/settings$/, page: renderAdminSettings,
    layout: 'admin', admin: true, crumb: 'Settings',
  },
];

const PUBLIC_NAV = [
  { key: 'home', href: '#/', label: 'Home', icon: 'home' },
  { key: 'report', href: '#/report', label: 'Report an issue', icon: 'send' },
  { key: 'track', href: '#/track', label: 'Track a report', icon: 'search' },
  { key: 'public', href: '#/public', label: 'Public dashboard', icon: 'chart' },
];

const ADMIN_NAV = [
  {
    label: 'Operations',
    items: [
      { key: 'dashboard', href: '#/admin', label: 'Dashboard', icon: 'chart', exact: true },
      { key: 'complaints', href: '#/admin/complaints', label: 'Complaints', icon: 'list', prefix: '/admin/complaints', count: 'reports' },
      { key: 'duplicates', href: '#/admin/duplicates', label: 'Duplicate review', icon: 'layers', count: 'duplicates' },
      { key: 'map', href: '#/admin/map', label: 'Map & hotspots', icon: 'map' },
      { key: 'assignments', href: '#/admin/assignments', label: 'Assignments', icon: 'users' },
    ],
  },
  {
    label: 'Insight',
    items: [
      { key: 'analytics', href: '#/admin/analytics', label: 'Analytics', icon: 'activity' },
      { key: 'audit', href: '#/admin/audit', label: 'Audit log', icon: 'shield' },
    ],
  },
  {
    label: 'System',
    items: [
      { key: 'settings', href: '#/admin/settings', label: 'Settings', icon: 'settings' },
      { key: 'public-site', href: '#/public', label: 'Public site', icon: 'eye', externalNav: true },
    ],
  },
];

function parseRoute(path) {
  for (const route of ROUTES) {
    const match = route.pattern.exec(path);
    if (!match) continue;
    const params = {};
    (route.params || []).forEach((name, index) => {
      const value = match[index + 1];
      try {
        params[name] = decodeURIComponent(value);
      } catch {
        params[name] = value;
      }
    });
    return { ...route, params };
  }
  return null;
}

function fullPath(path, query) {
  return `${path}${queryString(query || {})}`;
}

function isAdmin() {
  return state.user?.role === 'admin';
}

function currentSection(path) {
  if (path === '/') return 'home';
  const first = path.split('/').filter(Boolean)[0] || '';
  return first === 'my' ? 'my' : first;
}

function publicNavActive(key, path) {
  if (key === 'home') return path === '/';
  if (key === 'my') return path === '/my' || path.startsWith('/my/');
  return path === `/${key}`;
}

function adminNavActive(item, path) {
  if (item.externalNav) return false;
  if (item.exact) return path === '/admin';
  if (item.prefix) return path === item.prefix || path.startsWith(`${item.prefix}/`);
  return path === item.href.replace(/^#/, '');
}

/* ========================================================================== */
/* Public chrome                                                              */
/* ========================================================================== */

function userMenu() {
  const user = state.user;
  const firstName = String(user.name || '').trim().split(/\s+/)[0] || user.name || 'Account';
  const roleLabel = user.role === 'admin' ? 'Administrator' : 'Citizen';
  return html`
    <div class="user-menu" data-user-menu>
      <button type="button" data-user-toggle aria-haspopup="true" aria-expanded="false" aria-label="Account menu for ${user.name}">
        <span class="avatar">${initials(user.name)}</span>
        <span>${escapeHtml(firstName)}</span>
        ${icon('chevron-down', 'icon-sm')}
      </button>
      <div class="user-pop" data-user-pop role="menu" hidden>
        <div class="user-pop-head">
          <strong>${escapeHtml(user.name)}</strong>
          ${escapeHtml(user.email || '')}<br />${roleLabel}
        </div>
        <a href="#/my" role="menuitem">${icon('clipboard')} My reports</a>
        <a href="#/track" role="menuitem">${icon('search')} Track with a code</a>
        ${user.role === 'admin' ? html`<a href="#/admin" role="menuitem">${icon('shield')} Officer console</a>` : ''}
        <button type="button" role="menuitem" data-logout>${icon('log-out')} Sign out</button>
      </div>
    </div>
  `;
}

function publicHeader(path) {
  const city = state.meta?.cityName || 'CivicAI';
  const mobileLinks = [
    ...PUBLIC_NAV,
    ...(state.user ? [{ key: 'my', href: '#/my', label: 'My reports', icon: 'clipboard' }] : []),
    ...(isAdmin()
      ? [{ key: 'admin', href: '#/admin', label: 'Officer console', icon: 'shield' }]
      : [{ key: 'officer', href: '#/admin', label: 'Officer console', icon: 'shield' }]),
  ];
  return html`
    <header class="site-header">
      <div class="header-inner">
        <a class="brand" href="#/" aria-label="CivicAI home">
          <span class="brand-mark">${icon('sparkles')}</span>
          <span>CivicAI<small>${escapeHtml(city)} · civic response</small></span>
        </a>
        <nav class="site-nav" aria-label="Primary">
          ${PUBLIC_NAV.map((item) => html`
            <a href="${item.href}" ${publicNavActive(item.key, path) ? raw('aria-current="page"') : ''}>
              ${icon(item.icon)}${item.label}
            </a>
          `)}
        </nav>
        <div class="site-actions">
          ${state.user
            ? userMenu()
            : html`<a class="btn btn-secondary" href="#/admin" title="Open the officer console">${icon('shield')} Officer console</a>`}
          <a class="btn btn-mint" href="#/report">${icon('send')} Report</a>
        </div>
        <button type="button" class="nav-toggle" data-nav-toggle aria-expanded="false" aria-controls="mobileNav" aria-label="Open menu">
          ${icon('menu')}
        </button>
      </div>
      <div class="mobile-nav" id="mobileNav" hidden>
        ${mobileLinks.map((item) => html`
          <a href="${item.href}" ${publicNavActive(item.key, path) ? raw('aria-current="page"') : ''} data-mobile-link>
            ${icon(item.icon)}${item.label}
          </a>
        `)}
        ${state.user
          ? html`<button type="button" class="btn btn-secondary btn-block" style="margin-top:.7rem" data-logout>${icon('log-out')} Sign out</button>`
          : html`<a href="#/admin" data-mobile-link>${icon('shield')} Officer console</a>`}
      </div>
    </header>
  `;
}

function publicFooter() {
  const city = state.meta?.cityName || 'your city';
  const year = new Date().getFullYear();
  return html`
    <footer class="site-footer">
      <div class="wrap">
        <div class="footer-grid">
          <div class="footer-brand">
            <a class="brand" href="#/" style="margin-bottom:.9rem">
              <span class="brand-mark">${icon('sparkles')}</span>
              <span>CivicAI<small>From complaints to action</small></span>
            </a>
            <p>
              A working civic complaint platform for ${escapeHtml(city)}: assisted triage, human-reviewed
              duplicates, explainable priorities and timestamped public outcomes.
            </p>
            <p style="margin-top:.9rem">
              <span class="badge badge--ai">${icon('shield')} Private by default</span>
            </p>
          </div>
          <div>
            <h4>Citizens</h4>
            <a href="#/report">Report an issue</a>
            <a href="#/track">Track a report</a>
            <a href="#/public">Public dashboard</a>
            <a href="${state.user ? '#/my' : '#/login'}">${state.user ? 'My reports' : 'Citizen sign in'}</a>
          </div>
          <div>
            <h4>How it works</h4>
            <a href="#/">Assisted triage</a>
            <a href="#/public">Proximity hotspots</a>
            <a href="#/track">Status history</a>
            <a href="#/report">Photo evidence</a>
          </div>
          <div>
            <h4>Access</h4>
            <a href="#/admin">Officer console</a>
            <a href="#/signup">Create citizen account</a>
            <a href="#/public">Open data</a>
            <a href="#/track">Privacy &amp; tracking</a>
          </div>
        </div>
        <div class="footer-bottom">
          <span>© ${year} CivicAI · Civic complaint management prototype</span>
          <span>
            ${state.meta?.demoMode
              ? 'Synthetic demo records are explicitly labelled. No external trackers.'
              : 'No external trackers. Every administrative action is audited.'}
          </span>
        </div>
      </div>
    </footer>
  `;
}

/* ========================================================================== */
/* Admin chrome                                                               */
/* ========================================================================== */

function sideLink(item, path) {
  const active = adminNavActive(item, path);
  const count = item.count === 'duplicates'
    ? state.notifications.pendingDuplicates
    : item.count === 'reports'
      ? state.notifications.pendingReports
      : 0;
  return html`
    <a class="side-link" href="${item.href}" ${active ? raw('aria-current="page"') : ''}>
      ${icon(item.icon)}
      <span>${item.label}</span>
      ${item.count ? html`<span class="count" data-count-for="${item.count}" ${count > 0 ? '' : raw('hidden')}>${formatNumber(count)}</span>` : ''}
    </a>
  `;
}

function adminSidebar(path) {
  const user = state.user;
  const city = state.meta?.cityName || 'CivicAI';
  return html`
    <aside class="sidebar" id="adminSidebar" aria-label="Administration">
      <a class="sidebar-brand" href="#/admin">
        <span class="brand-mark">${icon('sparkles')}</span>
        <span><strong>CivicAI</strong><small>${escapeHtml(city)} console</small></span>
      </a>
      <div class="sidebar-scroll">
        ${ADMIN_NAV.map((group) => html`
          <div class="side-label">${group.label}</div>
          <nav class="side-nav" aria-label="${group.label}">
            ${group.items.map((item) => sideLink(item, path))}
          </nav>
        `)}
      </div>
      <div class="sidebar-foot">
        <div class="sidebar-user">
          <span class="avatar">${initials(user?.name || 'Admin')}</span>
          <div class="grow" style="min-width:0">
            <strong class="truncate">${escapeHtml(user?.name || 'Administrator')}</strong>
            <small class="truncate">${escapeHtml(user?.email || '')}</small>
          </div>
          <button type="button" data-logout title="Sign out" aria-label="Sign out">${icon('log-out')}</button>
        </div>
      </div>
    </aside>
  `;
}

function adminTopbar(route) {
  const pending = state.notifications.pendingDuplicates;
  const newReports = state.notifications.pendingReports;
  return html`
    <div class="admin-topbar">
      <button type="button" class="btn btn-sm btn-ghost admin-toggle" data-admin-toggle
        aria-controls="adminSidebar" aria-expanded="false" aria-label="Open navigation">
        ${icon('menu')}
      </button>
      <div class="crumb">
        <a href="#/admin" style="color:inherit;text-decoration:none">Admin</a>
        <span aria-hidden="true">/</span>
        <strong>${route?.crumb || 'Console'}</strong>
      </div>
      <div class="top-actions">
        ${state.meta?.demoMode ? html`<span class="badge badge--dupe">Synthetic demo data</span>` : ''}
        <a class="btn btn-sm btn-secondary" href="#/admin/complaints?status=submitted"
          title="${newReports ? `${formatNumber(newReports)} report(s) awaiting triage` : 'No new reports awaiting triage'}"
          aria-label="New reports queue${newReports ? `, ${formatNumber(newReports)} awaiting triage` : ''}">
          ${icon('clipboard')} <span data-new-reports>${newReports ? `${formatNumber(newReports)} new` : 'New reports'}</span>
        </a>
        <a class="btn btn-sm btn-secondary" href="#/public">${icon('eye')} Public site</a>
        <a class="btn btn-sm btn-ghost" href="#/admin/duplicates"
          title="${pending ? `${formatNumber(pending)} duplicate reviews pending` : 'No duplicate reviews pending'}"
          aria-label="Duplicate review queue${pending ? `, ${pending} pending` : ''}">
          ${icon('bell')}
          ${pending > 0 ? html`<span class="badge badge--dupe">${formatNumber(pending)}</span>` : ''}
        </a>
      </div>
    </div>
  `;
}

function adminShell(page, route, path) {
  return html`
    <div class="admin-shell">
      ${adminSidebar(path)}
      <button type="button" class="admin-scrim" data-admin-scrim hidden aria-label="Close navigation"></button>
      <div class="admin-main">
        ${adminTopbar(route)}
        <main class="admin-view" id="main" tabindex="-1">${page.html}</main>
      </div>
    </div>
  `;
}

/* ========================================================================== */
/* Loading / errors                                                           */
/* ========================================================================== */

function publicShell(page, route, path) {
  return html`
    ${publicHeader(path)}
    ${page.html}
    ${publicFooter()}
  `;
}

function shellFor(layout, page, route, path) {
  return layout === 'admin' ? adminShell(page, route, path) : publicShell(page, route, path);
}

function loadingPage(message = 'Loading CivicAI…') {
  return {
    title: 'CivicAI',
    html: html`
      <main id="main" class="section">
        <div class="wrap-narrow">
          <div class="card">
            <div class="loading-block" role="status" aria-live="polite">
              <span class="spinner" aria-hidden="true"></span>
              <strong style="font-size:.95rem">${message}</strong>
              <span class="text-xs text-muted">Fetching live records from the CivicAI server.</span>
            </div>
          </div>
        </div>
      </main>
    `,
    mount() {},
  };
}

function failurePage({ title, message, iconName = 'alert', action = null, retry = true }) {
  return {
    title: `${title} — CivicAI`,
    html: html`
      <main id="main" class="section">
        <div class="wrap-narrow">
          <div class="card">
            <div class="empty" style="padding:2.4rem 1.5rem">
              <div class="empty-icon">${icon(iconName)}</div>
              <h3>${title}</h3>
              <p>${message}</p>
              ${action || html`
                <div class="btn-group" style="justify-content:center">
                  <a class="btn btn-primary" href="#/">${icon('home')} Back to home</a>
                  ${retry ? html`<button type="button" class="btn btn-secondary" data-retry>${icon('refresh')} Try again</button>` : ''}
                </div>
              `}
            </div>
          </div>
        </div>
      </main>
    `,
    mount() {},
  };
}

function notFoundPage(path) {
  return {
    title: 'Page not found — CivicAI',
    html: html`
      <main id="main" class="section">
        <div class="wrap-narrow">
          <div class="card">${emptyState({
            title: 'This page does not exist',
            message: `No CivicAI screen matches ${path}. Use the navigation above or return to the public dashboard.`,
            iconName: 'search',
            action: '<a class="btn btn-primary" href="#/">Back to home</a> <a class="btn btn-secondary" href="#/public">Public dashboard</a>',
          })}</div>
        </div>
      </main>
    `,
    mount() {},
  };
}

function errorPage(title, message) {
  return failurePage({ title, message, iconName: 'alert', retry: true });
}

function forbiddenPage() {
  return {
    title: 'Administrator access required — CivicAI',
    html: html`
      <main id="main" class="section">
        <div class="wrap-narrow">
          <div class="card">${emptyState({
            title: 'Administrator access required',
            message: 'The staff console is restricted to administrator accounts. Citizen accounts can report issues and follow their own reports.',
            iconName: 'lock',
            action: '<a class="btn btn-primary" href="#/my">Go to my reports</a> <a class="btn btn-secondary" href="#/">Back to home</a>',
          })}</div>
        </div>
      </main>
    `,
    mount() {},
  };
}

/**
 * Shown instead of bouncing a signed-out visitor straight to the login form.
 * Explains what the officer console is and offers one-click demo access, so
 * evaluating the officer experience never requires creating an account.
 */
function officerAccessPage(targetPath, query) {
  const next = fullPath(targetPath, query);
  return {
    title: 'Officer console — CivicAI',
    html: html`
      <main id="main" class="section">
        <div class="wrap-narrow">
          <div class="card" style="padding:1.9rem">
            <span class="badge badge--ai">${icon('shield')} Officer area</span>
            <h1 style="margin:.7rem 0 .4rem">Officer console</h1>
            <p>
              Every citizen report is queued here the moment it is submitted — including its photo,
              location, priority factors, history and duplicate candidates. Officers do not need to be
              told about a report separately; it appears in the live queue automatically.
            </p>
            <div class="stack" style="margin:1.1rem 0;gap:.55rem">
              <div class="row" style="gap:.6rem;align-items:flex-start">${icon('clipboard')}<span><strong>New reports queue</strong> — submitted reports awaiting triage, sorted by urgency.</span></div>
              <div class="row" style="gap:.6rem;align-items:flex-start">${icon('alert')}<span><strong>Critical hazards</strong> — imminent-safety reports carry a human-review flag.</span></div>
              <div class="row" style="gap:.6rem;align-items:flex-start">${icon('layers')}<span><strong>Duplicate review</strong> — near-identical reports are grouped for a human decision.</span></div>
              <div class="row" style="gap:.6rem;align-items:flex-start">${icon('map')}<span><strong>Map &amp; assignments</strong> — hotspots, teams and status workflow in one place.</span></div>
            </div>
            <div class="btn-group">
              <button type="button" class="btn btn-primary btn-lg" data-demo-officer>
                ${icon('shield')} Enter demo officer console
              </button>
              <a class="btn btn-secondary btn-lg" href="#/login?next=${encodeURIComponent(next)}">
                ${icon('lock')} Sign in with staff credentials
              </a>
            </div>
            <p class="text-xs text-muted" style="margin-top:.8rem">
              Demo access creates a real, audited administrator session and is disabled in production.
              Citizen accounts stay optional — reporting an issue never requires one.
            </p>
            <div class="form-alert" id="officerGateAlert" hidden style="margin-top:.9rem">
              ${icon('alert')}<span data-alert-text></span>
            </div>
          </div>
        </div>
      </main>
    `,
    mount(root) {
      const button = root.querySelector('[data-demo-officer]');
      if (!button) return;
      button.addEventListener('click', async () => {
        if (button.disabled) return;
        const label = button.innerHTML;
        button.disabled = true;
        button.innerHTML = '<span class="spinner" aria-hidden="true"></span> Opening console…';
        try {
          const result = await api.demoOfficer();
          state.user = result.user;
          toast(`Signed in as ${result.user.name}.`, { type: 'success', title: 'Officer console' });
          go(next);
        } catch (err) {
          button.disabled = false;
          button.innerHTML = label;
          const alert = root.querySelector('#officerGateAlert');
          if (alert) {
            alert.hidden = false;
            const text = alert.querySelector('[data-alert-text]');
            if (text) text.textContent = err?.message || 'Could not open the officer console.';
          }
        }
      });
    },
  };
}

/* ========================================================================== */
/* Shell interactions                                                         */
/* ========================================================================== */

let shellAbort = null;

/** Update live queue counters without re-rendering the page. */
function refreshBadgeCounts() {
  root.querySelectorAll('[data-count-for]').forEach((el) => {
    const key = el.getAttribute('data-count-for');
    const value = key === 'duplicates'
      ? state.notifications.pendingDuplicates
      : state.notifications.pendingReports;
    el.textContent = formatNumber(value);
    el.toggleAttribute('hidden', !(value > 0));
  });
  const top = root.querySelector('[data-new-reports]');
  if (top) {
    const value = state.notifications.pendingReports;
    top.textContent = value ? `${formatNumber(value)} new` : 'New reports';
  }
}

function closeUserMenu(menu) {
  if (!menu) return;
  const pop = menu.querySelector('[data-user-pop]');
  const trigger = menu.querySelector('[data-user-toggle]');
  if (pop) pop.hidden = true;
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
}

function bindChrome() {
  if (shellAbort) shellAbort.abort();
  shellAbort = new AbortController();
  const { signal } = shellAbort;

  /* Keep the officer queue badges live while the console is open. */
  if (isAdmin() && root.querySelector('.admin-shell')) {
    const timer = setInterval(async () => {
      try {
        const data = await api.notifications();
        state.notifications.pendingDuplicates = Number(data?.pendingDuplicates) || 0;
        state.notifications.pendingReports = Number(data?.newReports) || 0;
        refreshBadgeCounts();
      } catch {
        /* Keep the last known counts if the poll fails. */
      }
    }, 30000);
    signal.addEventListener('abort', () => clearInterval(timer), { once: true });
  }

  /* Public mobile navigation */
  const navToggle = root.querySelector('[data-nav-toggle]');
  const mobileNav = root.querySelector('#mobileNav');
  if (navToggle && mobileNav) {
    navToggle.addEventListener('click', () => {
      const open = mobileNav.hasAttribute('hidden');
      mobileNav.toggleAttribute('hidden', !open);
      navToggle.setAttribute('aria-expanded', String(open));
      navToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      navToggle.innerHTML = String(open ? icon('x') : icon('menu'));
    }, { signal });
    mobileNav.querySelectorAll('[data-mobile-link]').forEach((link) => {
      link.addEventListener('click', () => {
        mobileNav.hidden = true;
        navToggle.setAttribute('aria-expanded', 'false');
        navToggle.innerHTML = String(icon('menu'));
      }, { signal });
    });
  }

  /* Public account menu */
  const menu = root.querySelector('[data-user-menu]');
  if (menu) {
    const trigger = menu.querySelector('[data-user-toggle]');
    const pop = menu.querySelector('[data-user-pop]');
    trigger?.addEventListener('click', () => {
      const willOpen = Boolean(pop?.hidden);
      if (pop) pop.hidden = !willOpen;
      trigger.setAttribute('aria-expanded', String(willOpen));
    }, { signal });
    menu.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => closeUserMenu(menu), { signal });
    });
    document.addEventListener('click', (event) => {
      if (!menu.contains(event.target)) closeUserMenu(menu);
    }, { signal });
  }

  /* Administrator sidebar */
  const sidebar = root.querySelector('#adminSidebar');
  const scrim = root.querySelector('[data-admin-scrim]');
  const adminToggle = root.querySelector('[data-admin-toggle]');
  const closeSidebar = () => {
    sidebar?.classList.remove('is-open');
    if (scrim) scrim.hidden = true;
    if (adminToggle) adminToggle.setAttribute('aria-expanded', 'false');
  };
  adminToggle?.addEventListener('click', () => {
    const open = !sidebar?.classList.contains('is-open');
    sidebar?.classList.toggle('is-open', open);
    if (scrim) scrim.hidden = !open;
    adminToggle.setAttribute('aria-expanded', String(open));
  }, { signal });
  scrim?.addEventListener('click', closeSidebar, { signal });
  sidebar?.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', closeSidebar, { signal });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    closeUserMenu(menu);
    closeSidebar();
  }, { signal });

  /* Sign out from any chrome */
  root.querySelectorAll('[data-logout]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true;
      try {
        await api.logout();
      } catch {
        /* Even if the request fails, clear the local view of the session. */
      }
      state.user = null;
      state.notifications = { items: [], pendingDuplicates: 0, pendingReports: 0 };
      toast('You are signed out.', { type: 'info', title: 'Session ended' });
      go('/');
    }, { signal });
  });

  /* Error retry */
  root.querySelector('[data-retry]')?.addEventListener('click', () => {
    renderRoute({ focus: false });
  }, { signal });
}

/* ========================================================================== */
/* Router                                                                     */
/* ========================================================================== */

let renderSequence = 0;

function makeContext(route, query) {
  return {
    state,
    query,
    params: route?.params || {},
    go,
    setUser(user) {
      state.user = user || null;
      if (!state.user) state.notifications = { items: [], pendingDuplicates: 0, pendingReports: 0 };
    },
    refresh(options = {}) {
      return renderRoute({
        preserveScroll: options.preserveScroll !== false,
        silent: true,
        focus: false,
      });
    },
  };
}

function go(path) {
  if (!path) return;
  const target = String(path);
  const hash = target.startsWith('#') ? target : `#${target}`;
  if (window.location.hash === hash) {
    renderRoute({ focus: false });
    return;
  }
  window.location.hash = hash;
}

function classifyError(err) {
  if (err instanceof ApiError) {
    if (err.status === 404) return { title: 'Record not found', message: err.message };
    if (err.status === 403) return { title: 'Not authorised', message: err.message };
    if (err.status === 401) return { title: 'Session expired', message: err.message };
    return { title: 'Could not load this page', message: err.message };
  }
  return {
    title: 'Something went wrong',
    message: err?.message || 'The page could not be loaded. Please try again.',
  };
}

function focusMain() {
  const main = root.querySelector('#main');
  if (!main) return;
  if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
  main.focus({ preventScroll: true });
}

async function renderRoute({ preserveScroll = false, silent = false, focus = true } = {}) {
  if (!state.ready) return;

  const sequence = ++renderSequence;
  const { path, query } = parseHash();
  const route = parseRoute(path);
  const layout = route?.layout === 'admin' || (!route && path.startsWith('/admin')) ? 'admin' : 'public';

  /* Administrator guard. The server enforces RBAC independently; this only
     prevents a dead-end UI for signed-out or citizen visitors. */
  if (route?.admin || path.startsWith('/admin')) {
    if (!state.user) {
      const gate = officerAccessPage(path, query);
      root.innerHTML = String(publicShell(gate, route, path));
      document.title = gate.title;
      bindChrome();
      gate.mount?.(root);
      scrollTop();
      return;
    }
    if (!isAdmin()) {
      root.innerHTML = String(publicShell(forbiddenPage(), route, path));
      document.title = 'Administrator access required — CivicAI';
      bindChrome();
      scrollTop();
      return;
    }
  }

  if (!silent) {
    root.innerHTML = String(shellFor(layout, loadingPage(), route, path));
    document.title = 'CivicAI';
    bindChrome();
  }
  root.setAttribute('aria-busy', 'true');

  const ctx = makeContext(route, query);
  let page;
  let notificationTask = Promise.resolve();

  if (isAdmin() && (route?.admin || layout === 'admin')) {
    notificationTask = api.notifications()
      .then((data) => {
        state.notifications = {
          items: data?.notifications || [],
          pendingDuplicates: Number(data?.pendingDuplicates) || 0,
          pendingReports: Number(data?.newReports) || 0,
        };
      })
      .catch(() => { /* badges are optional; the console still works */ });
  }

  try {
    if (!route) {
      page = path.startsWith('/admin')
        ? failurePage({
          title: 'Console page not found',
          message: `No administrator screen matches ${path}.`,
          iconName: 'search',
          action: '<a class="btn btn-primary" href="#/admin">Back to dashboard</a>',
          retry: false,
        })
        : notFoundPage(path);
    } else {
      page = await route.page(ctx);
    }
  } catch (err) {
    console.error('[civicai] page render failed', err);

    if (err instanceof ApiError && err.status === 401 && (route?.admin || layout === 'admin')) {
      state.user = null;
      state.notifications = { items: [], pendingDuplicates: 0, pendingReports: 0 };
      toast('Your session expired. Please sign in again.', { type: 'error', title: 'Signed out' });
      const next = fullPath(path, query);
      go(`/login?next=${encodeURIComponent(next)}`);
      return;
    }

    if (err instanceof ApiError && err.status === 403) {
      page = forbiddenPage();
    } else {
      const { title, message } = classifyError(err);
      page = errorPage(title, message);
    }
  }

  await notificationTask;

  if (sequence !== renderSequence) return;

  root.innerHTML = String(shellFor(layout, page, route, path));
  document.title = page.title || 'CivicAI';
  root.setAttribute('aria-busy', 'false');
  bindChrome();

  try {
    page.mount?.(root);
  } catch (err) {
    console.error('[civicai] page mount failed', err);
    toast('The page loaded, but an interactive control could not start.', {
      type: 'error',
      title: 'Partial page failure',
    });
  }

  if (!preserveScroll) scrollTop();
  if (focus) requestAnimationFrame(focusMain);
}

/* ========================================================================== */
/* Boot                                                                       */
/* ========================================================================== */

function bootLoading() {
  root.innerHTML = String(html`
    ${publicHeader('/')}
    ${loadingPage('Starting CivicAI…').html}
    <footer class="site-footer">
      <div class="wrap">
        <div class="footer-bottom" style="border-top:0;padding-top:1.6rem">
          <span>© ${new Date().getFullYear()} CivicAI</span>
          <span>Connecting to city records…</span>
        </div>
      </div>
    </footer>
  `);
  bindChrome();
}

async function boot() {
  bootLoading();
  const [metaResult, userResult] = await Promise.allSettled([api.meta(), api.me()]);

  if (metaResult.status === 'fulfilled' && metaResult.value) {
    state.meta = metaResult.value;
  } else if (metaResult.status === 'rejected') {
    console.warn('[civicai] metadata unavailable', metaResult.reason?.message);
  }

  if (userResult.status === 'fulfilled') {
    state.user = userResult.value?.user || null;
  } else {
    console.warn('[civicai] session check failed', userResult.reason?.message);
    state.user = null;
  }

  state.ready = true;
  await renderRoute({ focus: false });
}

window.addEventListener('hashchange', () => {
  renderRoute().catch((err) => {
    console.error('[civicai] navigation failed', err);
    const page = errorPage('Navigation failed', 'Could not open that page. Please try again.');
    root.innerHTML = String(publicShell(page, null, '/'));
    bindChrome();
  });
});

if (!window.location.hash) {
  // Keep a canonical route in the URL so refreshes and shared links work.
  window.history.replaceState(null, '', '#/');
}

boot().catch((err) => {
  console.error('[civicai] boot failed', err);
  const page = errorPage('CivicAI could not start', 'The application shell failed to initialise. Reload the page to try again.');
  root.innerHTML = String(publicShell(page, null, '/'));
  bindChrome();
});

export { state };
