// Detection overlay: screen-space brackets and IDs on live contacts in view.
import { C, scene, toScreen } from '../core/viewer.js';
import { state, on } from '../core/bus.js';
import { enabledLayers, registry } from '../layers/base.js';
import { fmtAlt, fmtSpeed } from '../core/geo.js';
import { current } from '../core/select.js';

let cv, g, picks = [], timer = null, off = null;
const scratch = new C.Cartesian3();

function gather() {
  const w = cv.clientWidth, h = cv.clientHeight, cx = w / 2, cy = h / 2;
  const cand = [];
  for (const L of enabledLayers()) {
    if (!L.contacts) continue;
    const list = L.contacts();
    // Dense layers are sampled so one feed cannot starve the rest.
    const step = list.length > 5000 ? Math.ceil(list.length / 5000) : 1;
    for (let i = 0; i < list.length; i += step) {
      const c = list[i];
      const p = toScreen(C.Cartesian3.fromDegrees(c.lon, c.lat, c.alt || 0, C.Ellipsoid.WGS84, scratch));
      if (!p || p.x < 0 || p.y < 60 || p.x > w || p.y > h - 70) continue;
      cand.push({ c, L, d: (p.x - cx) ** 2 + (p.y - cy) ** 2 });
    }
  }
  cand.sort((a, b) => a.d - b.d);
  picks = cand.slice(0, Math.round(12 + state.density * 240));
}

function draw() {
  const dpr = Math.min(2, devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  if (!picks.length) return;
  g.font = '500 10px "Geist Mono", ui-monospace, monospace';
  g.textBaseline = 'middle';
  const taken = new Set();
  const sel = current();
  const dense = picks.length > 90;
  for (const { c, L } of picks) {
    const pos = L.position?.(c.key, scratch) || C.Cartesian3.fromDegrees(c.lon, c.lat, c.alt || 0, C.Ellipsoid.WGS84, scratch);
    const p = toScreen(pos);
    if (!p) continue;
    const isSel = sel && sel.L === L && sel.key === c.key;
    const s = isSel ? 15 : L.id === 'flights' || L.id === 'military' || L.id === 'vessels' ? 11 : 9;
    const x = Math.round(p.x), y = Math.round(p.y), k = 4;
    g.strokeStyle = c.color; g.lineWidth = isSel ? 1.6 : 1.1; g.globalAlpha = isSel ? 1 : 0.9;
    g.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { g.moveTo(x + sx * s, y + sy * (s - k)); g.lineTo(x + sx * s, y + sy * s); g.lineTo(x + sx * (s - k), y + sy * s); }
    g.stroke();
    // One label per grid cell keeps IDs readable when the sky is crowded.
    const cell = `${Math.floor(x / 78)}:${Math.floor(y / 15)}`;
    if (taken.has(cell)) continue;
    taken.add(cell);
    let extra = '';
    if (!dense) { if (c.spd != null && (L.id === 'flights' || L.id === 'military')) extra = c.ground ? ' GND' : ' ' + fmtAlt(c.alt).join(''); else if (L.id === 'vessels') extra = ' ' + fmtSpeed(c.spd).join(''); }
    const text = (c.tag ? c.tag + ' ' : '') + c.label + extra;
    const tw = g.measureText(text).width;
    g.globalAlpha = 0.72; g.fillStyle = '#060806'; g.fillRect(x + s + 4, y - s - 3, tw + 8, 13);
    g.globalAlpha = 1; g.fillStyle = c.color; g.fillText(text, x + s + 8, y - s + 4);
  }
  g.globalAlpha = 1;
}

function sync() {
  clearInterval(timer); off?.(); off = null;
  if (!state.detect) { g.clearRect(0, 0, cv.width, cv.height); picks = []; return; }
  gather();
  timer = setInterval(gather, 450);
  off = scene.postRender.addEventListener(draw);
}
export function initDetect() {
  cv = document.getElementById('detect');
  g = cv.getContext('2d');
  on('state:detect', sync);
  on('state:density', () => state.detect && gather());
  sync();
}
/** Contacts currently on screen for one layer id (used by the analyst and the HUD summary). */
export function inView(layerId) {
  const L = registry.get(layerId);
  if (!L?.enabled || !L.contacts) return [];
  const w = scene.canvas.clientWidth, h = scene.canvas.clientHeight, out = [];
  for (const c of L.contacts()) {
    const p = toScreen(C.Cartesian3.fromDegrees(c.lon, c.lat, c.alt || 0, C.Ellipsoid.WGS84, scratch));
    if (p && p.x >= 0 && p.y >= 0 && p.x <= w && p.y <= h) out.push(c);
  }
  return out;
}
