// App chrome: top bar, panel rail, optics dock, readouts.
import { el, $, ui, icon, initTips, toast } from './dom.js';
import { state, set, on, emit, store } from '../core/bus.js';
import { camInfo, resetGlobe, setTilt, northUp, BASEMAPS, keys } from '../core/viewer.js';
import { enabledLayers, registry } from '../layers/base.js';
import { fmtHeight, dms, compass } from '../core/geo.js';
import { STYLES } from '../fx/styles.js';

const panels = new Map();
let railEl, panelEl = null, cleanup = null;

export function registerPanel(def) { panels.set(def.id, def); }

export function initShell() {
  initTips();
  const root = ui();
  root.appendChild(el(`
    <header class="top">
      <div class="brand surface">
        <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
          <path d="M3 16c3.200-5.400 7.500-8 13-8s9.800 2.600 13 8c-3.200 5.400-7.500 8-13 8S6.200 21.400 3 16Z" fill="none" stroke="currentColor" stroke-width="1.6"/>
          <circle class="brand-iris" cx="16" cy="16" r="4.200" fill="var(--accent)"/>
        </svg>
        <b>ARGUS</b><span class="tagline">Every public signal, one planet</span>
      </div>
      <div class="cmd surface" id="cmd"></div>
      <div class="status surface">
        <span class="feeds"><span class="pulse idle" id="pulse"></span><span id="feeds">No feeds on</span></span>
        <span class="clock mono" id="clock">--:--:--<small>UTC</small></span>
      </div>
    </header>`));

  railEl = el('<nav class="rail surface" aria-label="Panels"></nav>');
  root.appendChild(railEl);
  drawRail();

  // Dock: the six optics, then view tools.
  const dock = el('<footer class="dock surface" role="toolbar" aria-label="View controls"></footer>');
  STYLES.forEach((s, i) => {
    const b = el(`<button class="optic" data-style="${s.id}" data-tip="${s.tip}" data-key="${i + 1}" data-side="top" aria-pressed="${state.style === s.id}"><i class="sw" style="--g:${s.swatch}"></i><span class="lbl">${s.name}</span></button>`);
    b.onclick = () => set('style', s.id);
    dock.appendChild(b);
  });
  dock.appendChild(el('<span class="sep"></span>'));
  const tools = [
    ['hud', 'crosshair', 'Tactical HUD', 'H', () => set('hud', !state.hud)],
    ['detect', 'scan', 'Detection overlay', 'D', () => set('detect', !state.detect)],
    ['context', 'globe', 'Global context: stage the whole picture', 'G', () => emit('context:toggle')],
    null,
    ['tilt', 'tilt', 'Tilt: straight down or 35° oblique', 'T', () => { const o = camInfo().pitch < -60; setTilt(o); }],
    ['north', 'compass', 'North up', 'N', () => northUp()],
    ['reset', 'home', 'Reset globe', 'R', () => emit('reset')],
    null,
    ['share', 'share', 'Copy a link to this exact view', 'S', () => emit('share')],
  ];
  for (const t of tools) {
    if (!t) { dock.appendChild(el('<span class="sep"></span>')); continue; }
    const b = el(`<button class="tool" data-tool="${t[0]}" data-tip="${t[2]}" data-key="${t[3]}" data-side="top" aria-label="${t[2]}">${icon(t[1], 19)}</button>`);
    b.onclick = t[4];
    dock.appendChild(b);
  }
  root.appendChild(dock);
  const syncDock = () => {
    dock.querySelectorAll('.optic').forEach((b) => b.setAttribute('aria-pressed', b.dataset.style === state.style));
    for (const k of ['hud', 'detect', 'context']) $(`[data-tool="${k}"]`, dock)?.setAttribute('aria-pressed', !!state[k]);
  };
  on('state', syncDock);
  syncDock();

  root.appendChild(el('<div class="readout" id="readout"></div>'));
  const credits = el(`<div class="credits"><span class="attr" id="attr"></span><button class="power surface" id="power" data-tip="Optional free keys unlock more" data-side="top">${icon('bolt', 13)}<span>POWER UP</span></button></div>`);
  root.appendChild(credits);
  $('#power').onclick = () => emit('open:settings');

  setInterval(clock, 1000); clock();
  on('camera', readout); on('camera:end', readout); setInterval(readout, 1000); readout();
  on('layers', feeds); on('layers:toggle', feeds); on('state:basemap', feeds); feeds();
  on('toast', (t) => toast(t.text, t.kind));
  on('state:panel', () => { drawRail(); drawPanel(); });
  on('layers:toggle', drawRail);
  drawPanel();
  syncPower();
  on('keys', syncPower);

  // The iris follows the pointer: a small sign of life in the corner.
  const iris = $('.brand-iris');
  addEventListener('pointermove', (e) => {
    const x = (e.clientX / innerWidth - 0.5) * 5, y = (e.clientY / innerHeight - 0.5) * 3;
    iris.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
  }, { passive: true });
}

function syncPower() {
  const k = keys();
  const n = ['ion', 'google', 'aisstream'].filter((x) => k[x]).length;
  const p = $('#power');
  p.classList.toggle('up', n > 0);
  p.querySelector('span').textContent = n > 0 ? 'POWERED UP' : 'POWER UP';
}

function clock() {
  const d = new Date();
  $('#clock').firstChild.textContent = d.toISOString().slice(11, 19);
}
function readout() {
  const r = $('#readout');
  if (!r || state.hud) { if (r) r.innerHTML = ''; return; }
  const c = camInfo();
  r.innerHTML = c.onGlobe
    ? `<span><i>LAT</i><b>${dms(c.clat, 'N', 'S')}</b></span><span><i>LON</i><b>${dms(c.clon, 'E', 'W')}</b></span><span><i>EYE</i><b>${fmtHeight(c.height)}</b></span><span><i>HDG</i><b>${String(Math.round(c.heading) % 360).padStart(3, '0')}° ${compass(c.heading)}</b></span>`
    : `<span><i>EYE</i><b>${fmtHeight(c.height)}</b></span>`;
}
function feeds() {
  const act = enabledLayers();
  const live = act.filter((l) => l.status === 'live' || l.status === 'stale');
  const total = live.reduce((a, l) => a + (l.count || 0), 0);
  $('#pulse').classList.toggle('idle', !live.length);
  $('#feeds').innerHTML = act.length ? `<b>${total.toLocaleString()}</b> signals · <b>${act.length}</b> ${act.length === 1 ? 'feed' : 'feeds'}` : 'No feeds on';
  const base = BASEMAPS.find((b) => b.id === state.basemap);
  const src = [base?.credit, ...new Set(act.map((l) => l.source.split(' · ')[0]))].filter(Boolean);
  const a = $('#attr');
  a.textContent = src.join(' · ');
  a.title = src.join('\n');
}

function drawRail() {
  if (!railEl) return;
  railEl.innerHTML = '';
  let sep = false;
  const ORDER = ['layers', 'missions', 'weather', 'news', 'radio', 'tools', 'director', 'settings'];
  for (const p of [...panels.values()].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id))) {
    if (p.bottom && !sep) { railEl.appendChild(el('<hr>')); sep = true; }
    const badge = p.badge?.();
    const b = el(`<button data-tip="${p.title}" ${p.key ? `data-key="${p.key}"` : ''} data-side="right" aria-label="${p.title}" aria-pressed="${state.panel === p.id}">${icon(p.icon, 20)}${badge ? `<span class="badge">${badge}</span>` : ''}</button>`);
    b.onclick = () => set('panel', state.panel === p.id ? null : p.id);
    railEl.appendChild(b);
  }
}

function drawPanel() {
  if (cleanup) { try { cleanup(); } catch (e) { console.warn(e); } cleanup = null; }
  panelEl?.remove(); panelEl = null;
  document.body.classList.toggle('panel-closed', !state.panel);
  const def = panels.get(state.panel);
  store.set('panel', state.panel);
  if (!def) return;
  panelEl = el(`<aside class="panel surface" aria-label="${def.title}">
    <div class="panel-head"><h2>${def.title}</h2><span class="sub"></span><button class="icon-btn" aria-label="Close panel" data-tip="Close" data-key="Esc">${icon('x', 16)}</button></div>
    <div class="panel-body"></div></aside>`);
  $('.icon-btn', panelEl).onclick = () => set('panel', null);
  ui().appendChild(panelEl);
  cleanup = def.render($('.panel-body', panelEl), { head: $('.panel-head', panelEl), sub: $('.sub', panelEl), panel: panelEl }) || null;
}
export function refreshPanel(id) { if (state.panel === id) drawPanel(); }
export const openPanel = (id) => set('panel', id);
export { registry };
