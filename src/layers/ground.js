// Ground-level and regional context: ALPR cameras, mapped installations, restricted airspace,
// wildlife sightings, GNSS integrity, simulated traffic, street-level photos.
import { C, viewer, scene, camInfo, viewRadiusM } from '../core/viewer.js';
import { defineLayer, registry } from './base.js';
import { PointSet } from './points.js';
import { getJSON, overpass, prox, HOSTED, localOnly } from '../core/net.js';
import { on, emit } from '../core/bus.js';
import { latlon, distM, ago, clamp, esc, fmtDist } from '../core/geo.js';
import { el, ui, icon, toast } from '../ui/dom.js';
import { select } from '../core/select.js';

/** Runs `load(box, cam)` whenever the view settles inside `maxRange`, and only when it has moved enough to matter. */
function viewBound(L, maxRange, load, capKm = 40) {
  let last = null, busy = false;
  const run = async () => {
    if (!L.enabled || busy) return;
    const cam = camInfo();
    if (!cam.onGlobe || cam.range > maxRange) { L.setStatus('zoom', `Zoom in below ${Math.round(maxRange / 1000)} km to load this area`); return; }
    const r = clamp(viewRadiusM() * 1.3, 1500, capKm * 1000);
    if (last && distM(last.lat, last.lon, cam.clat, cam.clon) < last.r * 0.45 && r < last.r * 1.6) return;
    busy = true;
    const dLat = r / 111000, dLon = r / (111000 * Math.max(0.2, Math.cos(cam.clat * Math.PI / 180)));
    const box = { s: cam.clat - dLat, n: cam.clat + dLat, w: cam.clon - dLon, e: cam.clon + dLon, lat: cam.clat, lon: cam.clon, r };
    L.setStatus('loading', 'Loading this area');
    try { const n = await load(box, cam); last = { lat: cam.clat, lon: cam.clon, r }; if (L.enabled) { L.setCount(n); L.setStatus(n ? 'live' : 'empty', n ? '' : 'Nothing mapped in this view'); } }
    catch (e) { if (L.enabled) L.setStatus('error', /timed out|Timeout/i.test(e.message) ? 'OpenStreetMap servers are busy. Move the map to retry.' : 'The source is not answering. Move the map to retry.'); }
    finally { busy = false; }
  };
  const off = on('camera:end', run);
  L._off = () => { off(); last = null; };
  return run();
}

/* -------------------------------------------------------------------- ALPR */
let alpr = null;
defineLayer({
  id: 'alpr', name: 'Mapped ALPR cameras', group: 'Cameras', color: '#ff7b6b', icon: 'scan', trust: 'static',
  blurb: 'Licence-plate readers tagged in OpenStreetMap', source: 'DeFlock · OpenStreetMap contributors', aliases: ['alpr', 'plate readers', 'license plate readers', 'flock'],
  enable(L) {
    if (HOSTED) throw localOnly(); // the DeFlock files do not allow cross-site reads
    alpr = new PointSet('alpr', { near: 2e3, nearScale: 1.3, far: 2e5, farScale: 0.6 });
    const regions = new Map();
    const region = (lat, lon) => {
      const k = `${Math.floor(lat / 20) * 20}/${Math.floor(lon / 20) * 20}`;
      if (!regions.has(k)) regions.set(k, getJSON(`https://cdn.deflock.me/regions/${k}.json`, { proxy: true, ttl: 86400, timeout: 60000 }).catch(() => { regions.delete(k); return []; }));
      return regions.get(k);
    };
    return viewBound(L, 120000, async (b) => {
      const keys = new Set(), lists = [];
      for (const [la, lo] of [[b.s, b.w], [b.s, b.e], [b.n, b.w], [b.n, b.e]]) { const k = `${Math.floor(la / 20)}/${Math.floor(lo / 20)}`; if (!keys.has(k)) { keys.add(k); lists.push(region(la, lo)); } }
      const items = [];
      for (const list of await Promise.all(lists)) for (const n of list) if (n.lat >= b.s && n.lat <= b.n && n.lon >= b.w && n.lon <= b.e) items.push({ key: 'n' + n.id, lat: n.lat, lon: n.lon, t: n.tags || {} });
      items.sort((x, y) => distM(b.lat, b.lon, x.lat, x.lon) - distM(b.lat, b.lon, y.lat, y.lon));
      alpr.set(items.slice(0, 3000), () => ({ shape: 'hex', color: '#ff7b6b', size: 15 }));
      return alpr.size;
    });
  },
  disable(L) { L._off?.(); alpr?.destroy(); alpr = null; },
  contacts: () => (alpr ? [...alpr.values()].map((a) => ({ key: a.key, L: 'alpr', label: 'ALPR', lat: a.lat, lon: a.lon, alt: 4, color: '#ff7b6b' })) : []),
  position: (k, r) => alpr?.position(k, r) || null,
  all: () => (alpr ? [...alpr.values()] : []),
  info(k, brief) {
    const a = alpr?.get(k);
    if (!a) return null;
    const t = a.t, who = t.operator || t.manufacturer || t.brand || '';
    if (brief) return { title: 'Plate reader', kind: 'ALPR camera', sub: who };
    return {
      title: who || 'Licence-plate reader', kind: 'Mapped ALPR camera', sub: t['surveillance:zone'] ? `Watching ${t['surveillance:zone']}` : 'Location and tags only', color: '#ff7b6b', range: 500, pitch: -40, lat: a.lat, lon: a.lon,
      rows: [['Operator', esc(t.operator || 'Not tagged')], ['Make', esc(t.manufacturer || t.brand || 'Not tagged')], ['Facing', t.direction ? esc(t.direction) + '°' : 'Not tagged'], ['Mount', esc(t['camera:mount'] || 'Not tagged')], ['Position', latlon(a.lat, a.lon)]],
      note: 'A location tagged by volunteer mappers. There is no plate data and no video here, and the map is incomplete.',
    };
  },
});

/* ----------------------------------------------------------- installations */
let inst = null;
defineLayer({
  id: 'installations', name: 'Mapped installations', group: 'Infrastructure', color: '#d9a441', icon: 'shield', trust: 'static',
  blurb: 'Publicly documented military sites', source: 'Wikidata (CC0)', aliases: ['installations', 'military bases', 'bases', 'military sites', 'air bases'],
  async enable(L) {
    inst = new PointSet('installations', { near: 2e4, nearScale: 1.3, far: 2e7, farScale: 0.55 });
    const d = await getJSON('/data/installations.json', { timeout: 30000 });
    inst.set(d.map((r) => ({ key: r[0], lat: r[1], lon: r[2], name: r[3], type: r[4], country: r[5] })), () => ({ shape: 'square', color: '#d9a441', size: 11 }));
    L.setCount(d.length);
  },
  disable() { inst?.destroy(); inst = null; },
  contacts: () => (inst ? [...inst.values()].map((a) => ({ key: a.key, L: 'installations', label: a.name.slice(0, 22), lat: a.lat, lon: a.lon, alt: 0, color: '#d9a441' })) : []),
  position: (k, r) => inst?.position(k, r) || null,
  info(k, brief) {
    const a = inst?.get(k);
    if (!a) return null;
    const type = a.type.charAt(0).toUpperCase() + a.type.slice(1);
    if (brief) return { title: a.name, kind: 'Mapped installation', sub: type };
    return { title: a.name, kind: 'Mapped installation', sub: [type, a.country].filter(Boolean).join(' · '), color: '#d9a441', range: 9000, pitch: -45, lat: a.lat, lon: a.lon, rows: [['Country', esc(a.country || 'Not recorded')], ['Position', latlon(a.lat, a.lon)]], link: `https://www.wikidata.org/wiki/${a.key}`, linkLabel: 'Wikidata', note: 'From public reference data. Incomplete, and some sites are historic.' };
  },
});

/* ---------------------------------------------------------------- airspace */
let sua = null;
defineLayer({
  id: 'airspace', name: 'Restricted airspace', group: 'Infrastructure', color: '#ff5d6c', icon: 'ban', trust: 'static',
  blurb: 'FAA prohibited and restricted areas', source: 'FAA special use airspace', aliases: ['airspace', 'restricted airspace', 'prohibited airspace', 'no fly zones'],
  async enable(L) {
    const base = 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Special_Use_Airspace/FeatureServer/0/query?where=TYPE_CODE%20IN%20(%27P%27,%27R%27)&outFields=NAME,TYPE_CODE,UPPER_VAL,UPPER_UOM,LOWER_VAL,LOWER_UOM,TIMESOFUSE,CITY,STATE&f=geojson&geometryPrecision=3&maxAllowableOffset=0.004&resultRecordCount=1000';
    const pages = await Promise.all([0, 1000].map((o) => getJSON(`${base}&resultOffset=${o}`, { timeout: 45000 }).catch(() => ({ features: [] }))));
    const gj = { type: 'FeatureCollection', features: pages.flatMap((p) => p.features || []) };
    if (!gj.features.length) throw new Error('FAA airspace service did not answer');
    sua = await C.GeoJsonDataSource.load(gj, { stroke: C.Color.fromCssColorString('#ff5d6c').withAlpha(0.9), fill: C.Color.fromCssColorString('#ff5d6c').withAlpha(0.13), strokeWidth: 1.5 });
    sua.entities.values.forEach((e, i) => { e.argus = { L: 'airspace', k: i }; if (e.polygon && e.properties?.TYPE_CODE?.getValue() === 'P') e.polygon.material = C.Color.fromCssColorString('#ff2f55').withAlpha(0.28); });
    viewer.dataSources.add(sua);
    L.setCount(gj.features.length);
  },
  disable() { if (sua) viewer.dataSources.remove(sua, true); sua = null; },
  position(k, r) {
    const h = sua?.entities.values[k]?.polygon?.hierarchy?.getValue(C.JulianDate.now());
    return h?.positions?.length ? C.BoundingSphere.fromPoints(h.positions).center.clone(r) : null;
  },
  info(k, brief) {
    const e = sua?.entities.values[k];
    if (!e) return null;
    const p = e.properties.getValue(C.JulianDate.now());
    const kind = p.TYPE_CODE === 'P' ? 'Prohibited area' : 'Restricted area';
    if (brief) return { title: p.NAME, kind, sub: p.STATE || '' };
    const h = e.polygon.hierarchy.getValue(C.JulianDate.now());
    const alt = (v, u) => (v == null || v === '' ? 'Not published' : +v === 0 ? 'Surface' : +v < 0 ? 'Unlimited' : `${(+v).toLocaleString()} ${u === 'FL' ? 'FL' : 'ft'}`);
    return { title: p.NAME, kind, sub: [p.CITY, p.STATE].filter(Boolean).join(', '), color: '#ff5d6c', range: Math.max(30000, C.BoundingSphere.fromPoints(h.positions).radius * 3.5), pitch: -60, rows: [['Floor', alt(p.LOWER_VAL, p.LOWER_UOM)], ['Ceiling', alt(p.UPPER_VAL, p.UPPER_UOM)], ['Times of use', esc(p.TIMESOFUSE || 'Not published')]], note: 'Informational only. Not for flight planning.' };
  },
});

/* ---------------------------------------------------------------- wildlife */
let wild = null;
const TAXA = { Aves: '#ffd166', Mammalia: '#ff9e6b', Reptilia: '#9be564', Amphibia: '#5ee6a8', Actinopterygii: '#6fc3ff', Insecta: '#e6b3ff', Plantae: '#7ed67e', Fungi: '#d9a441', Arachnida: '#ff8ad8', Mollusca: '#b8c7ff' };
defineLayer({
  id: 'wildlife', name: 'Wildlife sightings', group: 'Events', color: '#b7e66b', icon: 'paw', trust: 'delayed',
  blurb: 'Verified sightings from the last 48 hours', source: 'iNaturalist', aliases: ['wildlife', 'animals', 'sightings', 'inaturalist'],
  enable(L) {
    wild = new PointSet('wildlife', { near: 5e3, nearScale: 1.25, far: 8e5, farScale: 0.6 });
    return viewBound(L, 600000, async (b) => {
      const d1 = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
      const d = await getJSON(`https://api.inaturalist.org/v1/observations?nelat=${b.n}&nelng=${b.e}&swlat=${b.s}&swlng=${b.w}&d1=${d1}&per_page=200&photos=true&geoprivacy=open&order_by=observed_on&verifiable=true`, { timeout: 30000 });
      const items = [];
      for (const o of d.results) {
        if (!o.geojson || o.obscured) continue;
        items.push({ key: 'i' + o.id, lat: o.geojson.coordinates[1], lon: o.geojson.coordinates[0], name: o.taxon?.preferred_common_name || o.species_guess || o.taxon?.name || 'Unidentified', sci: o.taxon?.name || '', group: o.taxon?.iconic_taxon_name || 'Other', when: o.time_observed_at || o.observed_on, who: o.user?.login, lic: o.photos?.[0]?.license_code, photo: o.photos?.[0]?.url?.replace('square', 'medium'), uri: o.uri, grade: o.quality_grade, place: o.place_guess });
      }
      wild.set(items, (x) => ({ shape: 'paw', color: TAXA[x.group] || '#b7e66b', size: 20 }));
      return items.length;
    }, 300);
  },
  disable(L) { L._off?.(); wild?.destroy(); wild = null; },
  contacts: () => (wild ? [...wild.values()].map((a) => ({ key: a.key, L: 'wildlife', label: a.name.slice(0, 20), lat: a.lat, lon: a.lon, alt: 0, color: TAXA[a.group] || '#b7e66b' })) : []),
  position: (k, r) => wild?.position(k, r) || null,
  info(k, brief) {
    const a = wild?.get(k);
    if (!a) return null;
    if (brief) return { title: a.name, kind: 'Sighting', sub: a.group };
    return {
      title: a.name, kind: `Wildlife sighting · ${a.group}`, sub: a.sci, color: TAXA[a.group] || '#b7e66b', range: 2500, pitch: -45, lat: a.lat, lon: a.lon,
      photo: a.photo ? { url: a.photo, credit: `${a.who || 'observer'} · ${(a.lic || 'all rights reserved').toUpperCase()}` } : null,
      rows: [['Observed', a.when ? ago(Date.parse(a.when)) : 'Recently'], ['Where', esc(a.place || latlon(a.lat, a.lon))], ['Grade', a.grade === 'research' ? 'Research grade' : 'Needs ID'], ['Observer', esc(a.who || 'Unknown')]], link: a.uri, linkLabel: 'iNaturalist',
      note: 'One person saw this here. It is not a census.',
    };
  },
});

/* -------------------------------------------------------------------- GNSS */
let gnssPrim = null, gnssRows = [];
defineLayer({
  id: 'gnss', name: 'GNSS integrity', group: 'Events', color: '#ff6b9d', icon: 'signal', trust: 'delayed',
  blurb: 'Where aircraft reported degraded GPS yesterday', source: 'gpsjam.org (ADS-B aggregation)', aliases: ['gnss', 'gps jamming', 'gps interference', 'jamming', 'gps'],
  async enable(L) {
    const [{ cellToBoundary, cellToLatLng }, d] = await Promise.all([import('h3-js'), getJSON('/api/gnss', { timeout: 40000 })]);
    const inst2 = [];
    gnssRows = [];
    for (const [hex, good, bad] of d.rows) {
      const pct = bad / (good + bad);
      if (pct < 0.1) continue;
      const b = cellToBoundary(hex);
      const lons = b.map((p) => p[1]);
      if (Math.max(...lons) - Math.min(...lons) > 180) continue;
      const [lat, lon] = cellToLatLng(hex);
      const col = pct > 0.3 ? C.Color.fromCssColorString('#ff2f55').withAlpha(0.5) : C.Color.fromCssColorString('#ffc247').withAlpha(0.34);
      gnssRows.push({ hex, lat, lon, good, bad, pct });
      inst2.push(new C.GeometryInstance({ id: { L: 'gnss', k: gnssRows.length - 1 }, geometry: new C.PolygonGeometry({ polygonHierarchy: new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(b.flatMap((p) => [p[1], p[0]]))), height: 0, vertexFormat: C.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT }), attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(col) } }));
    }
    gnssPrim = scene.primitives.add(new C.Primitive({ geometryInstances: inst2, appearance: new C.PerInstanceColorAppearance({ flat: true, translucent: true }), asynchronous: true }));
    L.setCount(gnssRows.length);
    L.note = `Day ${d.day}: ${gnssRows.filter((r) => r.pct > 0.3).length} high, ${gnssRows.filter((r) => r.pct <= 0.3).length} elevated`;
  },
  disable() { if (gnssPrim) scene.primitives.remove(gnssPrim); gnssPrim = null; },
  position(k, r) { const g = gnssRows[k]; return g ? C.Cartesian3.fromDegrees(g.lon, g.lat, 0, C.Ellipsoid.WGS84, r) : null; },
  info(k, brief) {
    const g = gnssRows[k];
    if (!g) return null;
    const lvl = g.pct > 0.3 ? 'High' : 'Elevated';
    if (brief) return { title: `${Math.round(g.pct * 100)}% degraded`, kind: 'GNSS integrity', sub: lvl };
    return { title: `${Math.round(g.pct * 100)}% degraded`, kind: `GNSS integrity · ${lvl}`, sub: latlon(g.lat, g.lon), color: g.pct > 0.3 ? '#ff2f55' : '#ffc247', range: 600000, pitch: -75, lat: g.lat, lon: g.lon, stats: [[g.bad, '', 'Low accuracy'], [g.good, '', 'Normal'], [g.good + g.bad, '', 'Aircraft']], note: 'Share of aircraft over this cell that reported poor navigation accuracy. An anomaly does not confirm deliberate interference.' };
  },
});

/* ----------------------------------------------------------------- traffic */
let cars = null, roads = [], carPts = null, trafficTick = null, tilesTpl = null;
const SPEED = { motorway: 29, trunk: 24, primary: 16, secondary: 13, tertiary: 11 };
function tile2lon(x, z) { return (x / 2 ** z) * 360 - 180; }
function tile2lat(y, z) { const n = Math.PI - (2 * Math.PI * y) / 2 ** z; return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); }
async function loadRoads(b) {
  const [{ VectorTile }, { default: Pbf }] = await Promise.all([import('@mapbox/vector-tile'), import('pbf')]);
  if (!tilesTpl) tilesTpl = (await getJSON('https://tiles.openfreemap.org/planet')).tiles[0];
  const z = 13, n = 2 ** z;
  const tx = Math.floor(((b.lon + 180) / 360) * n), ty = Math.floor(((1 - Math.log(Math.tan(b.lat * Math.PI / 180) + 1 / Math.cos(b.lat * Math.PI / 180)) / Math.PI) / 2) * n);
  const out = [];
  await Promise.all([-1, 0, 1].flatMap((dx) => [-1, 0, 1].map(async (dy) => {
    const x = tx + dx, y = ty + dy;
    try {
      const buf = await (await fetch(tilesTpl.replace('{z}', z).replace('{x}', x).replace('{y}', y), { signal: AbortSignal.timeout(20000) })).arrayBuffer();
      const layer = new VectorTile(new Pbf(buf)).layers.transportation;
      if (!layer) return;
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i), cls = f.properties.class;
        if (!SPEED[cls] || f.type !== 2) continue;
        for (const ring of f.loadGeometry()) {
          if (ring.length < 2) continue;
          const pts = ring.map((p) => [tile2lat(y + p.y / layer.extent, z), tile2lon(x + p.x / layer.extent, z)]);
          const carts = pts.map((p) => C.Cartesian3.fromDegrees(p[1], p[0], 1.5));
          const cum = [0];
          for (let k = 1; k < carts.length; k++) cum.push(cum[k - 1] + C.Cartesian3.distance(carts[k - 1], carts[k]));
          if (cum[cum.length - 1] > 60) out.push({ cls, carts, cum, len: cum[cum.length - 1], oneway: f.properties.oneway === 1 });
        }
      }
    } catch { /* a missing tile just leaves a gap */ }
  })));
  return out;
}
defineLayer({
  id: 'traffic', name: 'Traffic', group: 'Movement', color: '#ffe9a8', icon: 'car', trust: 'sim',
  blurb: 'Simulated vehicles on real roads', source: 'OpenStreetMap roads via OpenFreeMap', aliases: ['traffic', 'cars', 'vehicles'],
  enable(L) {
    carPts = scene.primitives.add(new C.PointPrimitiveCollection());
    cars = [];
    let last = performance.now();
    const tmp = new C.Cartesian3();
    trafficTick = scene.preUpdate.addEventListener(() => {
      const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
      for (const c of cars) {
        c.s += c.v * dt * c.dir;
        if (c.s > c.road.len) c.s -= c.road.len; else if (c.s < 0) c.s += c.road.len;
        const cum = c.road.cum;
        let i = c.i; if (i >= cum.length - 1 || cum[i] > c.s) i = 0;
        while (i < cum.length - 2 && cum[i + 1] < c.s) i++;
        c.i = i;
        c.pt.position = C.Cartesian3.lerp(c.road.carts[i], c.road.carts[i + 1], (c.s - cum[i]) / Math.max(1, cum[i + 1] - cum[i]), tmp);
      }
    });
    return viewBound(L, 14000, async (b) => {
      roads = await loadRoads(b);
      carPts.removeAll(); cars = [];
      const total = roads.reduce((a, r) => a + r.len * (r.cls === 'motorway' ? 3 : r.cls === 'trunk' ? 2 : 1), 0);
      const want = Math.min(900, Math.round(total / 140));
      for (let n = 0; n < want; n++) {
        let pick = Math.random() * total, road = roads[0];
        for (const r of roads) { pick -= r.len * (r.cls === 'motorway' ? 3 : r.cls === 'trunk' ? 2 : 1); if (pick <= 0) { road = r; break; } }
        if (!road) break;
        const v = SPEED[road.cls] * (0.75 + Math.random() * 0.4);
        cars.push({ road, s: Math.random() * road.len, v, dir: road.oneway || Math.random() < 0.5 ? 1 : -1, i: 0, pt: carPts.add({ position: road.carts[0], pixelSize: 4.5, color: C.Color.fromCssColorString(Math.random() < 0.12 ? '#ff6f61' : '#fff3c9'), outlineColor: C.Color.BLACK.withAlpha(0.7), outlineWidth: 1, scaleByDistance: new C.NearFarScalar(400, 1.6, 15000, 0.6) }) });
      }
      return cars.length;
    }, 6);
  },
  disable(L) { L._off?.(); trafficTick?.(); if (carPts) scene.primitives.remove(carPts); carPts = null; cars = null; roads = []; },
});

/* ------------------------------------------------------------ street level */
let streetEl = null, streetDot = null, streetOff = null;
function closeStreet() { streetEl?.remove(); streetEl = null; if (streetDot) viewer.entities.remove(streetDot); streetDot = null; }
function showPicture(f) {
  const p = f.properties, [lon, lat] = f.geometry.coordinates;
  const fov = p['pers:interior_orientation']?.field_of_view || 70, pano = fov >= 300;
  const next = f.links.find((l) => l.rel === 'next')?.href, prev = f.links.find((l) => l.rel === 'prev')?.href;
  const lic = f.links.find((l) => l.rel === 'license')?.href;
  const big = streetEl?.classList.contains('big');
  closeStreet();
  streetEl = el(`<section class="viewer surface ${big ? 'big' : ''}" aria-label="Street-level photo">
    <div class="viewer-head"><span class="eyebrow" style="color:#ffab5e">Panoramax${pano ? ' · 360°' : ''}</span><span class="t">${new Date(p.datetime).toISOString().slice(0, 10)} · facing ${Math.round(p['view:azimuth'] ?? 0)}°</span>
      <button class="icon-btn" data-a="prev" ${prev ? '' : 'disabled'} aria-label="Previous photo">${icon('prev', 15)}</button><button class="icon-btn" data-a="next" ${next ? '' : 'disabled'} aria-label="Next photo">${icon('next', 15)}</button>
      <button class="icon-btn" data-a="big" aria-label="Expand">${icon('expand', 16)}</button><button class="icon-btn" data-a="x" aria-label="Close">${icon('x', 16)}</button></div>
    <div class="viewer-stage">${pano ? `<div class="pano" style="background-image:url('${f.assets.sd.href}')"></div>` : `<img alt="Street-level photo" src="${f.assets.sd.href}">`}</div>
    <div class="viewer-foot"><span>${latlon(lat, lon)}</span><span>© ${esc(p['geovisio:producer'] || 'Panoramax contributors')} · <a href="${esc(lic || 'https://panoramax.fr')}" target="_blank" rel="noopener">${esc(p.license || 'licence')}</a></span></div></section>`);
  ui().appendChild(streetEl);
  streetDot = viewer.entities.add({ position: C.Cartesian3.fromDegrees(lon, lat, 0), point: { pixelSize: 11, color: C.Color.fromCssColorString('#ffab5e'), outlineColor: C.Color.BLACK, outlineWidth: 2, heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY } });
  const pn = streetEl.querySelector('.pano');
  if (pn) { let x = 0, drag = null; pn.onpointerdown = (e) => { drag = e.clientX - x; pn.setPointerCapture(e.pointerId); }; pn.onpointermove = (e) => { if (drag != null) { x = e.clientX - drag; pn.style.backgroundPositionX = x + 'px'; } }; pn.onpointerup = () => { drag = null; }; }
  const step = async (url) => { try { showPicture(await getJSON(url, { timeout: 20000 })); } catch { toast('That photo did not load.', 'err'); } };
  streetEl.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'x') closeStreet();
    if (a === 'big') streetEl.classList.toggle('big');
    if (a === 'next' && next) step(next);
    if (a === 'prev' && prev) step(prev);
  });
}
defineLayer({
  id: 'street', name: 'Street level', group: 'Cameras', color: '#ffab5e', icon: 'street', trust: 'static',
  blurb: 'Click a street for the nearest open photo', source: 'Panoramax contributors', aliases: ['street level', 'street view', 'streetview', 'panoramax'],
  enable(L) {
    L.setStatus('live', 'Zoom to a street and click it');
    streetOff = on('map:empty', async (p) => {
      if (camInfo().range > 60000) return toast('Zoom in below 60 km, then click a street.');
      const d = 0.0012;
      try {
        const r = await getJSON(`https://api.panoramax.xyz/api/search?bbox=${p.lon - d},${p.lat - d},${p.lon + d},${p.lat + d}&limit=40`, { timeout: 20000 });
        const best = (r.features || []).map((f) => [distM(p.lat, p.lon, f.geometry.coordinates[1], f.geometry.coordinates[0]), f]).sort((a, b) => a[0] - b[0])[0];
        if (!best) return toast('No open street-level photo within 130 m of that spot. Coverage is strongest in France and Belgium.');
        showPicture(best[1]);
        L.note = `Nearest photo was ${fmtDist(best[0])} from your click`;
        emit('layers', 'street');
      } catch { toast('Panoramax is not answering right now.', 'err'); }
    });
  },
  disable() { streetOff?.(); closeStreet(); },
});
void prox; void registry; void select;
