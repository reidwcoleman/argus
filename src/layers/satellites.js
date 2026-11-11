// Satellites: CelesTrak elements propagated with SGP4 in the browser.
import * as sat from 'satellite.js';
import { C, scene, viewer } from '../core/viewer.js';
import { defineLayer } from './base.js';
import { getText } from '../core/net.js';
import { emit, store } from '../core/bus.js';
import { fmtSpeed, latlon, deg, rad } from '../core/geo.js';
import { glyph } from './glyphs.js';

const CLASSES = [
  { id: 'stations', name: 'Stations', color: '#ffffff', groups: ['stations'], size: 9 },
  { id: 'imaging', name: 'Imaging', color: '#ffd166', groups: ['resource'], size: 5 },
  { id: 'nav', name: 'Navigation', color: '#7ef0c3', groups: ['gnss'], size: 5 },
  { id: 'telecom', name: 'Telecom', color: '#c9b8ff', groups: ['geo'], size: 4 },
  { id: 'probes', name: 'Science', color: '#ff9ed8', groups: ['science'], size: 5 },
  { id: 'starlink', name: 'Starlink', color: '#9fb4c8', groups: ['starlink'], size: 3 },
  { id: 'debris', name: 'Debris', color: '#ff7a59', groups: ['cosmos-1408-debris', 'fengyun-1c-debris', 'iridium-33-debris'], size: 3 },
];
const on = new Set(store.get('satClasses', ['stations', 'imaging', 'nav', 'telecom', 'probes']));
const sats = new Map(); // norad -> { id, name, cls, rec, p: Cartesian3, v: Cartesian3, t0, pt, alt, speed }
const loaded = new Set();
let points = null, bbs = null, cursor = 0, tick = null, order = [], ring = null, ringFor = null, ringAt = 0, groundTrack = null;

function parseTle(text, cls) {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
  let n = 0;
  for (let i = 0; i + 2 < lines.length + 1; i += 3) {
    const name = lines[i], l1 = lines[i + 1], l2 = lines[i + 2];
    if (!l1 || !l2 || l1[0] !== '1' || l2[0] !== '2') { i -= 2; continue; }
    const id = l1.slice(2, 7).trim();
    if (sats.has(id)) continue;
    let rec; try { rec = sat.twoline2satrec(l1, l2); } catch { continue; }
    if (!rec || rec.error) continue;
    sats.set(id, { id, name: name.replace(/^0 /, '').trim(), cls, rec, p: new C.Cartesian3(), v: new C.Cartesian3(), t0: 0, pt: null, alt: 0, speed: 0, ok: false, intl: l1.slice(9, 17).trim() });
    n++;
  }
  return n;
}

function propagate(s, date, gmst) {
  const pv = sat.propagate(s.rec, date);
  if (!pv || !pv.position || !Number.isFinite(pv.position.x)) { s.ok = false; return false; }
  const e = sat.eciToEcf(pv.position, gmst);
  C.Cartesian3.fromElements(e.x * 1000, e.y * 1000, e.z * 1000, s.p);
  // Velocity in the rotating frame: v_ecf = R(v_eci) - omega x r
  const ve = sat.eciToEcf(pv.velocity, gmst);
  const w = 7.2921159e-5;
  C.Cartesian3.fromElements(ve.x * 1000 + w * s.p.y, ve.y * 1000 - w * s.p.x, ve.z * 1000, s.v);
  s.speed = Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z) * 1000;
  s.t0 = date.getTime();
  s.ok = true;
  return true;
}
const scratch = new C.Cartesian3();
function posAt(s, now, result = scratch) {
  const dt = (now - s.t0) / 1000;
  return C.Cartesian3.fromElements(s.p.x + s.v.x * dt, s.p.y + s.v.y * dt, s.p.z + s.v.z * dt, result);
}

async function loadClass(L, cls) {
  if (loaded.has(cls.id)) return;
  loaded.add(cls.id);
  try {
    for (const g of cls.groups) {
      const text = await getText(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${g}&FORMAT=tle`, { proxy: true, ttl: 6 * 3600, timeout: 45000 });
      parseTle(text, cls);
    }
    rebuild(L);
  } catch (e) { loaded.delete(cls.id); throw e; }
}

function rebuild(L) {
  if (!points) return;
  const date = new Date(), gmst = sat.gstime(date);
  for (const s of sats.values()) {
    const cls = s.cls;
    const show = on.has(cls.id);
    if (show && !s.pt) {
      if (!propagate(s, date, gmst)) continue;
      if (cls.id === 'stations') {
        const big = /^ISS \(ZARYA\)|^CSS \(TIANHE\)/.test(s.name);
        s.pt = bbs.add({ position: s.p, image: glyph(big ? 'station' : 'sat', cls.color, big ? 30 : 20), width: big ? 30 : 20, height: big ? 30 : 20, id: { L: 'satellites', k: s.id }, scaleByDistance: new C.NearFarScalar(1e6, 1.1, 6e7, 0.6) });
      } else {
        s.pt = points.add({ position: s.p, pixelSize: cls.size, color: C.Color.fromCssColorString(cls.color).withAlpha(cls.id === 'starlink' || cls.id === 'debris' ? 0.75 : 0.95), outlineColor: C.Color.BLACK.withAlpha(0.6), outlineWidth: 1, id: { L: 'satellites', k: s.id }, scaleByDistance: new C.NearFarScalar(2e6, 1.4, 8e7, 0.7) });
      }
    } else if (!show && s.pt) {
      (cls.id === 'stations' ? bbs : points).remove(s.pt);
      s.pt = null;
    }
  }
  order = [...sats.values()].filter((s) => s.pt);
  L.setCount(order.length);
  emit('layers', 'satellites');
}

function frame() {
  if (!order.length) return;
  const nowMs = Date.now();
  const date = new Date(nowMs), gmst = sat.gstime(date);
  // Re-run SGP4 on a rolling slice; everything else coasts on its last state vector.
  const chunk = Math.max(40, Math.ceil(order.length / 45));
  for (let i = 0; i < chunk; i++) { cursor = (cursor + 1) % order.length; propagate(order[cursor], date, gmst); }
  for (const s of order) if (s.ok) s.pt.position = posAt(s, nowMs);
  if (ringFor && nowMs - ringAt > 1000) drawRing(ringFor, date);
}

/** Orbit ring: one period in the inertial frame, re-aligned to Earth each second so it never drifts off the satellite. */
function drawRing(s, date) {
  ringAt = date.getTime();
  const gmst = sat.gstime(date);
  const period = (2 * Math.PI) / s.rec.no; // minutes
  const pts = [], ground = [];
  const N = 180;
  for (let i = 0; i <= N; i++) {
    const t = new Date(date.getTime() + (i / N) * period * 60000);
    const pv = sat.propagate(s.rec, t);
    if (!pv?.position) continue;
    const e = sat.eciToEcf(pv.position, gmst);
    pts.push(new C.Cartesian3(e.x * 1000, e.y * 1000, e.z * 1000));
    if (i <= N * 0.6) {
      const g = sat.eciToGeodetic(pv.position, sat.gstime(t));
      ground.push(C.Cartesian3.fromRadians(g.longitude, g.latitude, 0));
    }
  }
  ring._pts = pts; ring._ground = ground;
}

function elements(s) {
  const r = s.rec;
  const n = r.no; // rad/min
  const periodMin = (2 * Math.PI) / n;
  const a = Math.cbrt(398600.4418 / Math.pow(n / 60, 2)); // km
  return { periodMin, inc: deg(r.inclo), ecc: r.ecco, apo: a * (1 + r.ecco) - 6378.137, per: a * (1 - r.ecco) - 6378.137 };
}

/** Next passes of a satellite over an observer. Returns up to `max` passes in the next 24 h. */
export function passes(id, lat, lon, max = 3) {
  const s = sats.get(String(id));
  if (!s) return [];
  const obs = { latitude: rad(lat), longitude: rad(lon), height: 0 };
  const out = [];
  let cur = null;
  const start = Date.now();
  for (let t = 0; t < 24 * 3600 && out.length < max; t += 20) {
    const d = new Date(start + t * 1000);
    const pv = sat.propagate(s.rec, d);
    if (!pv?.position) continue;
    const look = sat.ecfToLookAngles(obs, sat.eciToEcf(pv.position, sat.gstime(d)));
    const el = deg(look.elevation);
    if (el > 10) {
      if (!cur) cur = { rise: d, peak: d, maxEl: el, az: deg(look.azimuth) };
      if (el > cur.maxEl) { cur.maxEl = el; cur.peak = d; }
      cur.set = d;
    } else if (cur) { cur.visible = isVisiblePass(pv.position, cur.peak, lat, lon); out.push(cur); cur = null; }
  }
  return out;
}
function sunVector(date) {
  // Low-precision solar position (ECI unit vector), good to about a degree.
  const n = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
  const L = rad((280.46 + 0.9856474 * n) % 360), g = rad((357.528 + 0.9856003 * n) % 360);
  const lam = L + rad(1.915) * Math.sin(g) + rad(0.02) * Math.sin(2 * g), eps = rad(23.439 - 0.0000004 * n);
  return [Math.cos(lam), Math.cos(eps) * Math.sin(lam), Math.sin(eps) * Math.sin(lam)];
}
function isVisiblePass(posEci, date, lat, lon) {
  const sun = sunVector(date);
  // Observer in darkness?
  const gmst = sat.gstime(date);
  const th = gmst + rad(lon);
  const up = [Math.cos(rad(lat)) * Math.cos(th), Math.cos(rad(lat)) * Math.sin(th), Math.sin(rad(lat))];
  const sunEl = deg(Math.asin(up[0] * sun[0] + up[1] * sun[1] + up[2] * sun[2]));
  if (sunEl > -6) return false;
  // Satellite outside Earth's shadow cylinder?
  const d = posEci.x * sun[0] + posEci.y * sun[1] + posEci.z * sun[2];
  if (d > 0) return true;
  const perp = Math.sqrt(Math.max(0, posEci.x ** 2 + posEci.y ** 2 + posEci.z ** 2 - d * d));
  return perp > 6378.137;
}
export function findSatellite(name) {
  const q = name.toLowerCase().replace(/^the /, '').trim();
  if (q === 'iss' || q.includes('space station')) return [...sats.values()].find((s) => /^ISS \(ZARYA\)/.test(s.name)) || null;
  let best = null;
  for (const s of sats.values()) { const n = s.name.toLowerCase(); if (n === q) return s; if (n.includes(q) && (!best || n.length < best.name.length)) best = s; }
  return best;
}

const L = defineLayer({
  id: 'satellites', name: 'Satellites', group: 'Space', color: '#c9b8ff', icon: 'sat', trust: 'live',
  blurb: 'SGP4 orbits in seven classes', source: 'CelesTrak', aliases: ['satellites', 'satellite', 'sats', 'orbit', 'iss', 'starlink'],
  subs: () => CLASSES.map((c) => ({ id: c.id, name: c.name, color: c.color, on: on.has(c.id), count: on.has(c.id) ? [...sats.values()].filter((s) => s.cls === c && s.pt).length : null })),
  async setSub(id, v) {
    if (v) on.add(id); else on.delete(id);
    store.set('satClasses', [...on]);
    emit('layers', 'satellites');
    if (!L.enabled) return;
    const cls = CLASSES.find((c) => c.id === id);
    if (v) { L.setStatus('loading', `Loading ${cls.name}`); try { await loadClass(L, cls); L.setStatus('live'); } catch { L.setStatus('error', `${cls.name} elements did not load`); } }
    rebuild(L);
  },
  async enable(L) {
    points = scene.primitives.add(new C.PointPrimitiveCollection());
    bbs = scene.primitives.add(new C.BillboardCollection({ scene }));
    ring = viewer.entities.add({
      show: false,
      polyline: { positions: new C.CallbackProperty(() => ring._pts || [], false), width: 1.6, arcType: C.ArcType.NONE, material: new C.PolylineGlowMaterialProperty({ color: C.Color.fromCssColorString('#c8f55a').withAlpha(0.9), glowPower: 0.18 }) },
    });
    groundTrack = viewer.entities.add({
      show: false,
      polyline: { positions: new C.CallbackProperty(() => ring._ground || [], false), width: 1.4, arcType: C.ArcType.GEODESIC, material: new C.PolylineDashMaterialProperty({ color: C.Color.fromCssColorString('#c8f55a').withAlpha(0.55), dashLength: 12 }) },
    });
    tick = scene.preUpdate.addEventListener(frame);
    const wanted = CLASSES.filter((c) => on.has(c.id));
    await Promise.allSettled(wanted.map((c) => loadClass(L, c)));
    rebuild(L);
    if (!order.length) throw new Error('No orbital elements could be loaded');
  },
  disable() {
    tick?.(); tick = null;
    if (points) scene.primitives.remove(points);
    if (bbs) scene.primitives.remove(bbs);
    if (ring) viewer.entities.remove(ring);
    if (groundTrack) viewer.entities.remove(groundTrack);
    for (const s of sats.values()) s.pt = null;
    points = bbs = ring = groundTrack = null; order = []; ringFor = null;
  },
  contacts() {
    const out = [];
    for (const s of order) {
      if (!s.ok || s.cls.id === 'starlink' || s.cls.id === 'debris') continue;
      const cg = C.Cartographic.fromCartesian(posAt(s, Date.now()));
      if (!cg) continue;
      out.push({ key: s.id, L: 'satellites', label: s.name, lat: deg(cg.latitude), lon: deg(cg.longitude), alt: cg.height, spd: s.speed, color: s.cls.color, klass: s.cls.id, tag: s.cls.id === 'stations' ? 'STN' : '' });
    }
    return out;
  },
  position(k, res) { const s = sats.get(k); return s && s.ok && s.pt ? posAt(s, Date.now(), res) : null; },
  info(k, brief) {
    const s = sats.get(k);
    if (!s) return null;
    if (brief) return { title: s.name, kind: 'Satellite', sub: s.cls.name };
    const cg = C.Cartographic.fromCartesian(posAt(s, Date.now()));
    const el = elements(s);
    return {
      title: s.name, kind: `Satellite · ${s.cls.name}`, sub: `NORAD ${s.id} · ${s.intl}`, color: s.cls.color, moving: true,
      range: Math.max(1.2e6, cg.height * 1.6), pitch: -30, lat: deg(cg.latitude), lon: deg(cg.longitude), alt: cg.height, sat: s.id,
      stats: [[Math.round(cg.height / 1000).toLocaleString(), 'km', 'Altitude'], [(s.speed / 1000).toFixed(2), 'km/s', 'Velocity'], [el.periodMin >= 600 ? (el.periodMin / 60).toFixed(1) : el.periodMin.toFixed(1), el.periodMin >= 600 ? 'h' : 'min', 'Period']],
      rows: [['Inclination', el.inc.toFixed(2) + '°'], ['Apogee', Math.round(el.apo).toLocaleString() + ' km'], ['Perigee', Math.round(el.per).toLocaleString() + ' km'], ['Eccentricity', el.ecc.toFixed(5)], ['Sub-point', latlon(deg(cg.latitude), deg(cg.longitude))], ['Epoch', `Day ${s.rec.epochdays.toFixed(2)} of 20${String(s.rec.epochyr).padStart(2, '0')}`]],
      note: 'Position is computed from published orbital elements, not observed. The ring is one full orbit; the dashed line is the ground track ahead.',
    };
  },
  onSelect(k) { const s = sats.get(k); if (!s || !ring) return; ringFor = s; drawRing(s, new Date()); ring.show = true; groundTrack.show = true; },
  onDeselect() { ringFor = null; if (ring) { ring.show = false; groundTrack.show = false; ring._pts = []; ring._ground = []; } },
  all: () => order,
});
export default L;
