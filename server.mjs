// Argus local server.
// Serves the app (Vite middleware in dev, dist/ in production) and brokers the
// public feeds that do not send CORS headers. Everything here is keyless.
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { cameraMesh, cameraHosts, KEYED } from './cameras.mjs';
import { createReadStream, existsSync, statSync, readFileSync, writeFileSync } from 'node:fs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4317);
const PROD = process.env.NODE_ENV === 'production';
const UA = 'Argus/1.0 (local research globe)';
const KEYFILE = path.join(ROOT, '.argus-keys.json');

/* ------------------------------------------------------------------ cache */
const cache = new Map(); // key -> { at, ttl, status, type, body }
const inflight = new Map();
async function cached(key, ttlMs, producer) {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttlMs) return hit;
  // Recently expired: answer from cache now and refresh behind it, so one slow upstream never stalls the globe.
  const serveStale = hit && now - hit.at < ttlMs * 3 + 30000;
  if (inflight.has(key)) return serveStale ? hit : inflight.get(key);
  const p = (async () => {
    try {
      const v = await producer();
      const entry = { at: Date.now(), ...v };
      cache.set(key, entry);
      if (cache.size > 600) {
        const old = [...cache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 150);
        for (const [k] of old) cache.delete(k);
      }
      return entry;
    } catch (err) {
      if (hit) return { ...hit, stale: true }; // serve stale on upstream failure
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  if (serveStale) { p.catch(() => {}); return hit; }
  return p;
}
async function get(url, { timeout = 15000, headers = {}, binary = false } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: '*/*', ...headers },
    signal: AbortSignal.timeout(timeout),
    redirect: 'follow',
  });
  if (!res.ok) throw Object.assign(new Error(`upstream ${res.status}`), { status: res.status });
  const type = res.headers.get('content-type') || 'application/octet-stream';
  const body = binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
  return { status: 200, type, body };
}
const json = (obj) => ({ status: 200, type: 'application/json; charset=utf-8', body: JSON.stringify(obj) });

/* ------------------------------------------------------------- allowlist */
// Generic pass-through, restricted to the public data hosts the app uses.
const ALLOW = [
  'celestrak.org', 'api.adsbdb.com', 'www.submarinecablemap.com', 'www.nhc.noaa.gov',
  'gpsjam.org', 'firms.modaps.eosdis.nasa.gov', 'cwwp2.dot.ca.gov', 'api.tfl.gov.uk',
  'tie.digitraffic.fi', 'meri.digitraffic.fi', 'rata.digitraffic.fi', 'weathercam.digitraffic.fi',
  's3-eu-west-1.amazonaws.com', 'jamcams.tfl.gov.uk', 'api-v3.mbta.com', 'eonet.gsfc.nasa.gov',
  'www.gdacs.org', 'll.thespacedevs.com', 'overpass-api.de', 'cdn.deflock.me', 'overpass.kumi.systems',
  'overpass.private.coffee', 'maps.mail.ru', 'api.open-meteo.com', 'air-quality-api.open-meteo.com',
  'api.inaturalist.org', 'api.panoramax.xyz', 'panoramax.openstreetmap.fr', 'nominatim.openstreetmap.org',
  'photon.komoot.io', 'routing.openstreetmap.de', 'router.project-osrm.org', 'services3.arcgis.com',
  'services6.arcgis.com', 'mapservices.weather.noaa.gov', 'api.rainviewer.com', 'earthquake.usgs.gov',
  'de1.api.radio-browser.info', 'all.api.radio-browser.info', 'gbfs.citibikenyc.com', 'gbfs.divvybikes.com',
  'gbfs.baywheels.com', 'gbfs.capitalbikeshare.com', 'gbfs.bluebikes.com', 'velib-metropole-opendata.smovengo.cloud',
  'tiles.openfreemap.org', 'api.weather.gov', 'data.austintexas.gov', 'cctv.austinmobility.io',
];
const allowed = (host) => ALLOW.some((h) => host === h || host.endsWith('.' + h)) || /\.dot\.ca\.gov$/.test(host);

/* ---------------------------------------------------------------- flights */
// Compact row: [hex, callsign, lat, lon, altM, gsMS, track, vrateMS, ground(0/1), squawk, type, reg, category, tsSec, flags]
// flags: 1 = military, 2 = emergency
const FT = 0.3048, KT = 0.514444, FPM = 0.00508;
const EMERGENCY_SQUAWKS = new Set(['7500', '7600', '7700']);
function fromAdsbx(a, now, forceMil = false) {
  if (typeof a.lat !== 'number' || typeof a.lon !== 'number') return null;
  const ground = a.alt_baro === 'ground';
  const altFt = ground ? 0 : typeof a.alt_geom === 'number' ? a.alt_geom : typeof a.alt_baro === 'number' ? a.alt_baro : 0;
  let flags = 0;
  if (forceMil || (a.dbFlags & 1)) flags |= 1;
  if ((a.emergency && a.emergency !== 'none') || EMERGENCY_SQUAWKS.has(a.squawk)) flags |= 2;
  return [
    String(a.hex || '').replace('~', '').toLowerCase(), (a.flight || '').trim(),
    +a.lat.toFixed(5), +a.lon.toFixed(5), Math.round(altFt * FT), +((a.gs || 0) * KT).toFixed(1),
    Math.round(a.track ?? a.true_heading ?? a.mag_heading ?? 0),
    +(((a.baro_rate ?? a.geom_rate) || 0) * FPM).toFixed(1), ground ? 1 : 0, a.squawk || '',
    a.t || '', a.r || '', a.category || '', Math.round(now - (a.seen_pos || 0)), flags,
  ];
}
async function flightsGlobal() {
  const { body } = await get('https://opensky-network.org/api/states/all?extended=1', { timeout: 25000 });
  const d = JSON.parse(body);
  const rows = [];
  for (const s of d.states || []) {
    if (s[5] == null || s[6] == null) continue;
    const sq = s[14] || '';
    rows.push([
      s[0], (s[1] || '').trim(), +s[6].toFixed(4), +s[5].toFixed(4), Math.round(s[13] ?? s[7] ?? 0),
      +(s[9] || 0).toFixed(1), Math.round(s[10] || 0), +(s[11] || 0).toFixed(1), s[8] ? 1 : 0, sq,
      '', '', s[17] != null ? 'O' + s[17] : '', s[3] || s[4] || d.time, EMERGENCY_SQUAWKS.has(sq) ? 2 : 0, s[2] || '',
    ]);
  }
  return json({ source: 'OpenSky Network', time: d.time, rows });
}
async function flightsRegion(lat, lon, r) {
  const now = Date.now() / 1000;
  const sources = [
    ['adsb.lol', `https://api.adsb.lol/v2/point/${lat}/${lon}/${r}`],
    ['adsb.fi', `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${r}`],
  ];
  // Community feeds drop out now and then: ask both, use whichever answers first.
  return Promise.any(sources.map(async ([name, url]) => {
    const { body } = await get(url, { timeout: 9000 });
    const d = JSON.parse(body);
    const rows = (d.ac || d.aircraft || []).map((a) => fromAdsbx(a, now)).filter(Boolean);
    return json({ source: name, time: now, rows });
  }));
}
async function flightsMil() {
  const now = Date.now() / 1000;
  return Promise.any([['adsb.lol', 'https://api.adsb.lol/v2/mil'], ['adsb.fi', 'https://opendata.adsb.fi/api/v2/mil']].map(async ([name, url]) => {
    const { body } = await get(url, { timeout: 12000 });
    const rows = (JSON.parse(body).ac || []).map((a) => fromAdsbx(a, now, true)).filter(Boolean);
    if (!rows.length) throw new Error('empty');
    return json({ source: name, time: now, rows });
  }));
}
async function flightTrack(hex) {
  const { body } = await get(`https://opensky-network.org/api/tracks/all?icao24=${hex}&time=0`, { timeout: 12000 });
  const d = JSON.parse(body);
  return json({ callsign: (d.callsign || '').trim(), path: (d.path || []).map((p) => [p[0], p[1], p[2], p[3] || 0]) });
}

/* ------------------------------------------------------------------ fires */
async function fires() {
  const { body } = await get('https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv', { timeout: 30000 });
  const lines = body.split('\n');
  const head = lines[0].split(',');
  const ix = (n) => head.indexOf(n);
  const iLat = ix('latitude'), iLon = ix('longitude'), iB = ix('brightness'), iD = ix('acq_date'), iT = ix('acq_time'),
    iC = ix('confidence'), iF = ix('frp'), iN = ix('daynight'), iS = ix('satellite');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    if (c.length < head.length) continue;
    const conf = +c[iC];
    if (conf < 30) continue;
    rows.push([+(+c[iLat]).toFixed(3), +(+c[iLon]).toFixed(3), +c[iF], Math.round(+c[iB]), conf, c[iN] === 'N' ? 1 : 0, `${c[iD]}T${c[iT].padStart(4, '0').replace(/(..)(..)/, '$1:$2')}Z`, c[iS]]);
  }
  return json({ source: 'NASA FIRMS MODIS C6.1, trailing 24 h', rows });
}

/* ------------------------------------------------------------------- GNSS */
async function gnss() {
  // gpsjam publishes one file per UTC day; try the last three days.
  for (let back = 1; back <= 4; back++) {
    const day = new Date(Date.now() - back * 864e5).toISOString().slice(0, 10);
    try {
      const { body } = await get(`https://gpsjam.org/data/${day}-h3_4.csv`, { timeout: 20000 });
      const rows = [];
      for (const line of body.split('\n').slice(1)) {
        const [hex, good, bad] = line.split(',');
        const g = +good, b = +bad;
        if (!hex || g + b < 4) continue;
        const pct = b / (g + b);
        if (pct < 0.02) continue;
        rows.push([hex, g, b]);
      }
      return json({ source: 'gpsjam.org (aggregated ADS-B navigation accuracy)', day, rows });
    } catch { /* try an earlier day */ }
  }
  throw new Error('gnss unavailable');
}

/* ------------------------------------------------------------------- news */
// GDELT 2.0 event export: latest 15-minute files, physical-conflict and protest root codes.
function unzipFirst(buf) {
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('not a zip');
  const method = buf.readUInt16LE(8);
  let compSize = buf.readUInt32LE(18);
  const nameLen = buf.readUInt16LE(26), extraLen = buf.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  if (!compSize) compSize = buf.length - start;
  const data = buf.subarray(start, start + compSize);
  return method === 0 ? data : zlib.inflateRawSync(data);
}
const CAMEO = { 14: 'Protest', 18: 'Assault', 19: 'Armed clash', 20: 'Mass violence' };
const CONFLICT_WORDS = /\b(attack|kill|dead|death|deadly|dies|strike|airstrike|bomb|shoot|shot|war|missile|drone|troops|army|military|clash|protest|riot|explo|blast|militant|rebel|hostage|soldier|gunm|shell|raid|violen|massacre|ambush|terror|insurg|coup|wounded|injur|stabb|assault|murder|unrest|demonstrat|rally|ceasefire|offensive|militia|sniper|kidnap|abduct|frontline|invasion|siege|rocket|gunfire|casualt)/i;
const VIOLENT = new Set([145, 180, 181, 182, 183, 185, 186, 193, 194, 195, 200, 201, 202, 203, 204]);
function titleFromUrl(u) {
  try {
    const p = new URL(u);
    const segs = p.pathname.split('/').filter(Boolean);
    let s = segs.sort((a, b) => b.length - a.length)[0] || p.hostname;
    s = decodeURIComponent(s).replace(/\.(html?|php|aspx?)$/i, '').replace(/[-_+]+/g, ' ').replace(/\b\d{5,}\b/g, '').trim();
    if (s.length < 12) return p.hostname.replace(/^www\./, '');
    return s.charAt(0).toUpperCase() + s.slice(1);
  } catch { return 'Report'; }
}
// Events accumulate in memory while the server runs: four hours on first load, up to 24 h after that.
const newsStore = { files: new Set(), items: new Map() };
async function news() {
  const { body: last } = await get('http://data.gdeltproject.org/gdeltv2/lastupdate.txt', { timeout: 12000 });
  const m = last.match(/https?:\/\/\S+?(\d{14})\.export\.CSV\.zip/);
  if (!m) throw new Error('gdelt index unreadable');
  const stamp = m[1];
  const t0 = Date.UTC(+stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8), +stamp.slice(8, 10), +stamp.slice(10, 12));
  const files = [];
  for (let k = 0; k < 16; k++) {
    const s = new Date(t0 - k * 15 * 60000).toISOString().replace(/[-:T]/g, '').slice(0, 12) + '00';
    if (!newsStore.files.has(s)) files.push(s);
  }
  await Promise.all(files.map(async (s) => {
    try {
      const { body } = await get(`http://data.gdeltproject.org/gdeltv2/${s}.export.CSV.zip`, { timeout: 20000, binary: true });
      const text = unzipFirst(body).toString('utf8');
      const t = Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12));
      for (const line of text.split('\n')) {
        const c = line.split('\t');
        if (c.length < 61) continue;
        const root = +c[28], base = +c[27];
        if (!CAMEO[root]) continue;
        // "Fight" and "protest" verbs are often metaphorical in news text: keep the physically specific codes,
        // and generic ones only when several articles agree.
        if (!VIOLENT.has(base) && +c[33] < 4) continue;
        const lat = +c[56], lon = +c[57], url = c[60];
        if (!c[56] || !c[57] || !Number.isFinite(lat) || !Number.isFinite(lon) || !url) continue;
        if (newsStore.items.has(url)) continue;
        // The event coder misreads business and sports "fights" as violence, so the headline itself has to agree.
        const headline = titleFromUrl(url);
        if (!CONFLICT_WORDS.test(headline) && !(/[^\x00-\x7f]/.test(headline) && +c[33] >= 6 && VIOLENT.has(base))) continue;
        let host = ''; try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
        newsStore.items.set(url, { id: c[0], kind: CAMEO[root], root, lat: +lat.toFixed(3), lon: +lon.toFixed(3), place: c[52], cc: c[53], mentions: +c[31] || 1, tone: +(+c[34] || 0).toFixed(1), title: headline, host, url, t });
      }
      newsStore.files.add(s);
    } catch { /* a missing 15-minute file is fine */ }
  }));
  const cut = Date.now() - 24 * 3600000;
  for (const [k, v] of newsStore.items) if (v.t < cut) newsStore.items.delete(k);
  const items = [...newsStore.items.values()].sort((a, b) => b.t - a.t || b.mentions - a.mentions);
  if (!items.length) throw new Error('no events');
  return json({ source: 'GDELT 2.0 event files (machine-coded; places can be wrong)', items: items.slice(0, 1500) });
}

/* -------------------------------------------------------------------- AIS */
// Optional: live global ships through AISStream when the user has added their own free key.
const ais = { ws: null, ships: new Map(), key: '', lastMsg: 0 };
function readKeys() { try { return JSON.parse(readFileSync(KEYFILE, 'utf8')); } catch { return {}; } }
function startAis() {
  const key = process.env.AISSTREAM_API_KEY || readKeys().aisstream || '';
  if (!key || ais.ws || typeof WebSocket === 'undefined') return;
  ais.key = key;
  try {
    const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');
    ais.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ APIKey: key, BoundingBoxes: [[[-90, -180], [90, 180]]], FilterMessageTypes: ['PositionReport', 'ShipStaticData'] }));
    ws.onmessage = async (ev) => {
      try {
        const text = typeof ev.data === 'string' ? ev.data : Buffer.from(await ev.data.arrayBuffer()).toString('utf8');
        const m = JSON.parse(text);
        const meta = m.MetaData || {};
        const id = meta.MMSI;
        if (!id) return;
        const s = ais.ships.get(id) || { mmsi: id };
        s.name = (meta.ShipName || s.name || '').trim();
        if (m.MessageType === 'PositionReport') {
          const p = m.Message.PositionReport;
          Object.assign(s, { lat: p.Latitude, lon: p.Longitude, sog: p.Sog, cog: p.Cog, hdg: p.TrueHeading, t: Date.now() });
        } else if (m.MessageType === 'ShipStaticData') {
          const p = m.Message.ShipStaticData;
          Object.assign(s, { type: p.Type, dest: (p.Destination || '').trim(), callsign: (p.CallSign || '').trim(), draught: p.MaximumStaticDraught });
        }
        ais.ships.set(id, s);
        ais.lastMsg = Date.now();
        if (ais.ships.size > 30000) {
          const cut = Date.now() - 30 * 60000;
          for (const [k, v] of ais.ships) if ((v.t || 0) < cut) ais.ships.delete(k);
        }
      } catch { /* ignore malformed frames */ }
    };
    ws.onclose = ws.onerror = () => { ais.ws = null; setTimeout(startAis, 15000); };
  } catch { ais.ws = null; }
}
function aisSnapshot() {
  const cut = Date.now() - 20 * 60000;
  const rows = [];
  for (const s of ais.ships.values()) {
    if (s.lat == null || (s.t || 0) < cut) continue;
    rows.push([s.mmsi, s.name || '', +s.lat.toFixed(4), +s.lon.toFixed(4), s.sog || 0, s.cog || 0, s.hdg ?? 511, s.type || 0, s.dest || '', Math.round(s.t / 1000)]);
  }
  return json({ source: 'AISStream', live: !!ais.ws, rows });
}

/* --------------------------------------------------------------- handlers */
function send(res, entry, extra = {}) {
  const head = { 'Content-Type': entry.type, 'Cache-Control': 'no-store', 'X-Argus-Stale': entry.stale ? '1' : '0', ...extra };
  // Large JSON tables (cameras, fires) are compressed once and reused.
  if (typeof entry.body === 'string' && entry.body.length > 200000 && /gzip/.test(res.req?.headers['accept-encoding'] || '')) {
    entry.gz ||= zlib.gzipSync(entry.body);
    res.writeHead(entry.status || 200, { ...head, 'Content-Encoding': 'gzip' });
    return res.end(entry.gz);
  }
  res.writeHead(entry.status || 200, head);
  res.end(entry.body);
}
function fail(res, code, msg) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: msg }));
}
const isLoopback = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

async function api(req, res, url) {
  const p = url.pathname;
  const q = url.searchParams;
  try {
    if (p === '/api/health') return send(res, json({ ok: true, ais: !!ais.key, aisLive: !!ais.ws, version: '1.0.0' }));
    if (p === '/api/flights/global') return send(res, await cached('fl:global', 15 * 60000, flightsGlobal));
    if (p === '/api/flights/region') {
      const lat = Math.max(-89, Math.min(89, +q.get('lat'))), lon = +q.get('lon');
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return fail(res, 400, 'lat and lon are required');
      const r = Math.max(25, Math.min(250, Math.round(+q.get('r') || 250)));
      const la = (Math.round(lat * 2) / 2).toFixed(1), lo = (Math.round(lon * 2) / 2).toFixed(1);
      return send(res, await cached(`fl:r:${la}:${lo}:${r}`, 6000, () => flightsRegion(la, lo, r)));
    }
    if (p === '/api/flights/mil') return send(res, await cached('fl:mil', 20000, flightsMil));
    if (p === '/api/flights/track') {
      const hex = (q.get('hex') || '').toLowerCase();
      if (!/^[0-9a-f]{6}$/.test(hex)) return fail(res, 400, 'bad hex');
      return send(res, await cached(`fl:t:${hex}`, 120000, () => flightTrack(hex)));
    }
    if (p === '/api/cameras') return send(res, await cached('cameras', 30 * 60000, () => cameraMesh(readKeys().cams || {})));
    if (p === '/api/cameras/keyed') {
      // Which key-gated networks exist and which already have a key. The keys themselves never leave the server.
      const have = readKeys().cams || {};
      return send(res, json(Object.entries(KEYED).map(([code, [name, host, region]]) => ({ code, name, region, signup: `https://${host}/developers/doc`, saved: !!have[code] }))));
    }
    if (p === '/api/fires') return send(res, await cached('fires', 30 * 60000, fires));
    if (p === '/api/gnss') return send(res, await cached('gnss', 6 * 3600000, gnss));
    if (p === '/api/news') return send(res, await cached('news', 12 * 60000, news));
    if (p === '/api/ais') { startAis(); return send(res, aisSnapshot()); }
    if (p === '/api/keys' && req.method === 'POST') {
      if (!isLoopback(req)) return fail(res, 403, 'keys can only be saved from this machine');
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 4096) return fail(res, 413, 'too large'); }
      const body = JSON.parse(raw || '{}');
      const keys = readKeys();
      if (typeof body.aisstream === 'string') keys.aisstream = body.aisstream.trim();
      if (body.cams && typeof body.cams === 'object') {
        keys.cams ||= {};
        for (const [code, v] of Object.entries(body.cams)) {
          if (!KEYED[code] || typeof v !== 'string') continue;
          if (v.trim()) keys.cams[code] = v.trim().slice(0, 200); else delete keys.cams[code];
        }
        cache.delete('cameras'); // rebuild the mesh with the new networks
      }
      writeFileSync(KEYFILE, JSON.stringify(keys), { mode: 0o600 });
      if (ais.ws) { try { ais.ws.close(); } catch { /* ignore */ } ais.ws = null; }
      ais.key = ''; startAis();
      return send(res, json({ ok: true }));
    }
    if (p === '/api/p') {
      const target = q.get('u');
      let u; try { u = new URL(target); } catch { return fail(res, 400, 'bad url'); }
      // Camera frames may be relayed from any host an official camera list pointed at (GET only).
      const camFrame = req.method === 'GET' && cameraHosts.has(u.hostname);
      if (!/^https?:$/.test(u.protocol) || !(allowed(u.hostname) || camFrame)) return fail(res, 403, 'host not allowed');
      const ttl = Math.max(0, Math.min(86400, +q.get('ttl') || 60)) * 1000;
      const binary = q.get('b') === '1';
      const headers = {};
      if (u.hostname.endsWith('digitraffic.fi')) { headers['Digitraffic-User'] = 'Argus/local'; headers['Accept-Encoding'] = 'gzip'; }
      if (req.method === 'POST') {
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (raw.length > 20000) return fail(res, 413, 'too large'); }
        const entry = await cached(`post:${target}:${raw}`, ttl, async () => {
          const r = await fetch(target, { method: 'POST', body: raw, headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(28000) });
          if (!r.ok) throw Object.assign(new Error(`upstream ${r.status}`), { status: r.status });
          return { status: 200, type: r.headers.get('content-type') || 'application/json', body: await r.text() };
        });
        return send(res, entry);
      }
      const entry = await cached(`p:${target}`, ttl, () => get(target, { binary, headers, timeout: 28000 }));
      return send(res, entry, binary ? { 'Cache-Control': 'public, max-age=20' } : {});
    }
    return fail(res, 404, 'unknown endpoint');
  } catch (err) {
    return fail(res, err.status === 429 ? 429 : 502, err.message || 'upstream failed');
  }
}

/* ------------------------------------------------------------- app server */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
function serveStatic(req, res, url) {
  const dist = path.join(ROOT, 'dist');
  let file = path.normalize(path.join(dist, decodeURIComponent(url.pathname)));
  if (!file.startsWith(dist)) return fail(res, 403, 'forbidden');
  if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(dist, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

let vite = null;
if (!PROD) {
  const { createServer } = await import('vite');
  vite = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: { port: PORT + 1 } }, appType: 'spa', logLevel: 'warn' });
} else if (!existsSync(path.join(ROOT, 'dist/index.html'))) {
  console.error('No dist/ found. Run "npm run build" first.');
  process.exit(1);
}

const handler = (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) return void api(req, res, url);
  if (vite) return vite.middlewares(req, res, () => fail(res, 404, 'not found'));
  return serveStatic(req, res, url);
};
// Loopback only, on both IPv4 and IPv6 so "localhost" works in every browser.
http.createServer(handler).listen(PORT, '127.0.0.1', () => {
  startAis();
  console.log(`\n  ARGUS is live  ->  http://localhost:${PORT}\n`);
});
http.createServer(handler).on('error', () => {}).listen(PORT, '::1');
