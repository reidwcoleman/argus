// Live aircraft: a global ADS-B picture (OpenSky) refined by a fast regional feed
// (adsb.lol, adsb.fi fallback) around wherever the camera is looking.
import { C, viewer, camInfo, viewRadiusM, camera } from '../core/viewer.js';
import { defineLayer, registry } from './base.js';
import { Movers } from './movers.js';
import { getJSON, asset, HOSTED } from '../core/net.js';
import { on, state } from '../core/bus.js';
import { fmtAlt, fmtSpeed, compass, latlon, ago, distM, rad } from '../core/geo.js';
import { current } from '../core/select.js';

const CIVIL = '#8ad8ff', GROUND = '#6f93a8', MIL = '#ffb53a', EMERG = '#ff5247';
const HEAVY = /^(B74|B77|B78|A33|A34|A35|A38|B76|MD11|IL96|A30|A31|B75|C17|C5|K35|A400|IL76|AN12|B52)/;
const HELI = /^(H\d|EC|AS\d|B06|B40|B41|B42|B43|R22|R44|R66|S76|S92|UH|AH|CH|MH|H60|H47|H64|A109|A139|A169|AW|MI\d|KA\d|NH90|LYNX)/;
const PROP = /^(AT4|AT7|DH8|SF3|E120|JS|B190|PC12|C208|BE20|B350|SW4|F50|D328|L410|AN2|C130|C30J|P3|E2|C295|CN35|DHC|PA|C1[5-9]|C2[01]|SR2|DA4|BE[39]|M20)/;
const BIZ = /^(C5|C6|C7|C25|GL|GLF|G[1-7]|CL|LJ|E5|F2|F9|FA|H25|PC24|PRM|BE40|E35|E45|E55)/;
const UAV = /^(Q9|Q4|RQ|MQ|HRON)/;

function klass(o) {
  const t = o.type || '', c = o.cat || '';
  if (c === 'A7' || c === 'O8' || HELI.test(t)) return 'heli';
  if (c === 'B6' || c === 'O14' || UAV.test(t)) return 'uav';
  if (c === 'A5' || c === 'O6' || HEAVY.test(t)) return 'heavy';
  if (BIZ.test(t)) return 'biz';
  if (PROP.test(t)) return /^(AT|DH8|SF3|E120|F50|D328|C130|C30J|P3|C295)/.test(t) ? 'turboprop' : 'light';
  if (c === 'A1' || c === 'O2' || c === 'B1' || c === 'B4') return 'light';
  return 'jet';
}
const KLASS_NAME = { heli: 'Helicopter', uav: 'Uncrewed', heavy: 'Heavy jet', biz: 'Business jet', turboprop: 'Turboprop', light: 'Light aircraft', jet: 'Jet' };
function iconFor(o) {
  const k = o.k || (o.k = klass(o));
  const emerg = o.flags & 2, mil = o.flags & 1;
  const color = emerg ? EMERG : mil ? MIL : o.gnd ? GROUND : CIVIL;
  const shape = k === 'heli' ? 'heli' : k === 'heavy' ? 'heavy' : k === 'light' || k === 'turboprop' ? 'light' : mil && !o.type ? 'mil' : k === 'uav' ? 'mil' : 'plane';
  const size = emerg ? 30 : k === 'heavy' ? 28 : k === 'light' || k === 'heli' ? 20 : o.gnd ? 18 : 24;
  return { shape, color, size };
}

/* ------------------------------------------------------------ shared bits */
const meta = new Map(); // hex -> { route, aircraft } from adsbdb, fetched on select
async function lookup(o) {
  if (meta.has(o.key)) return;
  const m = {};
  meta.set(o.key, m);
  const jobs = [];
  if (o.cs) jobs.push(getJSON(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(o.cs)}`, { timeout: 9000 }).then((d) => { m.route = d?.response?.flightroute || null; }).catch(() => {}));
  jobs.push(getJSON(`https://api.adsbdb.com/v0/aircraft/${o.key}`, { timeout: 9000 }).then((d) => { m.aircraft = d?.response?.aircraft || null; }).catch(() => {}));
  await Promise.all(jobs);
  m.done = true;
}
async function backfill(movers, o) {
  if (o._bf) return;
  o._bf = true;
  try {
    const d = await getJSON(`/api/flights/track?hex=${o.key}`, { timeout: 12000 });
    const path = (d.path || []).map((p) => [p[1], p[2], p[3] || 0, p[0] * 1000]).filter((p) => p[0] != null && p[1] != null);
    if (path.length > 1) {
      const first = o.hist[0]?.[3] || Infinity;
      o.hist = [...path.filter((p) => p[3] < first), ...o.hist];
      o.histV = (o.histV || 0) + 1;
      o.backfilled = path.length;
    }
  } catch { /* the locally accumulated trail is used instead */ }
}

function makeInfo(layer, movers) {
  return (key, brief) => {
    const o = movers.get(key);
    if (!o) return null;
    const mil = o.flags & 1, emerg = o.flags & 2;
    const m = meta.get(key) || {};
    const title = o.cs || (m.aircraft?.registration) || o.reg || key.toUpperCase();
    const k = KLASS_NAME[o.k || klass(o)];
    const typeName = m.aircraft ? `${m.aircraft.manufacturer || ''} ${m.aircraft.type || ''}`.trim() : o.type || k;
    const kind = emerg ? 'Emergency squawk' : mil ? 'Military aircraft' : o.gnd ? 'Aircraft on ground' : 'Aircraft';
    if (brief) return { title, kind, sub: o.type || k };
    const r = m.route;
    const sub = r ? `${r.origin?.iata_code || r.origin?.icao_code} ${r.origin?.municipality || ''} → ${r.destination?.iata_code || r.destination?.icao_code} ${r.destination?.municipality || ''}` : typeName;
    const [av, au] = fmtAlt(o.dalt), [sv, su] = fmtSpeed(o.spd);
    const vr = o.vr || 0;
    const age = Date.now() - o.ts;
    const rows = [
      ['Vertical rate', Math.abs(vr) < 0.3 ? 'Level' : `${vr > 0 ? 'Climbing' : 'Descending'} ${Math.round(Math.abs(vr) / 0.00508).toLocaleString()} ft/min`],
      ['Squawk', o.sq ? o.sq + (emerg ? ' (emergency)' : '') : 'Not reported'],
      ['Type', typeName || 'Unknown'],
      ['Registration', m.aircraft?.registration || o.reg || 'Unknown'],
    ];
    const owner = m.aircraft?.registered_owner || r?.airline?.name;
    if (owner) rows.push(['Operator', owner]);
    if (o.country) rows.push(['Registered in', o.country]);
    rows.push(['ICAO address', key.toUpperCase()], ['Position', latlon(o.dlat, o.dlon)], ['Last fix', `${ago(o.ts)} · ${o.src === 'global' ? 'OpenSky' : 'community ADS-B'}`]);
    return {
      title, kind, sub, color: emerg ? EMERG : mil ? MIL : CIVIL, moving: true, range: o.gnd ? 2500 : 18000, pitch: -28,
      lat: o.dlat, lon: o.dlon, alt: o.dalt, hdg: o.hdg, spd: o.spd, cockpit: !o.gnd || o.spd > 5,
      stats: [[av, au, o.gnd ? 'On ground' : 'Altitude'], [sv, su, 'Ground speed'], [String(Math.round(o.hdg || 0)).padStart(3, '0') + '°', compass(o.hdg || 0), 'Track']],
      rows,
      photo: m.aircraft?.url_photo_thumbnail ? { url: m.aircraft.url_photo, thumb: m.aircraft.url_photo_thumbnail, credit: 'airport-data.com via adsbdb' } : null,
      note: age > 60000 ? `Position is dead-reckoned from a fix ${ago(o.ts)}. ${HOSTED ? 'This hosted page updates from a snapshot about every 20 minutes; run Argus locally for second-by-second tracking.' : 'Zoom in for the fast regional feed.'}` : o.backfilled ? `Trail backfilled with ${o.backfilled} points of real track history.` : '',
    };
  };
}
function contactsOf(movers, layerId) {
  const out = [];
  for (const o of movers.values()) {
    const emerg = o.flags & 2, mil = o.flags & 1;
    out.push({ key: o.key, L: layerId, label: o.cs || o.key.toUpperCase(), lat: o.dlat, lon: o.dlon, alt: o.dalt, spd: o.spd, hdg: o.hdg, ground: !!o.gnd, klass: o.k || klass(o), type: o.type, color: emerg ? EMERG : mil ? MIL : CIVIL, tag: emerg ? 'EMERG' : mil ? 'MIL' : '' });
  }
  return out;
}

/* ---------------------------------------------------------------- flights */
let fl = null;
const flights = defineLayer({
  id: 'flights', name: 'Live flights', group: 'Movement', color: CIVIL, icon: 'plane', trust: 'live',
  blurb: 'Every aircraft broadcasting ADS-B', source: 'OpenSky Network · adsb.lol · adsb.fi', aliases: ['flights', 'flight', 'planes', 'aircraft', 'air traffic', 'airplanes'],
  trailColor: CIVIL,
  enable(L) {
    fl = new Movers({ layerId: 'flights', iconFor, maxExtrap: 60 });
    L.poll(async () => {
      const d = await getJSON('/api/flights/global', { timeout: 40000 });
      const now = Date.now();
      const mil = registry.get('military');
      for (const r of d.rows) {
        if (mil.enabled && milM?.get(r[0])) continue;
        const props = { cs: r[1], gnd: r[8], sq: r[9], flags: r[14], seen: now, country: r[15] };
        if (r[12]) props.cat = r[12];
        const ex = fl.get(r[0]);
        if (ex && ex.src === 'region' && now - ex.seen < 30000) continue;
        props.src = 'global'; props.maxEx = r[8] ? 0 : 1500; props.fast = false;
        fl.upsert(r[0], { lat: r[2], lon: r[3], alt: r[8] ? 0 : r[4], spd: r[5], hdg: r[6], vr: r[7], ts: r[13] * 1000 }, props);
      }
      fl.prune(now - 25 * 60000);
      L.setCount(fl.size);
      L.note = `${d.rows.length.toLocaleString()} from OpenSky${d.snap ? `, snapshot ${ago(d.snap)}, positions projected forward` : ''}`;
    }, 4 * 60000);
    // Close-range second-by-second detail comes through the local server; the hosted build has only the world snapshot.
    if (!HOSTED) L.poll(() => regional(L), 8000);
  },
  disable() { fl?.destroy(); fl = null; },
  contacts: () => (fl ? contactsOf(fl, 'flights') : []),
  info: (k, b) => (fl ? makeInfo(flights, fl)(k, b) : null),
  position: (k, res) => fl?.positionOf(k, res) || null,
  trail: (k) => fl?.get(k)?.hist || null,
  trailVersion: (k) => fl?.get(k)?.histV || 0,
  onSelect(k) { const o = fl?.get(k); if (!o) return; o.fast = true; lookup(o); backfill(fl, o); },
  onDeselect(k) { const o = fl?.get(k); if (o && o.src === 'global') o.fast = false; },
  raw: () => fl,
});

async function regional(L) {
  if (!fl) return;
  const cam = camInfo();
  if (!cam.onGlobe || cam.range > 3.2e6) {
    // Out at globe scale: hand regional contacts back to slow dead reckoning.
    for (const o of fl.values()) if (o.src === 'region' && Date.now() - o.seen > 30000) { o.src = 'global'; o.maxEx = 1500; if (current()?.key !== o.key) o.fast = false; }
    return;
  }
  const sel = current();
  let lat = cam.clat, lon = cam.clon;
  if (sel && sel.L.id === 'flights' && state.tracking) { const o = fl.get(sel.key); if (o) { lat = o.dlat; lon = o.dlon; } }
  const r = Math.max(40, Math.min(250, Math.round((viewRadiusM() * 1.5) / 1852)));
  const d = await getJSON(`/api/flights/region?lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}&r=${r}`, { timeout: 12000 });
  const now = Date.now();
  const mil = registry.get('military');
  for (const row of d.rows) {
    if (mil.enabled && (row[14] & 1)) continue;
    const props = { cs: row[1] || fl.get(row[0])?.cs || '', gnd: row[8], sq: row[9], flags: row[14], seen: now, src: 'region', maxEx: 40, fast: true };
    if (row[10]) props.type = row[10];
    if (row[11]) props.reg = row[11];
    if (row[12]) props.cat = row[12];
    const o = fl.upsert(row[0], { lat: row[2], lon: row[3], alt: row[8] ? 0 : row[4], spd: row[5], hdg: row[6], vr: row[7], ts: row[13] * 1000 }, props);
    if (row[10] && !o.k2) { o.k = klass(o); o.k2 = true; }
  }
  for (const o of fl.values()) if (o.src === 'region' && now - o.seen > 45000) { o.src = 'global'; o.maxEx = 600; if (sel?.key !== o.key) o.fast = false; }
  L.setCount(fl.size);
}

/* --------------------------------------------------------------- military */
let milM = null;
const military = defineLayer({
  id: 'military', name: 'Military flights', group: 'Movement', color: MIL, icon: 'shield', trust: 'live',
  blurb: 'ADS-B military traffic, emergencies in red', source: 'adsb.lol · adsb.fi', aliases: ['military', 'mil', 'military flights', 'military aircraft'],
  trailColor: MIL,
  enable(L) {
    milM = new Movers({ layerId: 'military', iconFor, maxExtrap: HOSTED ? 1500 : 90 });
    L.poll(async () => {
      const d = await getJSON('/api/flights/mil', { timeout: 15000 });
      const now = Date.now();
      for (const r of d.rows) {
        const props = { cs: r[1], gnd: r[8], sq: r[9], flags: r[14] | 1, seen: now, src: HOSTED ? 'global' : 'region', fast: !HOSTED };
        if (HOSTED) props.maxEx = r[8] ? 0 : 1500;
        if (r[10]) props.type = r[10];
        if (r[11]) props.reg = r[11];
        if (r[12]) props.cat = r[12];
        milM.upsert(r[0], { lat: r[2], lon: r[3], alt: r[8] ? 0 : r[4], spd: r[5], hdg: r[6], vr: r[7], ts: r[13] * 1000 }, props);
        fl?.remove(r[0]);
      }
      milM.prune(now - (HOSTED ? 45 : 5) * 60000);
      L.setCount(milM.size);
      if (d.snap) L.note = `Snapshot ${ago(d.snap)}, positions projected forward`;
    }, 20000);
  },
  disable() { milM?.destroy(); milM = null; },
  contacts: () => (milM ? contactsOf(milM, 'military') : []),
  info: (k, b) => (milM ? makeInfo(military, milM)(k, b) : null),
  position: (k, res) => milM?.positionOf(k, res) || null,
  trail: (k) => milM?.get(k)?.hist || null,
  trailVersion: (k) => milM?.get(k)?.histV || 0,
  onSelect(k) { const o = milM?.get(k); if (o) { lookup(o); backfill(milM, o); } },
  raw: () => milM,
});

/* ------------------------------------------------------------- 3D hangar */
// Close to the camera, glyphs swap to real per-class airframes (CC BY models, see public/models/ATTRIBUTION.md).
const MODEL = { heli: 'bell206', uav: 'mq9', heavy: 'b789', biz: 'citation2', turboprop: 'atr72', light: 'c172', jet: 'b789' };
const pool = new Map(); // key -> { ent, o, movers }
const scratchHpr = new C.HeadingPitchRoll();
function ensureModel(o, movers) {
  const id = movers.layerId + ':' + o.key;
  if (pool.has(id)) return;
  const k = o.k || klass(o);
  const file = (o.flags & 1) && k === 'jet' ? 'jet' : MODEL[k] || 'b789';
  const ent = viewer.entities.add({
    position: new C.CallbackPositionProperty(() => movers.positionOf(o) || C.Cartesian3.ZERO, false),
    orientation: new C.CallbackProperty(() => {
      const p = movers.positionOf(o);
      if (!p) return C.Quaternion.IDENTITY;
      // Models are authored nose toward glTF -X, which Cesium maps to local -Y (south at heading 0),
      // so nose-up pitch is a negative rotation about local X ("roll" in Cesium's terms).
      scratchHpr.heading = rad((o.hdg || 0) + 180);
      scratchHpr.pitch = 0;
      scratchHpr.roll = o.gnd ? 0 : -Math.atan2(o.vr || 0, Math.max(30, o.spd || 0)) * 0.9;
      return C.Transforms.headingPitchRollQuaternion(p, scratchHpr);
    }, false),
    model: { uri: asset(`models/${file}.glb`), minimumPixelSize: 44, maximumScale: 400, scale: 1, silhouetteColor: C.Color.fromCssColorString(o.flags & 1 ? MIL : CIVIL), silhouetteSize: 0.8, colorBlendAmount: 0 },
  });
  ent.argus = { L: movers.layerId, k: o.key };
  o.bb.show = false;
  pool.set(id, { ent, o, movers });
}
function dropModel(id) {
  const m = pool.get(id);
  if (!m) return;
  viewer.entities.remove(m.ent);
  if (m.movers.get(m.o.key)) m.o.bb.show = true;
  pool.delete(id);
}
setInterval(() => {
  const want = new Set();
  if (state.threeD) {
    const camPos = camera.positionCartographic;
    const clat = C.Math.toDegrees(camPos.latitude), clon = C.Math.toDegrees(camPos.longitude);
    if (camPos.height < 60000) {
      for (const movers of [fl, milM]) {
        if (!movers) continue;
        const near = [];
        for (const o of movers.values()) {
          if (Math.abs(o.dlat - clat) > 0.6 || Math.abs(o.dlon - clon) > 0.9) continue;
          if (state.cockpit && current()?.key === o.key) continue; // you are sitting in this one
          const d = distM(clat, clon, o.dlat, o.dlon);
          if (d < 45000) near.push([d, o]);
        }
        near.sort((a, b) => a[0] - b[0]);
        for (const [, o] of near.slice(0, 28)) { want.add(movers.layerId + ':' + o.key); ensureModel(o, movers); }
      }
    }
  }
  for (const id of [...pool.keys()]) {
    const m = pool.get(id);
    if (!want.has(id) || !m.movers.get(m.o.key)) dropModel(id);
  }
}, 900);
on('layers:toggle', ({ id, on: isOn }) => { if (!isOn && (id === 'flights' || id === 'military')) for (const pid of [...pool.keys()]) if (pid.startsWith(id + ':')) { const m = pool.get(pid); viewer.entities.remove(m.ent); pool.delete(pid); } });

/** Aircraft from both layers, nearest first, within `km` of a point. */
export function aircraftNear(lat, lon, km = 250, filter) {
  const out = [];
  for (const [movers, id] of [[fl, 'flights'], [milM, 'military']]) {
    if (!movers) continue;
    for (const o of movers.values()) {
      if (Math.abs(o.dlat - lat) > km / 100) continue;
      const d = distM(lat, lon, o.dlat, o.dlon);
      if (d > km * 1000) continue;
      const k = o.k || klass(o);
      if (filter && !filter(o, k)) continue;
      out.push({ L: id, key: o.key, label: o.cs || o.key.toUpperCase(), type: o.type || KLASS_NAME[k], klass: k, d, alt: o.dalt, spd: o.spd, hdg: o.hdg, lat: o.dlat, lon: o.dlon, ground: !!o.gnd, color: o.flags & 2 ? EMERG : o.flags & 1 ? MIL : CIVIL });
    }
  }
  return out.sort((a, b) => a.d - b.d);
}
export { flights, military, klass, KLASS_NAME };
