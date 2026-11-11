// Events: earthquakes (USGS), active fires (NASA FIRMS), fire perimeters (WFIGS), natural events (NASA EONET).
import { C, scene, viewer } from '../core/viewer.js';
import { defineLayer } from './base.js';
import { PointSet } from './points.js';
import { getJSON } from '../core/net.js';
import { ago, latlon } from '../core/geo.js';

/* ------------------------------------------------------------ earthquakes */
let qs = null, qTick = null;
const magColor = (m) => (m >= 6 ? '#ff4d42' : m >= 4.5 ? '#ff8a3d' : m >= 3 ? '#ffc247' : '#e8d9a8');
defineLayer({
  id: 'earthquakes', name: 'Earthquakes', group: 'Events', color: '#ff8a3d', icon: 'quake', trust: 'live',
  blurb: 'Global seismic activity, last 24 hours', source: 'USGS', aliases: ['earthquakes', 'earthquake', 'quakes', 'seismic'],
  enable(L) {
    qs = new PointSet('earthquakes');
    L.poll(async () => {
      const d = await getJSON('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson');
      const items = d.features.filter((f) => f.geometry && f.properties.mag != null).map((f) => ({ key: f.id, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], depth: f.geometry.coordinates[2], mag: f.properties.mag, place: f.properties.place || 'Unknown location', time: f.properties.time, url: f.properties.url, tsunami: f.properties.tsunami, felt: f.properties.felt, sig: f.properties.sig, type: f.properties.type }));
      qs.set(items, (q) => ({ shape: 'ring', color: magColor(q.mag), size: Math.round(12 + Math.max(0, q.mag) * 5.5) }));
      L.setCount(items.length);
      const top = items.reduce((a, b) => (b.mag > (a?.mag ?? -1) ? b : a), null);
      L.note = top ? `Strongest M${top.mag.toFixed(1)} ${top.place}` : '';
    }, 120000);
    qTick = scene.preUpdate.addEventListener(() => {
      // Fresh quakes (under an hour) breathe so they stand out.
      const t = Date.now();
      for (const q of qs.values()) if (t - q.time < 3600000 && q._g) q._g.scale = 1 + 0.22 * Math.sin(t / 380 + q.lat);
    });
  },
  disable() { qTick?.(); qs?.destroy(); qs = null; },
  contacts: () => (qs ? [...qs.values()].filter((q) => q.mag >= 2.5).map((q) => ({ key: q.key, L: 'earthquakes', label: `M${q.mag.toFixed(1)}`, lat: q.lat, lon: q.lon, alt: 0, mag: q.mag, color: magColor(q.mag), time: q.time, place: q.place })) : []),
  position: (k, r) => qs?.position(k, r) || null,
  info(k, brief) {
    const q = qs?.get(k);
    if (!q) return null;
    if (brief) return { title: `M${q.mag.toFixed(1)} ${q.place}`, kind: 'Earthquake', sub: ago(q.time) };
    return {
      title: `Magnitude ${q.mag.toFixed(1)}`, kind: 'Earthquake', sub: q.place, color: magColor(q.mag), range: 600000, pitch: -60, lat: q.lat, lon: q.lon, alt: 0,
      stats: [[q.mag.toFixed(1), 'M', 'Magnitude'], [Math.round(q.depth), 'km', 'Depth'], [ago(q.time).replace(' ago', ''), '', 'Since']],
      rows: [['Time (UTC)', new Date(q.time).toISOString().replace('T', ' ').slice(0, 19)], ['Epicentre', latlon(q.lat, q.lon)], ['Significance', `${q.sig} / 1000`], ['Felt reports', q.felt ? String(q.felt) : 'None yet'], ['Tsunami flag', q.tsunami ? 'Yes' : 'No'], ['Details', `<a href="${q.url}" target="_blank" rel="noopener">USGS event page</a>`]],
    };
  },
});

/* ------------------------------------------------------------------ fires */
let fs = null;
const frpColor = (f) => (f >= 300 ? '#fff3c2' : f >= 80 ? '#ffb347' : f >= 20 ? '#ff7a2f' : '#f0452a');
defineLayer({
  id: 'fires', name: 'Active fires', group: 'Events', color: '#ff6a36', icon: 'flame', trust: 'delayed',
  blurb: 'Satellite heat detections, trailing 24 hours', source: 'NASA FIRMS (MODIS)', aliases: ['fires', 'fire', 'wildfires', 'firms', 'hotspots'],
  enable(L) {
    fs = new PointSet('fires', { near: 2e5, nearScale: 1.8, far: 2e7, farScale: 0.8 });
    L.poll(async () => {
      const d = await getJSON('/api/fires', { timeout: 45000 });
      const items = d.rows.map((r, i) => ({ key: 'f' + i, lat: r[0], lon: r[1], frp: r[2], bright: r[3], conf: r[4], night: r[5], time: r[6], sat: r[7] }));
      fs.set(items, (f) => ({ color: frpColor(f.frp), size: f.frp >= 300 ? 6 : f.frp >= 80 ? 4.5 : 3.2, alpha: 0.88, outline: 0 }));
      L.setCount(items.length);
    }, 30 * 60000);
  },
  disable() { fs?.destroy(); fs = null; },
  contacts: () => (fs ? [...fs.values()].filter((f) => f.frp >= 60).map((f) => ({ key: f.key, L: 'fires', label: `${Math.round(f.frp)} MW`, lat: f.lat, lon: f.lon, alt: 0, frp: f.frp, color: frpColor(f.frp) })) : []),
  all: () => (fs ? [...fs.values()] : []),
  position: (k, r) => fs?.position(k, r) || null,
  info(k, brief) {
    const f = fs?.get(k);
    if (!f) return null;
    if (brief) return { title: `Fire · ${Math.round(f.frp)} MW`, kind: 'Heat detection', sub: `${f.conf}% confidence` };
    const t = Date.parse(f.time);
    return {
      title: `${Math.round(f.frp).toLocaleString()} MW`, kind: 'Active fire detection', sub: `Seen by ${f.sat === 'T' ? 'Terra' : f.sat === 'A' ? 'Aqua' : f.sat} ${ago(t)}`, color: frpColor(f.frp), range: 60000, pitch: -50, lat: f.lat, lon: f.lon, alt: 0, nearestCam: true,
      stats: [[Math.round(f.frp), 'MW', 'Radiative power'], [f.bright, 'K', 'Brightness'], [f.conf, '%', 'Confidence']],
      rows: [['Detected (UTC)', f.time.replace('T', ' ').replace('Z', '')], ['Overpass', f.night ? 'Night' : 'Day'], ['Position', latlon(f.lat, f.lon)]],
      note: 'One satellite pixel (about 1 km) that looked hot. Not every detection is a wildfire: gas flares, volcanoes and industry also show up.',
    };
  },
});

/* -------------------------------------------------------- fire perimeters */
let perim = null;
defineLayer({
  id: 'perimeters', name: 'Fire perimeters', group: 'Events', color: '#ff9a5c', icon: 'area', trust: 'delayed',
  blurb: 'US incident boundaries and containment', source: 'WFIGS / NIFC', aliases: ['perimeters', 'fire perimeters'],
  async enable(L) {
    const url = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query?where=1%3D1&outFields=poly_IncidentName,attr_PercentContained,poly_GISAcres,attr_FireCause,attr_FireDiscoveryDateTime,attr_POOState&f=geojson&geometryPrecision=3&maxAllowableOffset=0.002&resultRecordCount=400&orderByFields=poly_GISAcres%20DESC';
    const gj = await getJSON(url, { timeout: 40000 });
    perim = await C.GeoJsonDataSource.load(gj, { stroke: C.Color.fromCssColorString('#ff9a5c'), fill: C.Color.fromCssColorString('#ff6a36').withAlpha(0.22), strokeWidth: 2, clampToGround: false });
    perim.entities.values.forEach((e, i) => { e.argus = { L: 'perimeters', k: i }; });
    viewer.dataSources.add(perim);
    L.setCount(gj.features.length);
    L._f = gj.features;
  },
  disable() { if (perim) viewer.dataSources.remove(perim, true); perim = null; },
  position(k, r) {
    const e = perim?.entities.values[k];
    const h = e?.polygon?.hierarchy?.getValue(C.JulianDate.now());
    if (!h?.positions?.length) return null;
    return C.BoundingSphere.fromPoints(h.positions).center.clone(r);
  },
  info(k, brief) {
    const e = perim?.entities.values[k];
    if (!e) return null;
    const p = e.properties.getValue(C.JulianDate.now());
    const name = p.poly_IncidentName || 'Unnamed incident';
    if (brief) return { title: name, kind: 'Fire perimeter', sub: p.attr_POOState || '' };
    const acres = p.poly_GISAcres || 0;
    return {
      title: name, kind: 'Fire perimeter', sub: (p.attr_POOState || '').replace('US-', ''), color: '#ff9a5c', range: Math.max(20000, Math.sqrt(acres * 4047) * 6), pitch: -55,
      stats: [[Math.round(acres).toLocaleString(), 'ac', 'Mapped area'], [p.attr_PercentContained ?? '—', '%', 'Contained'], [p.attr_FireCause || '—', '', 'Cause']],
      rows: [['Discovered', p.attr_FireDiscoveryDateTime ? new Date(p.attr_FireDiscoveryDateTime).toISOString().slice(0, 10) : 'Unknown']], nearestCam: true,
    };
  },
});

/* --------------------------------------------------------- natural events */
let ev = null;
const EV = { volcanoes: ['tri', '#ff5d8f'], severeStorms: ['cyclone', '#8fd3ff'], seaLakeIce: ['hex', '#bfe9ff'], wildfires: ['flame', '#ff8a3d'], floods: ['diamond', '#5aa9ff'], dustHaze: ['dot', '#d9b98a'] };
defineLayer({
  id: 'hazards', name: 'Volcanoes and storms', group: 'Events', color: '#ff5d8f', icon: 'alert', trust: 'delayed',
  blurb: 'Open natural events with their tracks', source: 'NASA EONET', aliases: ['hazards', 'volcanoes', 'volcano', 'storms', 'natural events', 'eonet'],
  enable(L) {
    ev = new PointSet('hazards');
    L.poll(async () => {
      const d = await getJSON('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30&limit=300', { timeout: 30000 });
      const items = [];
      for (const e of d.events) {
        const g = e.geometry?.[e.geometry.length - 1];
        if (!g || g.type !== 'Point') continue;
        const cat = e.categories?.[0]?.id || 'other';
        if (cat === 'wildfires') continue; // covered by the fire layers
        items.push({ key: e.id, lat: g.coordinates[1], lon: g.coordinates[0], title: e.title, cat, catName: e.categories?.[0]?.title || 'Event', date: g.date, mag: g.magnitudeValue, unit: g.magnitudeUnit, link: e.sources?.[0]?.url || e.link, track: e.geometry.filter((x) => x.type === 'Point').map((x) => [x.coordinates[1], x.coordinates[0], 0]) });
      }
      ev.set(items, (e) => ({ shape: (EV[e.cat] || ['diamond'])[0], color: (EV[e.cat] || [0, '#e9ede6'])[1], size: 24 }));
      L.setCount(items.length);
    }, 30 * 60000);
  },
  disable() { ev?.destroy(); ev = null; },
  contacts: () => (ev ? [...ev.values()].map((e) => ({ key: e.key, L: 'hazards', label: e.title.slice(0, 22), lat: e.lat, lon: e.lon, alt: 0, color: (EV[e.cat] || [0, '#e9ede6'])[1] })) : []),
  position: (k, r) => ev?.position(k, r) || null,
  trail: (k) => { const e = ev?.get(k); return e && e.track.length > 1 ? e.track : null; },
  trailVersion: () => 1,
  trailColor: '#8fd3ff',
  info(k, brief) {
    const e = ev?.get(k);
    if (!e) return null;
    if (brief) return { title: e.title, kind: e.catName, sub: ago(Date.parse(e.date)) };
    return {
      title: e.title, kind: e.catName, sub: `Last report ${ago(Date.parse(e.date))}`, color: (EV[e.cat] || [0, '#e9ede6'])[1], range: 900000, pitch: -60, lat: e.lat, lon: e.lon,
      stats: [[e.mag ?? '—', e.unit || '', 'Magnitude'], [e.track.length, '', 'Reports'], [new Date(e.date).toISOString().slice(5, 10), '', 'Updated']],
      rows: [['Position', latlon(e.lat, e.lon)], ['Source', `<a href="${e.link}" target="_blank" rel="noopener">Open report</a>`]], nearestCam: e.cat === 'volcanoes',
    };
  },
});
