/**
 * Citizen-facing pages.
 */
import { api } from '../api.js';
import {
  html, raw, icon, escapeHtml, formatDate, formatDateTime, relativeTime, formatNumber,
  formatPercent, formatDistance, formatDays, categoryMeta, categoryLabel, statusMeta, categoryBadge, statusBadge,
  priorityBadge, statusStepper, timeline, emptyState, toast, copyText, setFormAlert, setBusy,
  trackedReports, rememberTracking, forgetTracking, findTracked, openImageModal, confirmDialog,
  initials, pluralize,
} from '../ui.js';
import { lineChart, donutChart, barList } from '../charts.js';
import { createMap, heroMap } from '../map.js';

const safe = async (promise, fallback = null) => {
  try { return await promise; } catch { return fallback; }
};

/* ========================================================================== */
/* Home                                                                       */
/* ========================================================================== */

export async function renderHome(ctx) {
  const [stats, hotspotData] = await Promise.all([
    safe(api.publicStats()),
    safe(api.publicHotspots(), { hotspots: [] }),
  ]);
  const summary = stats?.summary || null;
  const hotspots = hotspotData?.hotspots || [];
  const recentResolved = stats?.recentResolved || [];
  const categoryCounts = new Map((stats?.byCategory || []).map((c) => [c.key, c.count]));
  const categories = ctx.state.meta?.categories || Object.keys(categoryMeta).map((key) => ({ key, label: categoryLabel(key) }));
  const featured = recentResolved[0] || null;
  const categoriesWithCounts = categories.map((c) => ({ ...c, count: categoryCounts.get(c.key) || 0 }));

  return {
    title: 'CivicAI — From complaints to action',
    html: html`
      <section class="hero">
        <div class="wrap hero-inner">
          <div class="hero-copy">
            <span class="hero-eyebrow">${icon('sparkles')} Civic intelligence, explainable by design</span>
            <h1>Report a civic problem.<br /><em>See it become action.</em></h1>
            <p class="hero-lead">
              CivicAI turns scattered complaints into prioritised, trackable public work. Every report is
              analysed transparently, every duplicate is reviewed by a human, and every citizen gets a
              private tracking code.
            </p>
            <div class="hero-actions">
              <a class="btn btn-mint btn-lg" href="#/report">${icon('send')} Report an issue</a>
              <a class="btn btn-secondary btn-lg" href="#/track">${icon('search')} Track a report</a>
            </div>
            <div class="hero-points">
              <span class="hero-point">${icon('shield')}<span>Anonymous tracking with a private code</span></span>
              <span class="hero-point">${icon('sparkles')}<span>AI-assisted, clearly labelled, never invented</span></span>
              <span class="hero-point">${icon('users')}<span>Human review before any merge or closure</span></span>
            </div>
          </div>
          <div class="hero-visual" aria-hidden="true">
            <div class="hero-float hero-float--tl">
              <span class="avatar">${initials(summary ? 'Live city' : 'CivicAI')}</span>
              <div><strong>Live civic map</strong><small>${hotspots.length ? pluralize(hotspots.length, 'hotspot') + ' detected' : 'Proximity clustering'}</small></div>
            </div>
            <div class="hero-card">
              <div class="hero-card-top">
                <div><strong>${escapeHtml(ctx.state.meta?.cityName || 'Riverport')} activity</strong><br /><small>Computed from stored reports</small></div>
                <span class="badge badge--ai badge--dot">${icon('activity')} live</span>
              </div>
              <div class="hero-mini-map" id="heroMap"></div>
              <div class="row" style="margin-top:.8rem;justify-content:space-between">
                <span class="text-xs text-muted">${summary ? `${formatNumber(summary.total)} public reports` : 'Connecting to city data…'}</span>
                <a class="text-xs" href="#/public">Open public dashboard ${icon('arrow-up-right', 'icon-sm')}</a>
              </div>
            </div>
            <div class="hero-float hero-float--br">
              <span class="ping" aria-hidden="true"></span>
              <div>
                <strong>${featured ? 'Recently resolved' : 'Transparent by default'}</strong>
                <small>${featured ? escapeHtml(featured.public_id + ' · ' + (featured.area || categoryLabel(featured.category))) : 'Every update is timestamped'}</small>
              </div>
            </div>
          </div>
        </div>
        <div class="stats-band">
          <div class="wrap stats-band-inner">
            <div class="band-stat">${icon('clipboard')}<div><strong>${summary ? formatNumber(summary.total) : '—'}</strong><span>Public reports</span></div></div>
            <div class="band-stat">${icon('check-circle')}<div><strong>${summary ? formatPercent(summary.resolutionRate, 0) : '—'}</strong><span>Resolved rate</span></div></div>
            <div class="band-stat">${icon('activity')}<div><strong>${summary ? formatNumber(summary.active) : '—'}</strong><span>Active work</span></div></div>
            <div class="band-stat">${icon('clock')}<div><strong>${summary?.avgResolutionDays != null ? formatDays(summary.avgResolutionDays) : '—'}</strong><span>Average resolution</span></div></div>
          </div>
        </div>
      </section>

      <main id="main">
        <section class="section">
          <div class="wrap">
            <div class="section-head">
              <div>
                <span class="eyebrow text-xs" style="color:var(--teal-600);font-weight:700;letter-spacing:.08em;text-transform:uppercase">What can you report?</span>
                <h2>Eight everyday civic issues. One clear process.</h2>
                <p>Choose a category or let the system suggest one from your description. You can always correct it during admin review.</p>
              </div>
              <a class="btn btn-secondary" href="#/report">Start a report ${icon('arrow-right')}</a>
            </div>
            <div class="cat-grid">
              ${categoriesWithCounts.map((c) => {
                const meta = categoryMeta(c.key);
                return html`
                  <a class="cat-card" href="#/report?category=${encodeURIComponent(c.key)}" style="--cat:${meta.color}">
                    <span class="cat-icon">${icon(meta.icon)}</span>
                    <strong>${c.label}</strong>
                    <small>${stats ? pluralize(c.count, 'public report') : 'Report an issue'}</small>
                  </a>
                `;
              })}
            </div>
          </div>
        </section>

        <section class="section" style="background:linear-gradient(180deg,#fff, var(--canvas))">
          <div class="wrap">
            <div class="section-head">
              <div>
                <h2>From a photo and a sentence to a work order</h2>
                <p>A transparent pipeline: citizens report, rules and optional AI assist, humans decide.</p>
              </div>
            </div>
            <div class="steps">
              <article class="card step-card">
                <div class="step-num">1</div>
                <h3>Describe and locate</h3>
                <p>Add a description, a photo if you have one, and an address or map pin. No account is required, and you receive a private tracking code.</p>
              </article>
              <article class="card step-card">
                <div class="step-num">2</div>
                <h3>Assisted, explainable triage</h3>
                <p>Local rules (or an optional AI provider) suggest a category, summary and priority. Similar nearby reports become <strong>review candidates</strong> — never automatic merges.</p>
              </article>
              <article class="card step-card">
                <div class="step-num">3</div>
                <h3>Track the response</h3>
                <p>The civic team reviews, assigns and resolves. Every status change and public update is timestamped and visible with your tracking code.</p>
              </article>
            </div>
            <div class="ai-note mt-3">
              ${icon('sparkles')}
              <div>
                <strong>Transparency, not oracle claims.</strong> CivicAI never presents an automated guess as a verified fact.
                When no AI provider is configured, it uses local, inspectable rules and labels the result as such. Priority is a
                recommendation that administrators can override, with a recorded reason.
              </div>
            </div>
          </div>
        </section>

        <section class="section">
          <div class="wrap split">
            <div class="card">
              <div class="card-head">
                <div><h3>Recently resolved</h3><p>Public outcomes pulled live from the complaint database.</p></div>
                <a class="btn btn-sm btn-secondary" href="#/public">Public dashboard ${icon('arrow-up-right')}</a>
              </div>
              <div class="card-body">
                ${recentResolved.length ? recentResolved.slice(0, 5).map((r) => html`
                  <div class="resolved-item">
                    <span class="icon-wrap">${icon('check')}</span>
                    <div class="grow">
                      <strong>${escapeHtml(r.area || categoryLabel(r.category))}</strong>
                      <p class="clamp-2">${r.resolution_details || 'Resolved after inspection.'}</p>
                      <div class="meta-line mt-1">
                        ${categoryBadge(r.category)}
                        <span>${icon('calendar')} ${formatDate(r.resolved_at)}</span>
                        <span class="mono">${escapeHtml(r.public_id)}</span>
                      </div>
                    </div>
                  </div>
                `) : emptyState({ title: 'No resolved reports yet', message: 'New resolutions will appear here automatically once the civic team closes a report.', iconName: 'check-circle' })}
              </div>
            </div>
            <div class="card">
              <div class="card-head">
                <div><h3>Proximity hotspots</h3><p>DBSCAN clusters from real coordinates.</p></div>
                <span class="badge badge--dupe">${icon('map')} ${hotspots.length}</span>
              </div>
              <div class="card-body">
                ${hotspots.length ? hotspots.slice(0, 3).map((h) => html`
                  <div class="hotspot-mini">
                    <div class="hotspot-count">${h.count}<small>reports</small></div>
                    <div>
                      <strong>${escapeHtml(h.area || 'Unnamed area')}</strong>
                      <p>${escapeHtml(h.insight || '')}</p>
                      <div class="tag-list mt-1">
                        ${(h.categories || []).slice(0, 3).map((c) => html`<span class="chip">${escapeHtml(c.label || c.key)}</span>`)}
                      </div>
                    </div>
                  </div>
                `) : emptyState({ title: 'No hotspots right now', message: 'Clusters appear when several geolocated reports are close together.', iconName: 'map' })}
              </div>
              <div class="card-foot">
                Proximity is a pattern, not proof of a shared cause. Hotspots are only a prompt for inspection.
              </div>
            </div>
          </div>
        </section>

        <section class="section-tight">
          <div class="wrap">
            <div class="card card--dark" style="padding:clamp(1.4rem,3vw,2.4rem);display:flex;flex-wrap:wrap;gap:1.4rem;align-items:center;justify-content:space-between">
              <div style="max-width:62ch">
                <h2 style="margin-bottom:.3rem">Spotted something that needs fixing?</h2>
                <p style="margin:0">It takes about two minutes. Add a photo if you can — evidence helps the field team, even when image AI is not enabled.</p>
              </div>
              <div class="btn-group">
                <a class="btn btn-mint" href="#/report">${icon('send')} Report an issue</a>
                <a class="btn btn-secondary" href="#/login" style="--btn-bg:transparent;--btn-fg:#edf9f4;--btn-border:rgba(255,255,255,.24)">Staff sign in</a>
              </div>
            </div>
          </div>
        </section>
      </main>
    `,
    mount(root) {
      const el = root.querySelector('#heroMap');
      if (el) heroMap(el, [], hotspots);
    },
  };
}

/* ========================================================================== */
/* Report                                                                     */
/* ========================================================================== */

export async function renderReport(ctx) {
  const meta = ctx.state.meta || {};
  const maxMB = meta.maxImageMB || 8;
  const preselected = ctx.query.category || '';
  const categories = meta.categories || Object.keys(categoryMeta).map((key) => ({ key, label: categoryLabel(key) }));

  return {
    title: 'Report an issue — CivicAI',
    html: html`
      <main id="main">
        <section class="track-hero">
          <div class="wrap">
            <span class="eyebrow-light text-xs" style="text-transform:uppercase;letter-spacing:.1em;font-weight:700">Citizen report</span>
            <h1>Tell us what needs attention</h1>
            <p>Your report is saved before analysis begins. You will receive a complaint ID and a private tracking code — keep the code safe.</p>
          </div>
        </section>
        <section class="section">
          <div class="wrap">
            <div id="reportArea">
              <form id="reportForm" novalidate class="split" enctype="multipart/form-data">
                <div class="card">
                  <div class="card-head">
                    <div><h2 style="font-size:1.2rem;margin:0">Complaint details</h2><p>Fields marked required help the team act on your report.</p></div>
                    <span class="badge badge--muted">${icon('lock')} Private by default</span>
                  </div>
                  <div class="card-body">
                    <div class="form-alert" id="reportAlert" hidden>${icon('alert')}<span data-alert-text></span></div>
                    <div class="stack">
                      <div class="field">
                        <label class="label" for="description"><span>What is the problem? <span class="required">*</span></span><span class="counter" id="descCount">0 / 2000</span></label>
                        <textarea class="textarea" id="description" name="description" minlength="20" maxlength="2000" required
                          placeholder="Describe what you can see, how long it has been happening, and who is affected. For example: 'Waterlogging near the Main Road underpass after every rain. The water is knee-deep and pedestrians cannot cross.'"></textarea>
                        <p class="field-help">Please include the location, duration and any safety risk you noticed. Do not include personal information about other people.</p>
                        <div class="field-error" data-error-for="description" hidden></div>
                      </div>

                      <div class="form-grid">
                        <div class="field">
                          <label class="label" for="category">Category</label>
                          <select class="select" id="category" name="category">
                            <option value="auto">Let CivicAI suggest a category</option>
                            ${categories.map((c) => html`<option value="${c.key}" ${preselected === c.key ? 'selected' : ''}>${c.label}</option>`)}
                          </select>
                          <p class="field-help">A suggestion is advisory. Administrators can correct it.</p>
                        </div>
                        <div class="field">
                          <label class="label" for="area">Area / neighbourhood</label>
                          <input class="input" id="area" name="area" maxlength="100" placeholder="e.g. Riverside" autocomplete="address-level3" />
                        </div>
                        <div class="field span-2">
                          <label class="label" for="address"><span>Address or landmark <span class="required">*</span></span><span class="optional">or select a map pin</span></label>
                          <input class="input" id="address" name="address" maxlength="300" placeholder="e.g. Main Road bus stand, opposite the pharmacy" autocomplete="street-address" />
                          <div class="field-error" data-error-for="address" hidden></div>
                        </div>
                      </div>

                      <div class="field">
                        <span class="label">Photo <span class="optional">optional · JPG, PNG or WebP · max ${maxMB} MB</span></span>
                        <div id="dropzoneWrap">
                          <label class="dropzone" id="dropzone" for="image">
                            <input type="file" id="image" name="image" accept="image/jpeg,image/png,image/webp" />
                            ${icon('camera')}
                            <strong>Drop a photo here, or tap to choose</strong>
                            <small>Photos are stored privately and only shown to authorised staff or with your tracking code.</small>
                          </label>
                        </div>
                        <div class="field-error" data-error-for="image" hidden></div>
                      </div>

                      <div class="form-grid">
                        <div class="field">
                          <label class="label" for="reporterName">Your name <span class="optional">optional</span></label>
                          <input class="input" id="reporterName" name="reporterName" maxlength="80" autocomplete="name" placeholder="Anonymous" />
                        </div>
                        <div class="field">
                          <label class="label" for="reporterContact">Contact <span class="optional">optional</span></label>
                          <input class="input" id="reporterContact" name="reporterContact" maxlength="120" placeholder="Phone or email, if you want a follow-up" />
                        </div>
                      </div>

                      <div class="notice notice--mint">
                        ${icon('shield')}
                        <div>
                          <strong>Anonymous tracking.</strong> You do not need an account. The tracking code is shown once after submission;
                          anyone with both the complaint ID and code can view this report's status. It is stored only as a hash on the server.
                        </div>
                      </div>

                      <div class="form-actions">
                        <button class="btn btn-primary btn-lg" type="submit" id="submitReport">${icon('send')} Submit report</button>
                        <span class="text-xs text-muted">Analysis runs after the report is safely stored.</span>
                      </div>
                    </div>
                  </div>
                </div>

                <aside class="stack">
                  <div class="card">
                    <div class="card-head">
                      <div><h3>Location</h3><p>Click the map to place a precise pin.</p></div>
                    </div>
                    <div class="card-body" style="padding:0">
                      <div class="location-box" style="border:0;border-radius:0">
                        <div class="location-toolbar">
                          <button type="button" class="btn btn-sm btn-secondary" id="geoBtn">${icon('pin')} Use my location</button>
                          <span class="location-readout" id="coordReadout">No pin selected</span>
                        </div>
                        <div class="location-map" id="pinMap">
                          <span class="location-hint">Click anywhere on the map to drop a pin</span>
                        </div>
                      </div>
                    </div>
                    <div class="card-foot">Coordinates are optional when an address is provided. Geolocation asks your browser for permission.</div>
                  </div>

                  <div class="card card--mint">
                    <div class="card-body">
                      <h3 style="font-size:1rem">What happens next?</h3>
                      <ol style="margin:.5rem 0 0;padding-left:1.2rem;font-size:.84rem;color:var(--ink-2)">
                        <li>Your report is stored and assigned an ID.</li>
                        <li>Rules or optional AI suggest a category, summary and priority.</li>
                        <li>Similar nearby reports are flagged for human review.</li>
                        <li>The civic team reviews, assigns and updates the status.</li>
                      </ol>
                    </div>
                  </div>

                  <div class="ai-note">
                    ${icon('info')}
                    <div>
                      <strong>Images and AI.</strong>
                      ${meta.ai?.imageAnalysisEnabled
                        ? 'An image-analysis model is configured. Visual findings are supporting evidence only.'
                        : 'No image-analysis model is configured in this deployment. Your photo is stored as evidence but is not interpreted by AI.'}
                    </div>
                  </div>
                </aside>
              </form>
            </div>
          </div>
        </section>
      </main>
    `,
    mount(root) {
      setupReportForm(root, ctx);
    },
  };
}

function setupReportForm(root, ctx) {
  const form = root.querySelector('#reportForm');
  if (!form) return;
  const description = form.querySelector('#description');
  const count = root.querySelector('#descCount');
  const dropzone = root.querySelector('#dropzone');
  const fileInput = form.querySelector('#image');
  const dropWrap = root.querySelector('#dropzoneWrap');
  const alert = root.querySelector('#reportAlert');
  const submit = form.querySelector('#submitReport');
  const coordReadout = root.querySelector('#coordReadout');
  const geoBtn = root.querySelector('#geoBtn');
  const maxMB = ctx.state.meta?.maxImageMB || 8;
  let imageFile = null;
  let coords = null;
  let idempotencyKey = makeIdempotencyKey();

  const updateCount = () => {
    const n = description.value.length;
    count.textContent = `${n} / 2000`;
    count.classList.toggle('is-near', n > 1700 && n <= 2000);
    count.classList.toggle('is-over', n > 2000);
  };
  description.addEventListener('input', updateCount);
  updateCount();

  function setImage(file) {
    clearFieldError(form, 'image');
    if (!file) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      showFieldError(form, 'image', 'Please choose a JPG, PNG or WebP image.');
      fileInput.value = '';
      return;
    }
    if (file.size > maxMB * 1024 * 1024) {
      showFieldError(form, 'image', `That image is ${(file.size / 1048576).toFixed(1)} MB; the limit is ${maxMB} MB.`);
      fileInput.value = '';
      return;
    }
    imageFile = file;
    if (fileInput.files?.[0] !== file) {
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;
      } catch { /* assign on submit via FormData */ }
    }
    const url = URL.createObjectURL(file);
    dropWrap.innerHTML = `
      <div class="dropzone-preview">
        <img src="${url}" alt="Selected complaint photo preview" />
        <button type="button" class="remove" data-remove-image>${icon('x')} Remove</button>
      </div>`;
    dropWrap.querySelector('[data-remove-image]').addEventListener('click', (event) => {
      event.preventDefault();
      URL.revokeObjectURL(url);
      imageFile = null;
      fileInput.value = '';
      resetDropzone();
    });
  }

  function resetDropzone() {
    dropWrap.innerHTML = `
      <label class="dropzone" id="dropzone" for="image">
        <input type="file" id="image" name="image" accept="image/jpeg,image/png,image/webp" />
        ${icon('camera')}
        <strong>Drop a photo here, or tap to choose</strong>
        <small>Photos are stored privately and only shown to authorised staff or with your tracking code.</small>
      </label>`;
    const input = dropWrap.querySelector('#image');
    input.addEventListener('change', () => setImage(input.files?.[0] || null));
    bindDrop(dropWrap.querySelector('#dropzone'));
  }

  function bindDrop(zone) {
    zone.addEventListener('dragover', (event) => {
      event.preventDefault();
      zone.classList.add('is-drag');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('is-drag'));
    zone.addEventListener('drop', (event) => {
      event.preventDefault();
      zone.classList.remove('is-drag');
      const file = event.dataTransfer?.files?.[0];
      if (file) setImage(file);
    });
  }

  fileInput.addEventListener('change', () => setImage(fileInput.files?.[0] || null));
  bindDrop(dropzone);

  const map = createMap(root.querySelector('#pinMap'), {
    complaints: [],
    hotspots: [],
    interactive: true,
    compact: true,
    legend: false,
    pickMode: true,
    onPick(value) {
      coords = value;
      coordReadout.textContent = `${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}`;
      clearFieldError(form, 'address');
    },
  });

  geoBtn.addEventListener('click', () => {
    if (!navigator.geolocation) {
      toast('This browser does not support geolocation. Drop a pin on the map instead.', { type: 'info' });
      return;
    }
    setBusy(geoBtn, true, 'Locating…');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setBusy(geoBtn, false);
        coords = {
          lat: Number(position.coords.latitude.toFixed(6)),
          lng: Number(position.coords.longitude.toFixed(6)),
        };
        map.setPick(coords);
        coordReadout.textContent = `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)} (device)`;
        toast('Location added to the report.', { type: 'success' });
      },
      (error) => {
        setBusy(geoBtn, false);
        toast(
          error.code === 1
            ? 'Location permission was denied. You can still enter an address or drop a pin.'
            : 'Could not read your location. Enter an address or drop a pin instead.',
          { type: 'error' }
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setFormAlert(alert, '');
    clearAllFieldErrors(form);
    const descriptionValue = description.value.trim();
    const addressValue = form.querySelector('#address').value.trim();
    if (descriptionValue.length < 20) {
      showFieldError(form, 'description', 'Please describe the issue in at least 20 characters.');
      description.focus();
      return;
    }
    if (!addressValue && !coords) {
      showFieldError(form, 'address', 'Enter an address/landmark or select a location on the map.');
      form.querySelector('#address').focus();
      return;
    }

    const data = new FormData();
    data.set('description', descriptionValue);
    data.set('category', form.querySelector('#category').value || 'auto');
    data.set('address', addressValue);
    data.set('area', form.querySelector('#area').value.trim());
    data.set('reporterName', form.querySelector('#reporterName').value.trim());
    data.set('reporterContact', form.querySelector('#reporterContact').value.trim());
    if (coords) {
      data.set('lat', String(coords.lat));
      data.set('lng', String(coords.lng));
    }
    if (imageFile) data.set('image', imageFile, imageFile.name);

    setBusy(submit, true, 'Submitting…');
    try {
      const result = await api.submitComplaint(data, idempotencyKey);
      rememberTracking({
        complaintId: result.complaint.publicId,
        trackingCode: result.trackingCode,
        category: result.complaint.category,
        area: result.complaint.area,
        createdAt: result.complaint.createdAt,
      });
      showReportSuccess(root, ctx, result);
      toast('Report submitted. Save your tracking code.', { type: 'success', title: 'Thank you' });
    } catch (err) {
      setBusy(submit, false);
      setFormAlert(alert, err.message || 'Could not submit the report.');
      if (err.field) {
        showFieldError(form, err.field, err.message);
        form.querySelector(`[name="${err.field}"]`)?.focus();
      }
      alert.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // A retry must not create a duplicate: keep the same idempotency key.
    }
  });

  // Regenerate the key only if the page is re-entered with a fresh form.
  window.addEventListener('hashchange', () => { idempotencyKey = makeIdempotencyKey(); }, { once: true });
}

function showReportSuccess(root, ctx, result) {
  const area = root.querySelector('#reportArea');
  const c = result.complaint;
  const code = result.trackingCode;
  area.innerHTML = String(html`
    <div class="success-panel">
      <div class="success-icon">${icon('check')}</div>
      <h2>Report received</h2>
      <p>Your report is safely stored. Analysis is running in the background; the civic team will verify it before acting.</p>
      <div class="code-box">
        <span class="code-label">Complaint ID</span>
        <code>${c.publicId}</code>
        <button type="button" class="copy-btn" data-copy="${c.publicId}" aria-label="Copy complaint ID">${icon('copy')}</button>
      </div>
      <div class="code-box">
        <span class="code-label">Private tracking code — shown only once</span>
        <code>${code}</code>
        <button type="button" class="copy-btn" data-copy="${code}" aria-label="Copy tracking code">${icon('copy')}</button>
      </div>
      <div class="notice notice--warn" style="max-width:620px;margin:0 auto 1.2rem;text-align:left">
        ${icon('shield')}
        <div><strong>Save this code now.</strong> It is required, together with the complaint ID, to view private updates. The server stores only a hash of it, so it cannot be shown again.</div>
      </div>
      <div class="btn-group" style="justify-content:center">
        <a class="btn btn-primary" href="#/track?id=${encodeURIComponent(c.publicId)}&code=${encodeURIComponent(code)}">${icon('search')} Track this report</a>
        <button class="btn btn-secondary" type="button" data-report-another>${icon('plus')} Report another issue</button>
      </div>
      <div id="analysisPreview" class="mt-3" style="max-width:620px;margin-inline:auto">
        <div class="notice notice--info" style="text-align:left">${icon('clock')}<div><strong>Analysis queued.</strong> The category and priority will appear on the tracking page in a moment.</div></div>
      </div>
      ${result.urgentFlag ? html`<div class="notice notice--danger mt-2" style="max-width:620px;margin-inline:auto;text-align:left">${icon('alert')}<div><strong>Safety phrase detected.</strong> Your description mentions a possible immediate hazard. The team has been notified for urgent verification; if there is immediate danger, contact emergency services.</div></div>` : ''}
    </div>
  `);

  area.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', () => copyText(btn.dataset.copy, 'Copied'));
  });
  area.querySelector('[data-report-another]')?.addEventListener('click', () => {
    ctx.go('/report');
  });

  // Poll the private tracking endpoint briefly so the citizen can see the
  // analysis result without a page reload. Falls back silently.
  let attempts = 0;
  const poll = async () => {
    attempts += 1;
    const data = await safe(api.track(c.publicId, code));
    const preview = area.querySelector('#analysisPreview');
    if (!preview) return;
    const complaint = data?.complaint;
    if (complaint && complaint.aiStatus && complaint.aiStatus !== 'pending' && complaint.aiStatus !== 'processing') {
      preview.innerHTML = String(html`
        <div class="notice notice--mint" style="text-align:left">
          ${icon('sparkles')}
          <div>
            <strong>Initial analysis available.</strong>
            <div class="row" style="gap:.4rem;margin-top:.4rem">
              ${categoryBadge(complaint.category, complaint.categoryLabel)}
              ${priorityBadge(complaint.urgency?.key, { label: complaint.urgency?.label })}
              <span class="badge badge--${complaint.aiSource === 'ai' ? 'ai' : 'heuristic'}">${complaint.aiSource === 'ai' ? 'AI-assisted' : 'Local rules'}</span>
            </div>
            ${complaint.summary ? html`<p class="mt-1 mb-0">${complaint.summary}</p>` : ''}
            <p class="field-help mt-1 mb-0">Automated first pass only. Administrators verify all classifications and priorities.</p>
          </div>
        </div>`);
      return;
    }
    if (attempts < 5) setTimeout(poll, 2200);
  };
  setTimeout(poll, 1600);
}

function makeIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `report-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function clearFieldError(form, field) {
  const el = form.querySelector(`[data-error-for="${field}"]`);
  if (el) { el.hidden = true; el.textContent = ''; }
  form.querySelector(`[name="${field}"]`)?.removeAttribute('aria-invalid');
}

function clearAllFieldErrors(form) {
  form.querySelectorAll('[data-error-for]').forEach((el) => { el.hidden = true; el.textContent = ''; });
  form.querySelectorAll('[aria-invalid="true"]').forEach((el) => el.removeAttribute('aria-invalid'));
}

function showFieldError(form, field, message) {
  const el = form.querySelector(`[data-error-for="${field}"]`);
  const input = form.querySelector(`[name="${field}"]`);
  if (input) input.setAttribute('aria-invalid', 'true');
  if (el) {
    el.hidden = false;
    el.textContent = message;
  }
}

/* ========================================================================== */
/* Track                                                                      */
/* ========================================================================== */

export async function renderTrack(ctx) {
  const saved = trackedReports();
  return {
    title: 'Track a report — CivicAI',
    html: html`
      <section class="track-hero">
        <div class="wrap">
          <span class="eyebrow-light text-xs" style="text-transform:uppercase;letter-spacing:.1em;font-weight:700">Private tracking</span>
          <h1>Follow your report</h1>
          <p>Enter the complaint ID and the tracking code you received. Both are required to protect the privacy of the reporter.</p>
        </div>
      </section>
      <main id="main" class="section">
        <div class="wrap-narrow">
          <form id="trackForm" class="track-form" novalidate>
            <div class="field">
              <label class="label" for="complaintId">Complaint ID</label>
              <input class="input" id="complaintId" name="complaintId" placeholder="CIV-2026-XXXXXX" autocomplete="off" spellcheck="false" />
            </div>
            <div class="field">
              <label class="label" for="trackingCode">Tracking code</label>
              <input class="input" id="trackingCode" name="trackingCode" placeholder="XXXX-XXXX-XXXX" autocomplete="off" spellcheck="false" />
            </div>
            <button class="btn btn-primary" type="submit" id="trackSubmit">${icon('search')} Find report</button>
          </form>
          <div class="form-alert mt-2" id="trackAlert" hidden>${icon('alert')}<span data-alert-text></span></div>

          <div id="trackResult" class="track-result" aria-live="polite"></div>

          <div class="card mt-3">
            <div class="card-head">
              <div><h3>Reports saved on this device</h3><p>Tracking codes are stored only in this browser, never on the server in readable form.</p></div>
              <span class="badge badge--muted">${saved.length}</span>
            </div>
            <div class="card-body" id="savedList">
              ${saved.length ? saved.map((item) => html`
                <div class="saved-track" data-saved="${escapeHtml(item.complaintId)}">
                  <div class="grow">
                    <span class="mono">${escapeHtml(item.complaintId)}</span>
                    <small class="dot-sep">·</small>
                    <small>${item.area ? escapeHtml(item.area) + ' · ' : ''}saved ${relativeTime(item.savedAt || item.createdAt)}</small>
                  </div>
                  <button type="button" class="btn btn-sm btn-secondary" data-open-saved="${escapeHtml(item.complaintId)}">View</button>
                  <button type="button" class="btn btn-sm btn-ghost" data-forget="${escapeHtml(item.complaintId)}" aria-label="Forget ${escapeHtml(item.complaintId)}">${icon('trash')}</button>
                </div>
              `) : html`<p class="text-small text-muted mb-0">No reports saved yet. After submitting a report, its tracking code is kept here for convenience.</p>`}
            </div>
          </div>

          <div class="ai-note mt-2">
            ${icon('info')}
            <div><strong>Lost your code?</strong> For privacy, the civic office cannot recover tracking codes. Contact the civic office with the complaint ID if you need help; they may ask for details that only the reporter would know.</div>
          </div>
        </div>
      </main>
    `,
    mount(root) {
      const form = root.querySelector('#trackForm');
      const alert = root.querySelector('#trackAlert');
      const result = root.querySelector('#trackResult');
      const idInput = form.querySelector('#complaintId');
      const codeInput = form.querySelector('#trackingCode');
      const submit = form.querySelector('#trackSubmit');

      const lookup = async (id, code, { silent = false } = {}) => {
        setFormAlert(alert, '');
        if (!id || !code) {
          if (!silent) setFormAlert(alert, 'Enter both the complaint ID and tracking code.');
          return;
        }
        setBusy(submit, true, 'Searching…');
        result.innerHTML = '<div class="loading-block"><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-card"></div></div>';
        try {
          const data = await api.track(id, code);
          result.innerHTML = String(trackingDetail(data.complaint, { trackingCode: code.trim() }));
          bindTrackingDetail(result, data.complaint, code.trim());
        } catch (err) {
          result.innerHTML = '';
          setFormAlert(alert, err.message || 'Could not find that report.');
        } finally {
          setBusy(submit, false);
        }
      };

      form.addEventListener('submit', (event) => {
        event.preventDefault();
        lookup(idInput.value.trim().toUpperCase(), codeInput.value.trim().toUpperCase());
      });

      root.querySelectorAll('[data-open-saved]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const item = trackedReports().find((x) => x.complaintId === btn.dataset.openSaved);
          if (!item) return;
          idInput.value = item.complaintId;
          codeInput.value = item.trackingCode;
          lookup(item.complaintId, item.trackingCode);
        });
      });

      root.querySelectorAll('[data-forget]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const ok = await confirmDialog({
            title: 'Remove saved code?',
            message: 'The tracking code will be removed from this browser. You will need the code to view updates again.',
            confirmLabel: 'Remove',
            danger: true,
          });
          if (!ok) return;
          forgetTracking(btn.dataset.forget);
          btn.closest('.saved-track')?.remove();
          toast('Tracking code removed from this device.', { type: 'info' });
        });
      });

      // Deep link from the report success panel.
      if (ctx.query.id) {
        idInput.value = String(ctx.query.id).toUpperCase();
        if (ctx.query.code) {
          codeInput.value = String(ctx.query.code).toUpperCase();
          lookup(idInput.value, codeInput.value);
        } else {
          const item = findTracked(idInput.value);
          if (item?.trackingCode) {
            codeInput.value = item.trackingCode;
            lookup(idInput.value, item.trackingCode);
          }
        }
      }
    },
  };
}

export function trackingDetail(complaint, { trackingCode = null, showReporter = false } = {}) {
  const urgency = complaint.urgency || {};
  const imageUrl = complaint.imageAvailable
    ? api.imageUrl(complaint, trackingCode)
    : null;
  return html`
    <article class="card">
      <div class="detail-head">
        <div>
          <div class="id-line">
            <span class="badge badge--solid mono">${complaint.publicId}</span>
            ${statusBadge(complaint.status, complaint.statusLabel)}
            ${complaint.priorityReviewRequired ? html`<span class="badge badge--review">${icon('alert')} priority review</span>` : ''}
            ${complaint.isSynthetic ? html`<span class="badge badge--muted">Synthetic demo record</span>` : ''}
          </div>
          <h1>${complaint.area || categoryLabel(complaint.category, complaint.categoryLabel)}</h1>
          <div class="detail-meta">
            <span>${icon('calendar')} Submitted ${formatDateTime(complaint.createdAt)}</span>
            <span>${icon('refresh')} Updated ${relativeTime(complaint.updatedAt)}</span>
            ${complaint.assignedTeam ? html`<span>${icon('users')} ${complaint.assignedTeam}</span>` : ''}
            <span>${icon('map')} ${escapeHtml(complaint.address || 'No address supplied')}</span>
          </div>
        </div>
        <div class="stack-sm" style="align-items:flex-end">
          ${categoryBadge(complaint.category, complaint.categoryLabel)}
          <span class="badge badge--${urgency.key || 'pending'}">${escapeHtml(urgency.label || 'Being assessed')}</span>
          <button type="button" class="btn btn-sm btn-secondary" data-print-report>${icon('file')} Print</button>
        </div>
      </div>
      <div class="detail-body">
        ${complaint.mergedInto ? html`
          <div class="notice notice--info mb-2">
            ${icon('layers')}
            <div><strong>Tracked together with ${escapeHtml(complaint.mergedInto.publicId)}.</strong> This report was confirmed as the same issue. Updates below follow the combined record.</div>
          </div>` : ''}
        ${complaint.status === 'resolved' && complaint.resolutionDetails ? html`
          <div class="notice notice--success mb-2">
            ${icon('check-circle')}
            <div><strong>Resolution recorded ${complaint.resolvedAt ? formatDate(complaint.resolvedAt) : ''}.</strong><br />${complaint.resolutionDetails}</div>
          </div>` : ''}

        <div class="split">
          <div class="stack">
            <div>
              <h3 class="mb-1">What was reported</h3>
              <p class="detail-description">${complaint.description}</p>
            </div>
            ${complaint.summary ? html`
              <div class="ai-summary">
                <strong>Summary ${complaint.aiSource === 'ai' ? '(AI-assisted)' : '(local rules)'}</strong>
                ${complaint.summary}
              </div>` : ''}
            ${imageUrl ? html`
              <figure class="image-panel">
                <img src="${imageUrl}" alt="Photo attached to complaint ${complaint.publicId}" loading="lazy" data-track-image />
                <figcaption>Attached photo · access requires your tracking code or an authorised session.</figcaption>
              </figure>` : ''}
            ${complaint.mergedInto?.resolutionDetails ? html`
              <div class="notice notice--success">${icon('check-circle')}<div><strong>Combined resolution.</strong> ${complaint.mergedInto.resolutionDetails}</div></div>` : ''}
          </div>
          <aside class="stack">
            <div class="card card--flat" style="background:#fbfdfc">
              <div class="card-body">
                <h3 style="font-size:.98rem">Progress</h3>
                ${statusStepper(complaint.history || [], complaint.status)}
              </div>
            </div>
            <dl class="kv">
              <dt>Category</dt><dd>${complaint.categoryLabel || categoryLabel(complaint.category)}</dd>
              <dt>Urgency</dt><dd>${urgency.label || 'Being assessed'}</dd>
              <dt>Team</dt><dd>${complaint.assignedTeam || 'Not yet assigned'}</dd>
              ${complaint.resolvedAt ? html`<dt>Resolved</dt><dd>${formatDateTime(complaint.resolvedAt)}</dd>` : ''}
              ${showReporter && complaint.reporterName ? html`<dt>Reporter</dt><dd>${complaint.reporterName}</dd>` : ''}
            </dl>
            ${trackingCode ? html`
              <div class="notice notice--info">
                ${icon('lock')}
                <div><strong>Private session.</strong> Keep this tab or save the code on this device. The code is required again to view this page.</div>
              </div>` : ''}
          </aside>
        </div>

        ${(complaint.notifications || []).length ? html`
          <div class="divider"></div>
          <h3>Messages from the civic team</h3>
          <div class="stack-sm">
            ${complaint.notifications.slice(0, 5).map((n) => html`
              <div class="notice notice--mint">
                ${icon('bell')}
                <div><strong>${n.title}</strong><br />${n.body}<div class="text-xs text-muted mt-1">${formatDateTime(n.at)}</div></div>
              </div>
            `)}
          </div>
        ` : ''}

        <div class="divider"></div>
        <h3>Update history</h3>
        ${timeline(complaint.history || [])}
      </div>
    </article>
  `;
}

function bindTrackingDetail(root, complaint, trackingCode) {
  root.querySelectorAll('[data-track-image]').forEach((img) => {
    img.addEventListener('click', () => openImageModal(img.src, `Photo attached to ${complaint.publicId}`));
    img.style.cursor = 'zoom-in';
  });
  root.querySelector('[data-print-report]')?.addEventListener('click', () => window.print());
}

/* ========================================================================== */
/* Public dashboard                                                           */
/* ========================================================================== */

export async function renderPublic(ctx) {
  const [stats, hotspotData] = await Promise.all([
    safe(api.publicStats()),
    safe(api.publicHotspots(), { hotspots: [] }),
  ]);
  const hotspots = hotspotData?.hotspots || [];
  const summary = stats?.summary || null;
  const byCategory = stats?.byCategory || [];
  const byStatus = (stats?.byStatus || []).map((s) => ({
    ...s,
    label: statusMeta(s.key).label,
    color: statusMeta(s.key).color,
  }));
  const timelineSeries = stats?.timeline || [];

  return {
    title: 'Public dashboard — CivicAI',
    html: html`
      <section class="track-hero">
        <div class="wrap">
          <span class="eyebrow-light text-xs" style="text-transform:uppercase;letter-spacing:.1em;font-weight:700">Open civic data</span>
          <h1>Public accountability dashboard</h1>
          <p>Aggregate figures calculated from stored complaint records at request time. Personal details, tracking codes and private updates are never shown here.</p>
        </div>
      </section>
      <main id="main" class="section">
        <div class="wrap">
          ${!stats ? html`<div class="notice notice--warn mb-2">${icon('alert')}<div>Live statistics are temporarily unavailable. Please refresh in a moment.</div></div>` : ''}
          <div class="stat-grid">
            <div class="stat-card">
              <div class="stat-top"><span class="stat-label">Total reports</span><span class="stat-icon">${icon('clipboard')}</span></div>
              <div class="stat-value">${summary ? formatNumber(summary.total) : '—'}</div>
              <div class="stat-meta">Rejected reports excluded</div>
            </div>
            <div class="stat-card stat-card--resolved">
              <div class="stat-top"><span class="stat-label">Resolved</span><span class="stat-icon">${icon('check-circle')}</span></div>
              <div class="stat-value">${summary ? formatNumber(summary.resolved) : '—'}</div>
              <div class="stat-meta"><strong>${summary ? formatPercent(summary.resolutionRate, 1) : '—'}</strong> resolution rate</div>
            </div>
            <div class="stat-card stat-card--time">
              <div class="stat-top"><span class="stat-label">Active work</span><span class="stat-icon">${icon('activity')}</span></div>
              <div class="stat-value">${summary ? formatNumber(summary.active) : '—'}</div>
              <div class="stat-meta">Assigned, in progress or reopened</div>
            </div>
            <div class="stat-card stat-card--dupe">
              <div class="stat-top"><span class="stat-label">Hotspots</span><span class="stat-icon">${icon('map')}</span></div>
              <div class="stat-value">${summary ? formatNumber(summary.hotspots) : '—'}</div>
              <div class="stat-meta">Proximity clusters, not confirmed causes</div>
            </div>
            <div class="stat-card">
              <div class="stat-top"><span class="stat-label">Avg. resolution</span><span class="stat-icon">${icon('clock')}</span></div>
              <div class="stat-value">${summary?.avgResolutionDays != null ? formatDays(summary.avgResolutionDays) : '—'}</div>
              <div class="stat-meta">Across resolved reports</div>
            </div>
          </div>

          <div class="admin-grid mt-2">
            <div class="card chart-card">
              <div class="card-head"><div><h3>Reports received and resolved</h3><p>Last 30 days · from stored timestamps</p></div><span class="badge badge--muted">Daily</span></div>
              <div class="chart-body">
                ${lineChart(timelineSeries, { height: 230, label: 'Public reports received and resolved over 30 days' })}
                <div class="chart-legend">
                  <span><i style="background:#0f766e"></i>Received <strong>${formatNumber(timelineSeries.reduce((s, d) => s + (d.count || 0), 0))}</strong></span>
                  <span><i style="background:#16a34a"></i>Resolved <strong>${formatNumber(timelineSeries.reduce((s, d) => s + (d.resolved || 0), 0))}</strong></span>
                </div>
              </div>
            </div>
            <div class="card chart-card">
              <div class="card-head"><div><h3>Status mix</h3><p>All non-rejected public reports</p></div></div>
              <div class="chart-body">
                ${donutChart(byStatus, { centerLabel: 'Reports', size: 170 })}
                ${!byStatus.length ? html`<p class="text-small text-muted">No status data yet.</p>` : ''}
              </div>
            </div>
          </div>

          <div class="admin-grid mt-2">
            <div class="card">
              <div class="card-head"><div><h3>Reports by category</h3><p>Volume across the city</p></div></div>
              <div class="card-body">
                ${barList(byCategory.filter((c) => c.count > 0), {
                  colorFor: (item) => categoryMeta(item.key).color,
                  emptyMessage: 'No categories have reports yet.',
                })}
              </div>
            </div>
            <div class="card">
              <div class="card-head"><div><h3>Recently resolved</h3><p>Public resolution notes</p></div><a class="btn btn-sm btn-secondary" href="#/report">Report an issue</a></div>
              <div class="card-body">
                ${(stats?.recentResolved || []).length ? stats.recentResolved.map((r) => html`
                  <div class="resolved-item">
                    <span class="icon-wrap">${icon('check')}</span>
                    <div class="grow">
                      <strong>${escapeHtml(r.area || categoryLabel(r.category))}</strong>
                      <p class="clamp-2">${r.resolution_details || 'Resolved after inspection.'}</p>
                      <div class="meta-line mt-1">${categoryBadge(r.category)}<span>${formatDate(r.resolved_at)}</span></div>
                    </div>
                  </div>
                `) : emptyState({ title: 'Nothing resolved yet', message: 'Resolved reports will be listed here with their public outcome notes.', iconName: 'check-circle' })}
              </div>
            </div>
          </div>

          <div class="section-head mt-3">
            <div><h2>Where reports cluster</h2><p>DBSCAN over stored coordinates. Proximity alone does not prove a common cause; these are inspection prompts.</p></div>
            <span class="badge badge--dupe">${icon('map')} ${hotspots.length} clusters</span>
          </div>
          <div class="grid grid-3">
            ${hotspots.length ? hotspots.map((h) => html`
              <article class="hotspot-card">
                <header>
                  <div><h4>${escapeHtml(h.area || 'Unnamed area')}</h4><span class="text-xs text-muted">within ${formatDistance(h.radiusM)}</span></div>
                  <span class="hotspot-count" style="min-width:44px;height:44px;font-size:1rem">${h.count}</span>
                </header>
                <p>${escapeHtml(h.insight || '')}</p>
                <div class="tag-list">
                  ${(h.categories || []).map((c) => html`<span class="chip">${escapeHtml(c.label || c.key)} (${c.count})</span>`)}
                </div>
                ${h.suggestedAction ? html`<div class="suggested"><strong>Suggested next step</strong>${escapeHtml(h.suggestedAction)}</div>` : ''}
              </article>
            `) : html`<div class="card" style="grid-column:1/-1">${emptyState({ title: 'No hotspots detected', message: 'Several geolocated reports need to be close together before a cluster appears.', iconName: 'map' })}</div>`}
          </div>

          <div class="notice notice--info mt-3">
            ${icon('info')}
            <div><strong>About these figures.</strong> ${stats?.note || 'Figures are computed from stored records at request time.'} Duplicate-merged records remain preserved; hotspot clustering excludes merged duplicates and rejected reports.</div>
          </div>
        </div>
      </main>
    `,
    mount() {},
  };
}

/* ========================================================================== */
/* Authentication                                                             */
/* ========================================================================== */

export function renderLogin(ctx) {
  const next = ctx.query.next || '';
  return {
    title: 'Sign in — CivicAI',
    html: authLayout({
      title: 'Welcome back',
      subtitle: 'Citizens can report and track issues without an account. Sign in to manage reports or open the officer console.',
      form: html`
        <form id="loginForm" novalidate>
          <div class="form-alert" id="loginAlert" hidden>${icon('alert')}<span data-alert-text></span></div>
          <div class="notice notice--mint" style="margin-bottom:1rem">
            ${icon('shield')}
            <div>
              <strong>Officer evaluating CivicAI?</strong>
              <p class="text-xs" style="margin:.25rem 0 .6rem">Open the officer console with one click — no account or password needed in development.</p>
              <button type="button" class="btn btn-secondary btn-sm" id="demoOfficerBtn">${icon('shield')} Enter demo officer console</button>
            </div>
          </div>
          <div class="field">
            <label class="label" for="email">Email</label>
            <input class="input" id="email" name="email" type="email" autocomplete="email" required placeholder="you@example.org" />
          </div>
          <div class="field">
            <label class="label" for="password">Password</label>
            <input class="input" id="password" name="password" type="password" autocomplete="current-password" required placeholder="••••••••" />
          </div>
          <button class="btn btn-primary btn-lg btn-block" type="submit" id="loginBtn">${icon('lock')} Sign in</button>
          <p class="text-xs text-muted mb-0" style="text-align:center">Citizen accounts can view and manage their own reports. Administrators reach the full console.</p>
        </form>
      `,
      foot: html`<p class="auth-foot">New citizen account? <a href="#/signup${next ? `?next=${encodeURIComponent(next)}` : ''}">Create one</a></p>`,
      demo: true,
    }),
    mount(root) {
      const form = root.querySelector('#loginForm');
      const alert = root.querySelector('#loginAlert');
      const btn = root.querySelector('#loginBtn');
      const demoBtn = root.querySelector('#demoOfficerBtn');
      demoBtn?.addEventListener('click', async () => {
        if (demoBtn.disabled) return;
        const label = demoBtn.innerHTML;
        demoBtn.disabled = true;
        demoBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Opening console…';
        try {
          const result = await api.demoOfficer();
          ctx.setUser(result.user);
          toast(`Signed in as ${result.user.name}.`, { type: 'success', title: 'Officer console' });
          ctx.go(next && next.startsWith('/admin') ? next : '/admin');
        } catch (err) {
          demoBtn.disabled = false;
          demoBtn.innerHTML = label;
          setFormAlert(alert, err.message || 'Demo officer access is unavailable. Sign in with staff credentials instead.');
        }
      });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        setFormAlert(alert, '');
        const email = form.querySelector('#email').value.trim();
        const password = form.querySelector('#password').value;
        if (!email || !password) {
          setFormAlert(alert, 'Enter your email and password.');
          return;
        }
        setBusy(btn, true, 'Signing in…');
        try {
          const result = await api.login(email, password);
          ctx.setUser(result.user);
          toast(`Signed in as ${result.user.name}.`, { type: 'success' });
          const fallback = result.user.role === 'admin' ? '/admin' : '/my';
          const target = next && !(next.startsWith('/admin') && result.user.role !== 'admin') ? next : fallback;
          ctx.go(target);
        } catch (err) {
          setBusy(btn, false);
          setFormAlert(alert, err.message || 'Sign-in failed.');
        }
      });
    },
  };
}

export function renderSignup(ctx) {
  const next = ctx.query.next || '';
  return {
    title: 'Create an account — CivicAI',
    html: authLayout({
      title: 'Create a citizen account',
      subtitle: 'Optional — you can always report anonymously. An account keeps your reports together.',
      form: html`
        <form id="signupForm" novalidate>
          <div class="form-alert" id="signupAlert" hidden>${icon('alert')}<span data-alert-text></span></div>
          <div class="field">
            <label class="label" for="name">Full name</label>
            <input class="input" id="name" name="name" autocomplete="name" required maxlength="80" placeholder="Your name" />
          </div>
          <div class="field">
            <label class="label" for="email">Email</label>
            <input class="input" id="email" name="email" type="email" autocomplete="email" required placeholder="you@example.org" />
          </div>
          <div class="field">
            <label class="label" for="password">Password</label>
            <input class="input" id="password" name="password" type="password" autocomplete="new-password" required placeholder="At least 8 characters, with a letter and number" />
            <p class="field-help">Use at least 8 characters, including one letter and one number.</p>
          </div>
          <button class="btn btn-primary btn-lg btn-block" type="submit" id="signupBtn">${icon('users')} Create account</button>
        </form>
      `,
      foot: html`<p class="auth-foot">Already have an account? <a href="#/login${next ? `?next=${encodeURIComponent(next)}` : ''}">Sign in</a></p>`,
      demo: false,
    }),
    mount(root) {
      const form = root.querySelector('#signupForm');
      const alert = root.querySelector('#signupAlert');
      const btn = root.querySelector('#signupBtn');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        setFormAlert(alert, '');
        const name = form.querySelector('#name').value.trim();
        const email = form.querySelector('#email').value.trim();
        const password = form.querySelector('#password').value;
        if (name.length < 2) return setFormAlert(alert, 'Enter your name.');
        if (!email) return setFormAlert(alert, 'Enter your email address.');
        if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
          return setFormAlert(alert, 'Password must be at least 8 characters and include a letter and a number.');
        }
        setBusy(btn, true, 'Creating…');
        try {
          const result = await api.signup(name, email, password);
          ctx.setUser(result.user);
          toast('Account created. Welcome to CivicAI.', { type: 'success' });
          ctx.go(next && !next.startsWith('/admin') ? next : '/my');
        } catch (err) {
          setBusy(btn, false);
          setFormAlert(alert, err.message || 'Could not create the account.');
        }
      });
    },
  };
}

function authLayout({ title, subtitle, form, foot, demo }) {
  return html`
    <main id="main" class="auth-wrap">
      <aside class="auth-aside">
        <span class="hero-eyebrow">${icon('shield')} Secure civic access</span>
        <h2>One place for reports, decisions and public trust.</h2>
        <p>CivicAI keeps the citizen-facing record and the administrative workflow connected, with a timestamped audit trail for every action.</p>
        <div class="auth-features">
          <div class="auth-feature">${icon('lock')}<div><strong>Server-side sessions</strong>Passwords are scrypt-hashed; sessions use HttpOnly cookies.</div></div>
          <div class="auth-feature">${icon('layers')}<div><strong>Human-reviewed duplicates</strong>Similarity suggestions never merge records on their own.</div></div>
          <div class="auth-feature">${icon('sparkles')}<div><strong>Explainable priorities</strong>Recommendations show their factors and can be overridden with a reason.</div></div>
        </div>
      </aside>
      <div class="auth-panel">
        <div class="auth-card">
          <h1>${title}</h1>
          <p>${subtitle}</p>
          ${form}
          ${demo ? html`
            <div class="demo-hint">
              <strong>Seeded demo accounts</strong> (unless changed in <code>.env</code>):<br />
              Officer: <code>admin@civicai.local</code> / <code>CivicAI@2026</code><br />
              Citizen: <code>citizen@civicai.local</code> / <code>Citizen@2026</code><br />
              Reporting and tracking never require an account — one-click officer access is above.
            </div>` : ''}
          ${foot}
        </div>
      </div>
    </main>
  `;
}

/* ========================================================================== */
/* My reports                                                                 */
/* ========================================================================== */

export async function renderMy(ctx) {
  if (!ctx.state.user) {
    return {
      title: 'My reports — CivicAI',
      html: html`
        <main id="main" class="section">
          <div class="wrap-narrow">
            <div class="card">${emptyState({
              title: 'Sign in to see your reports',
              message: 'Your account keeps reports together, but you can also report anonymously with a private tracking code.',
              iconName: 'lock',
              action: '<a class="btn btn-primary" href="#/login?next=%2Fmy">Sign in</a> <a class="btn btn-secondary" href="#/track">Track with a code</a>',
            })}</div>
          </div>
        </main>
      `,
      mount() {},
    };
  }
  let data;
  try {
    data = await api.myComplaints();
  } catch (err) {
    return {
      title: 'My reports — CivicAI',
      html: html`<main id="main" class="section"><div class="wrap-narrow"><div class="notice notice--danger">${icon('alert')}<div>${err.message}</div></div></div></main>`,
      mount() {},
    };
  }
  const complaints = data.complaints || [];
  return {
    title: 'My reports — CivicAI',
    html: html`
      <main id="main" class="section">
        <div class="wrap">
          <div class="page-head">
            <div>
              <span class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:.08em;font-weight:700">Citizen account</span>
              <h1>My reports</h1>
              <p>Reports submitted while signed in as ${escapeHtml(ctx.state.user.name)}. Reports made anonymously are not linked to this account.</p>
            </div>
            <div class="page-actions">
              <a class="btn btn-secondary" href="#/track">${icon('search')} Track with a code</a>
              <a class="btn btn-primary" href="#/report">${icon('plus')} New report</a>
            </div>
          </div>
          ${complaints.length ? html`
            <div class="grid grid-3">
              ${complaints.map((c) => {
                const tracked = findTracked(c.publicId);
                return html`
                  <article class="card card-link" style="padding:1.1rem">
                    <div class="row" style="justify-content:space-between;margin-bottom:.5rem">
                      ${statusBadge(c.status, c.statusLabel)}
                      <span class="mono text-xs text-muted">${c.publicId}</span>
                    </div>
                    <h3 style="font-size:1rem;margin-bottom:.3rem">${escapeHtml(c.area || categoryLabel(c.category, c.categoryLabel))}</h3>
                    <p class="text-small text-muted clamp-2">${c.description}</p>
                    <div class="meta-line mt-2">
                      ${categoryBadge(c.category, c.categoryLabel)}
                      <span>${icon('calendar')} ${formatDate(c.createdAt)}</span>
                    </div>
                    <div class="row mt-2" style="gap:.4rem">
                      <a class="btn btn-sm btn-secondary" href="#/my/${encodeURIComponent(c.publicId)}">View details</a>
                      ${tracked ? html`<a class="btn btn-sm btn-ghost" href="#/track?id=${encodeURIComponent(c.publicId)}&code=${encodeURIComponent(tracked.trackingCode)}">Private tracking</a>` : ''}
                    </div>
                  </article>
                `;
              })}
            </div>
          ` : html`
            <div class="card">${emptyState({
              title: 'No reports on this account yet',
              message: 'Submit a report while signed in and it will appear here. Anonymous reports stay private and trackable only with their code.',
              iconName: 'clipboard',
              action: '<a class="btn btn-primary" href="#/report">Report an issue</a>',
            })}</div>
          `}
        </div>
      </main>
    `,
    mount() {},
  };
}

export async function renderMyDetail(ctx) {
  if (!ctx.state.user) {
    return {
      title: 'Report — CivicAI',
      html: html`<main id="main" class="section"><div class="wrap-narrow"><div class="notice notice--info">${icon('lock')}<div>Please sign in to view this report.</div></div></div></main>`,
      mount() {},
    };
  }
  const publicId = String(ctx.params.id || '').toUpperCase();
  let data;
  try {
    data = await api.myComplaint(publicId);
  } catch (err) {
    return {
      title: 'Report — CivicAI',
      html: html`
        <main id="main" class="section"><div class="wrap-narrow">
          <a class="btn btn-sm btn-ghost mb-2" href="#/my">${icon('arrow-left')} Back to my reports</a>
          <div class="notice notice--danger">${icon('alert')}<div>${err.message}</div></div>
        </div></main>`,
      mount() {},
    };
  }
  const complaint = data.complaint;
  return {
    title: `${publicId} — My report — CivicAI`,
    html: html`
      <main id="main" class="section">
        <div class="wrap-narrow">
          <div class="row mb-2">
            <a class="btn btn-sm btn-ghost" href="#/my">${icon('arrow-left')} My reports</a>
            <span class="grow"></span>
            <span class="text-xs text-muted">Signed in as ${escapeHtml(ctx.state.user.name)}</span>
          </div>
          ${trackingDetail(complaint, { showReporter: false })}
        </div>
      </main>
    `,
    mount(root) {
      root.querySelectorAll('[data-track-image]').forEach((img) => {
        img.addEventListener('click', () => openImageModal(img.src, `Photo attached to ${complaint.publicId}`));
        img.style.cursor = 'zoom-in';
      });
      root.querySelector('[data-print-report]')?.addEventListener('click', () => window.print());
    },
  };
}

export { safe };
