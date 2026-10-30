/**
 * Custom, dependency-free SVG city map.
 *
 * There are no map tiles or third-party services: the base map is a stylised
 * schematic of the demo city, and complaint coordinates are projected onto it.
 * That keeps the app fully offline-capable and avoids leaking location data to
 * an external tile provider. Hotspot rings are drawn at their real metre radius.
 */
import { escapeHtml, formatDistance, categoryMeta, priorityMeta, statusMeta } from './ui.js';

export const BOUNDS = {
  north: 22.605,
  south: 22.545,
  west: 88.33,
  east: 88.42,
};

const W = 1000;
const H = 720;
const PX_PER_M = 0.1082;
let mapSeq = 0;

export function project(lat, lng) {
  const n = Number(lat);
  const e = Number(lng);
  if (!Number.isFinite(n) || !Number.isFinite(e)) return null;
  return {
    x: ((e - BOUNDS.west) / (BOUNDS.east - BOUNDS.west)) * W,
    y: ((BOUNDS.north - n) / (BOUNDS.north - BOUNDS.south)) * H,
  };
}

export function unproject(x, y) {
  return {
    lat: Number((BOUNDS.north - (y / H) * (BOUNDS.north - BOUNDS.south)).toFixed(6)),
    lng: Number((BOUNDS.west + (x / W) * (BOUNDS.east - BOUNDS.west)).toFixed(6)),
  };
}

export function metersToPixels(meters) {
  return Math.max(0, Number(meters) || 0) * PX_PER_M;
}

function baseMap(prefix) {
  const majorH = [160, 332, 520, 642];
  const majorV = [120, 312, 500, 690, 862];
  const minorH = [70, 105, 215, 265, 400, 455, 580, 690];
  const minorV = [55, 180, 235, 375, 430, 585, 620, 775, 920];
  return `
    <defs>
      <pattern id="${prefix}-grid" width="26" height="26" patternUnits="userSpaceOnUse">
        <path d="M26 0H0V26" fill="none" stroke="#dbe9e1" stroke-width="1" opacity=".55"/>
      </pattern>
      <filter id="${prefix}-shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="1.5" stdDeviation="2" flood-color="#0e2b2a" flood-opacity=".22"/>
      </filter>
    </defs>
    <rect width="${W}" height="${H}" fill="#e6f0ea"/>
    <rect width="${W}" height="${H}" fill="url(#${prefix}-grid)" opacity=".55"/>

    <path d="M0 452 C 120 408, 176 452, 252 424 S 420 356, 520 410 S 686 512, 762 462 L 762 720 L0 720Z" fill="#d9eadf" opacity=".92"/>
    <path d="M822 0 C 760 80, 800 160, 866 212 L 1000 262 L 1000 0Z" fill="#d6e8dd" opacity=".9"/>
    <ellipse cx="292" cy="244" rx="118" ry="76" fill="#cbe6d3"/>
    <ellipse cx="790" cy="566" rx="94" ry="62" fill="#cbe6d3"/>
    <ellipse cx="255" cy="590" rx="60" ry="44" fill="#cbe6d3"/>
    <g fill="#b7d9c2" opacity=".9">
      <circle cx="244" cy="216" r="6"/><circle cx="276" cy="240" r="8"/><circle cx="316" cy="210" r="5"/>
      <circle cx="344" cy="256" r="7"/><circle cx="290" cy="278" r="5"/><circle cx="768" cy="548" r="7"/>
      <circle cx="812" cy="576" r="5"/><circle cx="778" cy="598" r="6"/><circle cx="238" cy="580" r="5"/>
      <circle cx="270" cy="602" r="7"/>
    </g>

    <path d="M636 -30 C 654 90, 620 176, 596 260 S 560 420, 626 512 S 744 640, 754 760"
      fill="none" stroke="#b7ddea" stroke-width="62" stroke-linecap="round"/>
    <path d="M636 -30 C 654 90, 620 176, 596 260 S 560 420, 626 512 S 744 640, 754 760"
      fill="none" stroke="#9fd1e4" stroke-width="46" stroke-linecap="round"/>
    <path d="M596 260 C 662 250, 706 214, 742 168" fill="none" stroke="#b7ddea" stroke-width="30" stroke-linecap="round"/>
    <path d="M596 260 C 662 250, 706 214, 742 168" fill="none" stroke="#9fd1e4" stroke-width="21" stroke-linecap="round"/>
    <ellipse cx="756" cy="150" rx="58" ry="36" fill="#9fd1e4"/>
    <ellipse cx="756" cy="150" rx="58" ry="36" fill="none" stroke="#8cc6dd" stroke-width="2"/>

    <g stroke="#d2e3da" stroke-width="15" stroke-linecap="round">
      ${majorH.map((y) => `<line x1="-10" y1="${y}" x2="${W + 10}" y2="${y}"/>`).join('')}
      ${majorV.map((x) => `<line x1="${x}" y1="-10" x2="${x}" y2="${H + 10}"/>`).join('')}
      <line x1="-20" y1="700" x2="${W + 20}" y2="188"/>
      <line x1="196" y1="-20" x2="734" y2="${H + 20}"/>
    </g>
    <g stroke="#ffffff" stroke-width="9" stroke-linecap="round">
      ${majorH.map((y) => `<line x1="-10" y1="${y}" x2="${W + 10}" y2="${y}"/>`).join('')}
      ${majorV.map((x) => `<line x1="${x}" y1="-10" x2="${x}" y2="${H + 10}"/>`).join('')}
      <line x1="-20" y1="700" x2="${W + 20}" y2="188"/>
      <line x1="196" y1="-20" x2="734" y2="${H + 20}"/>
    </g>
    <g stroke="#f6fbf8" stroke-width="4" stroke-linecap="round" opacity=".95">
      ${minorH.map((y) => `<line x1="-10" y1="${y}" x2="${W + 10}" y2="${y}"/>`).join('')}
      ${minorV.map((x) => `<line x1="${x}" y1="-10" x2="${x}" y2="${H + 10}"/>`).join('')}
    </g>

    <g stroke="#8a9c95" stroke-width="3" stroke-dasharray="12 7" opacity=".55">
      <line x1="-10" y1="258" x2="${W + 10}" y2="662"/>
    </g>
    <g stroke="#e9f1ed" stroke-width="2" opacity=".8">
      ${Array.from({ length: 34 }, (_, i) => {
        const t = i / 34;
        const x = -10 + t * (W + 20);
        const y = 258 + t * 404;
        return `<line x1="${x - 5}" y1="${y - 8}" x2="${x + 5}" y2="${y + 8}"/>`;
      }).join('')}
    </g>

    <g transform="translate(556 302) rotate(-24)">
      <rect x="-26" y="-15" width="52" height="30" rx="3" fill="#e8d9b8" stroke="#c9b689" stroke-width="2"/>
      <line x1="-26" y1="0" x2="26" y2="0" stroke="#c9b689" stroke-width="1.5"/>
    </g>

    <g fill="#8ba39b" font-family="Segoe UI, system-ui, sans-serif" font-size="13" font-weight="650" letter-spacing="1.4">
      <text x="418" y="330">RIVERSIDE</text>
      <text x="292" y="112">NORTH MARKET</text>
      <text x="122" y="420">WESTFIELD</text>
      <text x="736" y="430">EAST DEPOT</text>
      <text x="396" y="560">OLD TOWN</text>
      <text x="646" y="648">CIVIC CENTRE</text>
      <text x="468" y="700">DOCK ROAD</text>
      <text x="812" y="318">HOSPITAL DISTRICT</text>
    </g>
    <g fill="#8ba39b" font-family="Segoe UI, system-ui, sans-serif" font-size="10.5" font-style="italic" letter-spacing=".5" opacity=".9">
      <text x="676" y="238" transform="rotate(76 676 238)">Riverport River</text>
      <text x="705" y="150">Mill Pond</text>
      <text x="246" y="238">Central Park</text>
      <text x="792" y="574">South Gardens</text>
    </g>

    <g transform="translate(944 70)" opacity=".75">
      <circle r="20" fill="#fff" stroke="#cfe0d8"/>
      <path d="M0 -13 L5 4 L0 1 L-5 4 Z" fill="#0f766e"/>
      <text y="17" text-anchor="middle" font-size="9" fill="#5f7672" font-weight="700">N</text>
    </g>
  `;
}

function categoryColor(cat) {
  return categoryMeta(cat).color;
}

function markerOffset(complaint, index) {
  // Small deterministic offset so reports at identical coordinates remain clickable.
  const seed = Number(complaint.id) || index + 1;
  const angle = (seed * 137.508 * Math.PI) / 180;
  const radius = seed % 3 === 0 ? 7 : 0;
  return { dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius };
}

function markersSvg(complaints, selectedId) {
  return complaints.map((c, index) => {
    const p = project(c.lat, c.lng);
    if (!p) return '';
    const off = markerOffset(c, index);
    const x = p.x + off.dx;
    const y = p.y + off.dy;
    const color = categoryColor(c.category);
    const selected = selectedId != null && (String(selectedId) === String(c.id) || String(selectedId) === String(c.publicId));
    const critical = (c.priority || c.finalPriority || c.recommendedPriority) === 'critical';
    const status = c.status || '';
    const dim = status === 'rejected' || c.mergedInto;
    return `<g class="map-marker" data-id="${escapeHtml(c.id ?? c.publicId)}" tabindex="0" role="button"
        aria-label="${escapeHtml(c.publicId || 'Complaint')}: ${escapeHtml(categoryMeta(c.category).short)} in ${escapeHtml(c.area || c.address || 'unknown area')}"
        transform="translate(${x.toFixed(1)} ${y.toFixed(1)})" opacity="${dim ? 0.4 : 1}">
      <title>${escapeHtml(c.publicId || 'Complaint')} — ${escapeHtml(c.categoryLabel || categoryMeta(c.category).short)} — ${escapeHtml(c.area || c.address || 'Unlocated')}</title>
      ${critical ? `<circle r="15" fill="none" stroke="#dc2626" stroke-width="2" opacity=".6">
        <animate attributeName="r" values="10;19;10" dur="2.4s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values=".65;0;.65" dur="2.4s" repeatCount="indefinite"/>
      </circle>` : ''}
      ${selected ? `<circle r="14" fill="none" stroke="#0e2b2a" stroke-width="2.4"/>` : ''}
      <circle r="6.4" fill="${color}" stroke="#fff" stroke-width="1.8" filter="url(#${c.__prefix || 'map'}-shadow)"/>
      <circle r="2" fill="#fff" opacity=".9"/>
    </g>`;
  }).join('');
}

function hotspotsSvg(hotspots, show) {
  if (!show) return '';
  return hotspots.map((h, index) => {
    const center = h.center || { lat: h.centerLat, lng: h.centerLng };
    const p = project(center.lat, center.lng);
    if (!p) return '';
    const r = Math.max(10, metersToPixels(h.radiusM || 300));
    return `<g class="map-hotspot" data-hotspot="${index}">
      <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}"
        fill="rgba(124,58,237,.09)" stroke="#7c3aed" stroke-width="1.6" stroke-dasharray="6 5"/>
      <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${Math.min(7, r / 4 + 2).toFixed(1)}" fill="#7c3aed" opacity=".75"/>
      <title>Hotspot: ${escapeHtml(String(h.count || h.complaintCount || ''))} reports within ${escapeHtml(formatDistance(h.radiusM))}</title>
    </g>`;
  }).join('');
}

function pickSvg(value, prefix) {
  if (!value || value.lat == null || value.lng == null) {
    return `<g class="pick-hint" aria-hidden="true">
      <circle cx="${W / 2}" cy="${H / 2}" r="18" fill="none" stroke="#0f766e" stroke-width="2" stroke-dasharray="3 4" opacity=".5"/>
      <path d="M${W / 2 - 28} ${H / 2}h56M${W / 2} ${H / 2 - 28}v56" stroke="#0f766e" stroke-width="1.3" opacity=".45"/>
    </g>`;
  }
  const p = project(value.lat, value.lng);
  if (!p) return '';
  return `<g class="pick-marker">
    <line x1="${p.x}" y1="0" x2="${p.x}" y2="${H}" stroke="#0f766e" stroke-width="1" stroke-dasharray="4 6" opacity=".55"/>
    <line x1="0" y1="${p.y}" x2="${W}" y2="${p.y}" stroke="#0f766e" stroke-width="1" stroke-dasharray="4 6" opacity=".55"/>
    <circle cx="${p.x}" cy="${p.y}" r="17" fill="rgba(14,43,42,.12)">
      <animate attributeName="r" values="14;21;14" dur="2.2s" repeatCount="indefinite"/>
    </circle>
    <path d="M${p.x} ${p.y + 8} C ${p.x - 13} ${p.y - 8}, ${p.x - 11} ${p.y - 22}, ${p.x} ${p.y - 22} C ${p.x + 11} ${p.y - 22}, ${p.x + 13} ${p.y - 8}, ${p.x} ${p.y + 8} Z"
      fill="#0e2b2a" stroke="#fff" stroke-width="1.7"/>
    <circle cx="${p.x}" cy="${p.y - 14}" r="3.6" fill="#6ee7b7"/>
  </g>`;
}

function legendSvg(compact) {
  const cats = ['roads', 'waste', 'drainage', 'streetlights', 'water', 'safety', 'infrastructure', 'other'];
  return `<details class="map-legend" ${compact ? '' : 'open'}>
    <summary>Map legend</summary>
    <div class="legend-grid">
      ${cats.map((c) => `<span><i style="background:${categoryColor(c)}"></i>${escapeHtml(categoryMeta(c).short)}</span>`).join('')}
      <span><i class="ring"></i>Hotspot</span>
    </div>
  </details>`;
}

/**
 * Mount a map. Returns a controller with update / reset / setPick / destroy.
 */
export function createMap(container, options = {}) {
  const opts = {
    complaints: [],
    hotspots: [],
    selectedId: null,
    interactive: true,
    compact: false,
    showHotspots: true,
    pickMode: false,
    value: null,
    legend: true,
    onSelect: null,
    onPick: null,
    ...options,
  };
  if (!container) return null;
  const prefix = `map${++mapSeq}`;
  const canvas = document.createElement('div');
  canvas.className = `map-canvas${opts.pickMode ? ' is-pick' : ''}`;
  let showHotspots = Boolean(opts.showHotspots);
  let complaints = opts.complaints || [];
  let hotspots = opts.hotspots || [];
  let selectedId = opts.selectedId;
  let pick = opts.value || null;
  let view = { x: 0, y: 0, w: W, h: H };
  let drag = null;
  let suppressClick = false;

  canvas.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="application" aria-label="Schematic city map of complaint locations">
      <g id="${prefix}-world">
        <g class="map-base">${baseMap(prefix)}</g>
        <g class="map-hotspots">${hotspotsSvg(hotspots, showHotspots)}</g>
        <g class="map-markers">${markersSvg(complaints.map((c) => ({ ...c, __prefix: prefix })), selectedId)}</g>
        <g class="map-pick">${pickSvg(pick, prefix)}</g>
      </g>
    </svg>
    ${opts.interactive ? `<div class="map-tools" role="group" aria-label="Map controls">
      <button type="button" data-map-zoom="in" aria-label="Zoom in">+</button>
      <button type="button" data-map-zoom="out" aria-label="Zoom out">−</button>
      <button type="button" data-map-reset aria-label="Reset map" title="Reset map">⟲</button>
    </div>` : ''}
    ${opts.legend && !opts.compact ? legendSvg(opts.compact) : ''}
    <div class="map-popup" hidden></div>
  `;
  container.append(canvas);
  const svg = canvas.querySelector('svg');
  const world = canvas.querySelector(`#${prefix}-world`);
  const popup = canvas.querySelector('.map-popup');
  const MARKER_GROUP = canvas.querySelector('.map-markers');
  const HOTSPOT_GROUP = canvas.querySelector('.map-hotspots');
  const PICK_GROUP = canvas.querySelector('.map-pick');

  function applyView() {
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
  }

  function renderMarkers() {
    MARKER_GROUP.innerHTML = markersSvg(complaints.map((c) => ({ ...c, __prefix: prefix })), selectedId);
  }

  function renderHotspots() {
    HOTSPOT_GROUP.innerHTML = hotspotsSvg(hotspots, showHotspots);
  }

  function renderPick() {
    PICK_GROUP.innerHTML = pickSvg(pick, prefix);
  }

  function showPopup(complaint) {
    if (!popup || !complaint) return;
    const pri = complaint.priority || complaint.finalPriority || complaint.recommendedPriority;
    popup.innerHTML = `
      <button type="button" class="close" data-popup-close aria-label="Close details">${'&#10005;'}</button>
      <div class="row" style="gap:.35rem;margin-bottom:.35rem">
        <span class="badge badge--muted"><i class="cat-dot" style="background:${categoryColor(complaint.category)}"></i>${escapeHtml(categoryMeta(complaint.category).short)}</span>
        ${pri ? `<span class="badge badge--${escapeHtml(pri)}">${escapeHtml(priorityMeta(pri).label)}</span>` : ''}
        <span class="badge badge--${escapeHtml(complaint.status)}">${escapeHtml(statusMeta(complaint.status).label)}</span>
      </div>
      <h4>${escapeHtml(complaint.publicId)}</h4>
      <p>${escapeHtml(complaint.description || '')}</p>
      <div class="row">
        <a class="btn btn-sm btn-secondary" href="#/admin/complaints/${encodeURIComponent(complaint.id)}">Open report</a>
        <span class="text-xs text-muted">${escapeHtml(complaint.area || complaint.address || '')}</span>
      </div>`;
    popup.hidden = false;
    popup.querySelector('[data-popup-close]').addEventListener('click', () => { popup.hidden = true; });
  }

  function selectComplaint(complaint) {
    if (!complaint) return;
    selectedId = complaint.id ?? complaint.publicId;
    renderMarkers();
    if (!opts.compact) showPopup(complaint);
    opts.onSelect?.(complaint);
  }

  function localPoint(evt) {
    const rect = svg.getBoundingClientRect();
    const x = ((evt.clientX - rect.left) / rect.width) * view.w + view.x;
    const y = ((evt.clientY - rect.top) / rect.height) * view.h + view.y;
    return { x, y };
  }

  function clampView() {
    const minW = 160;
    const maxW = W;
    view.w = Math.min(maxW, Math.max(minW, view.w));
    view.h = view.w * (H / W);
    view.x = Math.max(0, Math.min(W - view.w, view.x));
    view.y = Math.max(0, Math.min(H - view.h, view.y));
    applyView();
  }

  function zoom(factor, anchorX = W / 2, anchorY = H / 2) {
    const newW = view.w / factor;
    const ratio = newW / view.w;
    view.x = anchorX - (anchorX - view.x) * ratio;
    view.y = anchorY - (anchorY - view.y) * ratio;
    view.w = newW;
    view.h = newW * (H / W);
    clampView();
  }

  if (opts.interactive) {
    svg.addEventListener('wheel', (event) => {
      event.preventDefault();
      const p = localPoint(event);
      zoom(event.deltaY < 0 ? 1.18 : 1 / 1.18, p.x, p.y);
    }, { passive: false });

    svg.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const p = localPoint(event);
      drag = { startX: event.clientX, startY: event.clientY, x: p.x, y: p.y, moved: false };
      svg.setPointerCapture?.(event.pointerId);
    });

    svg.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (!drag.moved) return;
      const rect = svg.getBoundingClientRect();
      view.x = drag.x - ((event.clientX - rect.left) / rect.width) * view.w;
      view.y = drag.y - ((event.clientY - rect.top) / rect.height) * view.h;
      clampView();
      svg.classList.add('is-dragging');
    });

    svg.addEventListener('pointerup', (event) => {
      if (!drag) return;
      const wasDrag = drag.moved;
      drag = null;
      svg.classList.remove('is-dragging');
      if (wasDrag) {
        suppressClick = true;
        setTimeout(() => { suppressClick = false; }, 50);
        return;
      }
      const marker = event.target.closest?.('.map-marker');
      if (marker) return;
      if (opts.pickMode) {
        const p = localPoint(event);
        const coords = unproject(p.x, p.y);
        pick = coords;
        renderPick();
        opts.onPick?.(coords);
      }
    });

    svg.addEventListener('pointercancel', () => {
      drag = null;
      svg.classList.remove('is-dragging');
    });

    svg.addEventListener('click', (event) => {
      if (suppressClick) return;
      const marker = event.target.closest?.('.map-marker');
      if (marker) {
        const id = marker.getAttribute('data-id');
        const complaint = complaints.find((c) => String(c.id) === id || String(c.publicId) === id);
        if (complaint) selectComplaint(complaint);
      }
    });

    svg.addEventListener('keydown', (event) => {
      const marker = event.target.closest?.('.map-marker');
      if (marker && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        const id = marker.getAttribute('data-id');
        const complaint = complaints.find((c) => String(c.id) === id || String(c.publicId) === id);
        if (complaint) selectComplaint(complaint);
      }
    });

    canvas.querySelector('[data-map-zoom="in"]')?.addEventListener('click', (e) => { e.stopPropagation(); zoom(1.35); });
    canvas.querySelector('[data-map-zoom="out"]')?.addEventListener('click', (e) => { e.stopPropagation(); zoom(1 / 1.35); });
    canvas.querySelector('[data-map-reset]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      view = { x: 0, y: 0, w: W, h: H };
      applyView();
      popup.hidden = true;
    });
  }

  // Prevent marker clicks from starting a drag selection.
  svg.addEventListener('pointerdown', (event) => {
    if (event.target.closest?.('.map-marker')) event.stopPropagation();
  }, true);

  return {
    element: canvas,
    update(next = {}) {
      if (next.complaints) { complaints = next.complaints; renderMarkers(); }
      if (next.hotspots) { hotspots = next.hotspots; renderHotspots(); }
      if (next.selectedId !== undefined) { selectedId = next.selectedId; renderMarkers(); }
      if (next.showHotspots !== undefined) { showHotspots = next.showHotspots; renderHotspots(); }
      if (next.value !== undefined) { pick = next.value; renderPick(); }
      if (next.popup === false) popup.hidden = true;
    },
    setPick(value) {
      pick = value;
      renderPick();
    },
    reset() {
      view = { x: 0, y: 0, w: W, h: H };
      applyView();
    },
    zoomBy(factor) { zoom(factor); },
    destroy() { canvas.remove(); },
  };
}

/** A small static map for the landing page (no interaction, decorative). */
export function heroMap(container, complaints = [], hotspots = []) {
  return createMap(container, {
    complaints,
    hotspots,
    interactive: false,
    compact: true,
    legend: false,
    showHotspots: true,
  });
}
