/**
 * Dependency-free SVG charts. Every chart is responsive (viewBox + width 100%)
 * and exposes a text alternative via role="img" / <title>.
 */
import { html, raw, escapeHtml, formatNumber, formatDate } from './ui.js';

let gradientSeq = 0;

function niceMax(value) {
  if (!value || value <= 0) return 4;
  const power = 10 ** Math.floor(Math.log10(value));
  const scaled = value / power;
  const step = scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * power;
}

/** Multi-series line chart for the daily complaint timeline. */
export function lineChart(series = [], {
  height = 210,
  color = '#0f766e',
  secondary = '#16a34a',
  showSecondary = true,
  label = 'Complaints over time',
} = {}) {
  const width = 640;
  const pad = { top: 14, right: 12, bottom: 26, left: 30 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const data = series.length ? series : [{ date: '', count: 0, resolved: 0 }];
  const maxRaw = Math.max(1, ...data.map((d) => Math.max(d.count || 0, showSecondary ? d.resolved || 0 : 0)));
  const max = niceMax(maxRaw);
  const x = (i) => pad.left + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v) => pad.top + innerH - ((Number(v) || 0) / max) * innerH;

  const line = (key) => data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ');
  const area = `${line('count')} L${x(data.length - 1).toFixed(1)},${pad.top + innerH} L${x(0).toFixed(1)},${pad.top + innerH} Z`;
  const gridValues = [0, 0.25, 0.5, 0.75, 1];
  const labelEvery = Math.max(1, Math.ceil(data.length / 6));
  const gid = `area-${++gradientSeq}`;
  const total = data.reduce((sum, d) => sum + (d.count || 0), 0);
  const totalResolved = data.reduce((sum, d) => sum + (d.resolved || 0), 0);

  const svg = `
    <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(label)}. ${total} complaints, ${totalResolved} resolved.">
      <defs>
        <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.22"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0.01"/>
        </linearGradient>
      </defs>
      <g class="chart-grid">
        ${gridValues.map((f) => {
          const yy = pad.top + innerH - f * innerH;
          const value = Math.round(max * f);
          return `<line x1="${pad.left}" y1="${yy}" x2="${width - pad.right}" y2="${yy}"/>
            <text x="${pad.left - 8}" y="${yy + 3}" text-anchor="end" class="chart-axis">${value}</text>`;
        }).join('')}
      </g>
      <path d="${area}" fill="url(#${gid})"/>
      <path d="${line('count')}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
      ${showSecondary ? `<path d="${line('resolved')}" fill="none" stroke="${secondary}" stroke-width="1.8" stroke-dasharray="5 4" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
      ${data.map((d, i) => (i === data.length - 1
        ? `<circle cx="${x(i)}" cy="${y(d.count)}" r="3.4" fill="#fff" stroke="${color}" stroke-width="2.2"/>`
        : '')).join('')}
      <g>
        ${data.map((d, i) => {
          if (i % labelEvery !== 0 && i !== data.length - 1) return '';
          const dt = d.date ? new Date(`${d.date}T00:00:00`) : null;
          const text = dt && !Number.isNaN(dt.getTime())
            ? dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
            : '';
          return `<text x="${x(i)}" y="${height - 6}" text-anchor="middle" class="chart-axis">${escapeHtml(text)}</text>`;
        }).join('')}
      </g>
    </svg>`;

  return raw(svg);
}

/** Compact sparkline used inside stat cards. */
export function sparkline(values = [], { color = '#0f766e', height = 46 } = {}) {
  const width = 220;
  const max = Math.max(1, ...values.map((v) => Number(v) || 0));
  const n = Math.max(2, values.length);
  const points = values.map((v, i) => {
    const x = (i / (n - 1)) * width;
    const y = height - 4 - ((Number(v) || 0) / max) * (height - 10);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return raw(`<svg class="spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.8"/>
  </svg>`);
}

/** Donut chart with a centre value and an optional legend beneath. */
export function donutChart(segments = [], {
  size = 168,
  thickness = 18,
  centerLabel = 'Total',
  legend = true,
} = {}) {
  const total = segments.reduce((sum, s) => sum + (Number(s.count) || 0), 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const gap = total > 0 ? 2.2 : 0;
  let offset = 0;
  const circles = segments.map((s) => {
    const count = Number(s.count) || 0;
    const share = total > 0 ? count / total : 0;
    const length = Math.max(0, share * circumference - gap);
    const circle = `<circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="${escapeHtml(s.color || '#14948a')}" stroke-width="${thickness}"
      stroke-dasharray="${length.toFixed(2)} ${(circumference - length).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"
      stroke-linecap="butt" transform="rotate(-90 ${size / 2} ${size / 2})"><title>${escapeHtml(s.label)}: ${count}</title></circle>`;
    offset += share * circumference;
    return circle;
  }).join('');

  const svg = `
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${escapeHtml(centerLabel)} breakdown: ${segments.map((s) => `${escapeHtml(s.label)} ${s.count}`).join(', ')}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="#eef4f1" stroke-width="${thickness}"/>
      ${circles}
      <text x="${size / 2}" y="${size / 2 - 2}" text-anchor="middle" style="font-size:${size * 0.19}px;font-weight:750;fill:#0f2423">${formatNumber(total)}</text>
      <text x="${size / 2}" y="${size / 2 + size * 0.11}" text-anchor="middle" style="font-size:${size * 0.065}px;fill:#5f7672;text-transform:uppercase;letter-spacing:0.06em">${escapeHtml(centerLabel)}</text>
    </svg>`;

  const legendHtml = legend ? html`
    <div class="chart-legend">
      ${segments.filter((s) => Number(s.count) > 0).map((s) => html`
        <span><i style="background:${s.color || '#14948a'}"></i>${s.label} <strong>${formatNumber(s.count)}</strong></span>
      `)}
    </div>` : '';

  return html`<div class="row" style="gap:1.2rem;align-items:center;justify-content:center;flex-wrap:wrap">
    ${raw(svg)}
    <div class="grow">${legendHtml}</div>
  </div>`;
}

/** Horizontal bar list for category / area / status breakdowns. */
export function barList(items = [], {
  colorFor = () => '#14948a',
  emptyMessage = 'No data yet.',
  hrefFor = null,
  labelWidth = null,
} = {}) {
  const max = Math.max(1, ...items.map((i) => Number(i.count) || 0));
  if (!items.length) {
    return html`<p class="text-small text-muted">${emptyMessage}</p>`;
  }
  return html`
    <div class="bar-list">
      ${items.map((item) => {
        const count = Number(item.count) || 0;
        const fill = raw(`<i class="bar-fill" style="width:${Math.max(count ? 3 : 0, (count / max) * 100)}%;background:${colorFor(item)}"></i>`);
        const name = escapeHtml(item.label || item.key || item.area || '');
        return html`
          <div class="bar-row" ${labelWidth ? raw(`style="grid-template-columns:minmax(${labelWidth},1.1fr) minmax(0,3fr) auto"`) : ''}>
            <span class="bar-name">${hrefFor ? html`<a href="${hrefFor(item)}" style="color:inherit;text-decoration:none">${name}</a>` : name}</span>
            <span class="bar-track">${fill}</span>
            <span class="bar-val">${formatNumber(count)}</span>
          </div>
        `;
      })}
    </div>
  `;
}

/** Simple vertical bars, used for weekly activity. */
export function columnChart(series = [], { height = 150, color = '#14948a', label = 'Activity' } = {}) {
  const width = 480;
  const pad = { top: 10, right: 6, bottom: 22, left: 6 };
  const data = series.length ? series : [{ count: 0, date: '' }];
  const max = Math.max(1, ...data.map((d) => Number(d.count) || 0));
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const gap = Math.min(6, innerW / data.length / 4);
  const barW = Math.max(2, innerW / data.length - gap);
  const total = data.reduce((s, d) => s + (Number(d.count) || 0), 0);
  return raw(`
    <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(label)}, ${total} total">
      ${data.map((d, i) => {
        const h = (Number(d.count) || 0) / max * innerH;
        const x = pad.left + i * (innerW / data.length) + gap / 2;
        const dt = d.date ? new Date(`${d.date}T00:00:00`) : null;
        const short = dt && !Number.isNaN(dt.getTime()) ? dt.toLocaleDateString(undefined, { day: 'numeric' }) : '';
        return `<rect x="${x}" y="${pad.top + innerH - h}" width="${barW}" height="${Math.max(1, h)}" rx="2.5" fill="${color}" opacity="${0.55 + 0.45 * ((Number(d.count) || 0) / max)}"><title>${escapeHtml(d.date || '')}: ${Number(d.count) || 0}</title></rect>
          <text x="${x + barW / 2}" y="${height - 6}" text-anchor="middle" class="chart-axis">${escapeHtml(short)}</text>`;
      }).join('')}
    </svg>`);
}

/** A labelled meter used for similarity / confidence. */
export function meter(value, { max = 1, color = '#14948a', label = '' } = {}) {
  const pct = Math.max(0, Math.min(100, (Number(value) / max) * 100));
  return html`
    <span class="similarity" title="${label || `${Math.round(pct)}%`}">
      ${label ? html`<span>${label}</span>` : ''}
      <span class="meter"><i style="width:${pct}%;background:${color}"></i></span>
    </span>
  `;
}

export { niceMax, formatDate };
