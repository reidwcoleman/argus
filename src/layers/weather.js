// Weather, all keyless: animated forecast wind, observed rain radar and satellite clouds on one
// history timeline, tropical cyclones, and city air quality.
import { C, viewer, scene, camera, camInfo, viewRadiusM, addOverlay, removeOverlay, toScreen } from '../core/viewer.js';
import { defineLayer, setLayer, registry } from './base.js';
import { PointSet } from './points.js';
import { getJSON } from '../core/net.js';
import { on, emit } from '../core/bus.js';
import { compass, fmtSpeed, latlon, ago, clamp, esc } from '../core/geo.js';
import { registerPanel } from '../ui/shell.js';
import { $, icon } from '../ui/dom.js';
import { CITIES } from '../data/places.js';

/* ------------------------------------------------------------------- wind */
const GX = 36, GY = 17; // 10 degree grid, lon -180..170, lat -80..80
let grid = null, windTick = null, parts = null, lastCam = '';
const N = 2600;
async function loadWind() {
  const lats = [], lons = [];
  for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) { lats.push(-80 + j * 10); lons.push(-180 + i * 10); }
  const u = new Float32Array(GX * GY), v = new Float32Array(GX * GY);
  const CH = 153;
  const jobs = [];
  for (let s = 0; s < lats.length; s += CH) {
    const la = lats.slice(s, s + CH).join(','), lo = lons.slice(s, s + CH).join(',');
    jobs.push(getJSON(`https://api.open-meteo.com/v1/gfs?latitude=${la}&longitude=${lo}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms`, { timeout: 40000 }).then((d) => {
      (Array.isArray(d) ? d : [d]).forEach((p, k) => {
        const sp = p.current?.wind_speed_10m || 0, dir = ((p.current?.wind_direction_10m || 0) * Math.PI) / 180;
        u[s + k] = -sp * Math.sin(dir); v[s + k] = -sp * Math.cos(dir);
      });
    }));
  }
  await Promise.all(jobs);
  grid = { u, v, at: Date.now() };
}
export function windAt(lat, lon) {
  if (!grid) return null;
  const x = (((lon + 180) % 360) + 360) % 360 / 10, y = clamp((lat + 80) / 10, 0, GY - 1.001);
  const x0 = Math.floor(x) % GX, x1 = (x0 + 1) % GX, y0 = Math.floor(y), y1 = Math.min(GY - 1, y0 + 1), fx = x - Math.floor(x), fy = y - y0;
  const s = (a) => (a[y0 * GX + x0] * (1 - fx) + a[y0 * GX + x1] * fx) * (1 - fy) + (a[y1 * GX + x0] * (1 - fx) + a[y1 * GX + x1] * fx) * fy;
  const u = s(grid.u), v = s(grid.v);
  return { u, v, speed: Math.hypot(u, v), from: (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360 };
}
const RAMP = ['rgba(150,200,255,0.55)', 'rgba(170,240,210,0.7)', 'rgba(200,245,90,0.85)', 'rgba(255,196,84,0.95)', 'rgba(255,110,90,1)'];
function windFrame() {
  const cv = document.getElementById('wind');
  const g = cv.getContext('2d');
  const dpr = Math.min(2, devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const p = camera.positionWC, d = camera.directionWC;
  const sig = `${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)},${d.x.toFixed(4)},${d.y.toFixed(4)}`;
  const moved = sig !== lastCam;
  lastCam = sig;
  if (moved) { g.clearRect(0, 0, w, h); for (let i = 0; i < N; i++) parts[i * 6 + 5] = 0; }
  else { g.globalCompositeOperation = 'destination-in'; g.fillStyle = 'rgba(0,0,0,0.925)'; g.fillRect(0, 0, w, h); g.globalCompositeOperation = 'source-over'; }
  if (!grid) return;
  const cam = camInfo();
  const span = clamp((viewRadiusM() / 111000) * 1.25, 0.4, 85);
  const lonSpan = cam.range > 9e6 ? 100 : span / Math.max(0.25, Math.cos(cam.clat * Math.PI / 180));
  const k = span * 0.00042;
  const paths = RAMP.map(() => new Path2D());
  const c3 = new C.Cartesian3();
  for (let i = 0; i < N; i++) {
    const o = i * 6;
    let lon = parts[o], lat = parts[o + 1], age = parts[o + 2];
    if (age <= 0 || Math.abs(lat) > 84) {
      lon = cam.clon + (Math.random() * 2 - 1) * lonSpan; lat = clamp(cam.clat + (Math.random() * 2 - 1) * span, -82, 82);
      lon = ((lon + 540) % 360) - 180;
      parts[o] = lon; parts[o + 1] = lat; parts[o + 2] = 40 + Math.random() * 70; parts[o + 5] = 0;
      continue;
    }
    const wv = windAt(lat, lon);
    const nlon = lon + (wv.u * k) / Math.max(0.2, Math.cos(lat * Math.PI / 180)), nlat = lat + wv.v * k;
    const sc = toScreen(C.Cartesian3.fromDegrees(nlon, nlat, 0, C.Ellipsoid.WGS84, c3));
    if (!sc || sc.x < -20 || sc.y < -20 || sc.x > w + 20 || sc.y > h + 20) { parts[o + 2] = 0; continue; }
    if (parts[o + 5] === 1) {
      const dx = sc.x - parts[o + 3], dy = sc.y - parts[o + 4];
      if (dx * dx + dy * dy < 900) { const b = paths[Math.min(4, Math.floor(wv.speed / 4))]; b.moveTo(parts[o + 3], parts[o + 4]); b.lineTo(sc.x, sc.y); }
    }
    parts[o] = ((nlon + 540) % 360) - 180; parts[o + 1] = nlat; parts[o + 2] = age - 1; parts[o + 3] = sc.x; parts[o + 4] = sc.y; parts[o + 5] = 1;
  }
  g.lineWidth = 1.15; g.lineCap = 'round';
  paths.forEach((b, i) => { g.strokeStyle = RAMP[i]; g.stroke(b); });
}
defineLayer({
  id: 'wind', name: 'Wind', group: 'Weather', color: '#aaf0d2', icon: 'wind', trust: 'est',
  blurb: 'Animated 10 m forecast flow', source: 'NOAA GFS via Open-Meteo', aliases: ['wind', 'winds'],
  enable(L) {
    parts = new Float32Array(N * 6);
    L.poll(async () => { await loadWind(); L.note = `Model run read ${ago(grid.at)}`; emit('weather'); }, 45 * 60000);
    windTick = scene.postRender.addEventListener(windFrame);
  },
  disable() { windTick?.(); windTick = null; const cv = document.getElementById('wind'); cv.getContext('2d').clearRect(0, 0, cv.width, cv.height); },
});

/* ---------------------------------------------------- observed: radar + clouds */
const obs = { frames: [], host: '', idx: -1, playing: false, timer: null, radar: null, clouds: [] };
async function loadFrames() {
  const d = await getJSON('https://api.rainviewer.com/public/weather-maps.json', { timeout: 20000 });
  obs.host = d.host;
  obs.frames = (d.radar?.past || []).map((f) => ({ time: f.time * 1000, path: f.path }));
  if (obs.idx < 0 || obs.idx >= obs.frames.length) obs.idx = obs.frames.length - 1;
  emit('weather');
}
function showRadar() {
  const f = obs.frames[obs.idx];
  const old = obs.radar;
  obs.radar = null;
  if (f && registry.get('radar').enabled) {
    obs.radar = addOverlay(new C.UrlTemplateImageryProvider({ url: `${obs.host}${f.path}/256/{z}/{x}/{y}/4/1_1.png`, maximumLevel: 7, minimumLevel: 0 }), { alpha: 0.78 });
  }
  if (old) setTimeout(() => removeOverlay(old), 350); // cross-fade without a blank frame
}
const GIBS = ['GOES-East_ABI_Band13_Clean_Infrared', 'GOES-West_ABI_Band13_Clean_Infrared', 'Himawari_AHI_Band13_Clean_Infrared'];
function showClouds() {
  const old = obs.clouds;
  obs.clouds = [];
  if (registry.get('clouds').enabled) {
    const f = obs.frames[obs.idx];
    const latest = !f || obs.idx === obs.frames.length - 1;
    // Geostationary imagery lands about 40 minutes late, so step the requested time back to something that exists.
    const t = latest ? 'default' : new Date(Math.floor((f.time - 30 * 60000) / 600000) * 600000).toISOString().slice(0, 19) + 'Z';
    for (const id of GIBS) obs.clouds.push(addOverlay(new C.UrlTemplateImageryProvider({ url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${id}/default/${t}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`, maximumLevel: 6 }), { alpha: 0.5, brightness: 1.15, contrast: 1.5 }));
  }
  setTimeout(() => old.forEach(removeOverlay), 400);
}
function setFrame(i) {
  if (!obs.frames.length) return;
  obs.idx = (i + obs.frames.length) % obs.frames.length;
  showRadar(); showClouds();
  emit('weather');
}
function play(v) {
  obs.playing = v;
  clearInterval(obs.timer);
  if (v) obs.timer = setInterval(() => setFrame(obs.idx + 1), 700);
  emit('weather');
}
defineLayer({
  id: 'radar', name: 'Rain radar', group: 'Weather', color: '#6fb7ff', icon: 'radar', trust: 'live',
  blurb: 'Observed precipitation, two hours of history', source: 'RainViewer', aliases: ['radar', 'rain', 'rain radar', 'precipitation'],
  enable(L) { L.poll(async () => { const was = obs.frames.length; const atEnd = obs.idx === was - 1; await loadFrames(); if (atEnd) obs.idx = obs.frames.length - 1; showRadar(); L.note = obs.frames.length ? `Latest scan ${ago(obs.frames[obs.frames.length - 1].time)}` : ''; }, 5 * 60000); },
  disable() { removeOverlay(obs.radar); obs.radar = null; if (!registry.get('clouds').enabled) play(false); },
});
defineLayer({
  id: 'clouds', name: 'Satellite clouds', group: 'Weather', color: '#e6edf5', icon: 'cloud', trust: 'delayed',
  blurb: 'Geostationary infrared: GOES and Himawari', source: 'NASA GIBS', aliases: ['clouds', 'satellite clouds', 'cloud cover', 'infrared'],
  async enable() { if (!obs.frames.length) await loadFrames().catch(() => {}); showClouds(); },
  disable() { obs.clouds.forEach(removeOverlay); obs.clouds = []; if (!registry.get('radar').enabled) play(false); },
});

/* --------------------------------------------------------------- cyclones */
let cy = null, cyTrack = null;
const cyColor = (kmh) => (kmh >= 209 ? '#ff4d8d' : kmh >= 154 ? '#ff6a45' : kmh >= 119 ? '#ffa23f' : kmh >= 63 ? '#ffd65a' : '#8fd3ff');
const saffir = (kmh) => (kmh >= 252 ? 'Category 5' : kmh >= 209 ? 'Category 4' : kmh >= 178 ? 'Category 3' : kmh >= 154 ? 'Category 2' : kmh >= 119 ? 'Category 1' : kmh >= 63 ? 'Tropical storm' : 'Tropical depression');
defineLayer({
  id: 'cyclones', name: 'Cyclones', group: 'Weather', color: '#ffa23f', icon: 'cyclone', trust: 'live',
  blurb: 'Active tropical systems and their tracks', source: 'NOAA NHC · GDACS', aliases: ['cyclones', 'cyclone', 'hurricanes', 'hurricane', 'typhoons', 'typhoon', 'tropical storms'],
  enable(L) {
    cy = new PointSet('cyclones', { near: 5e5, nearScale: 1.4, far: 3e7, farScale: 0.85 });
    L.poll(async () => {
      const items = [];
      await Promise.allSettled([
        getJSON('https://www.nhc.noaa.gov/CurrentStorms.json', { proxy: true, ttl: 600 }).then((d) => {
          for (const s of d.activeStorms || []) items.push({ key: 'nhc' + s.id, lat: s.latitudeNumeric, lon: s.longitudeNumeric, name: s.name, kmh: (+s.intensity || 0) * 1.852, pressure: s.pressure, moveDir: s.movementDir, moveKt: s.movementSpeed, updated: Date.parse(s.lastUpdate), src: 'NOAA National Hurricane Center', link: s.publicAdvisory?.url || 'https://www.nhc.noaa.gov' });
        }),
        getJSON('https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC&alertlevel=Green;Orange;Red', { proxy: true, ttl: 900, timeout: 30000 }).then((d) => {
          for (const f of d.features || []) {
            const p = f.properties;
            if (!p.iscurrent || p.iscurrent === 'false') continue;
            const name = (p.eventname || p.name || '').replace(/^Tropical Cyclone /i, '');
            if (items.some((x) => x.name.toLowerCase() === name.toLowerCase().replace(/-\d+$/, ''))) continue;
            items.push({ key: 'gd' + p.eventid, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], name: name.replace(/-\d+$/, ''), kmh: p.severitydata?.severity || 0, updated: Date.parse(p.todate), country: p.country, alert: p.alertlevel, src: 'GDACS', link: p.url?.report, geo: p.url?.geometry });
          }
        }),
      ]);
      cy.set(items, (s) => ({ shape: 'cyclone', color: cyColor(s.kmh), size: 30 }));
      L.setCount(items.length);
      if (!items.length) L.setStatus('empty', 'No active tropical cyclones right now');
      else L.note = items.map((s) => s.name).slice(0, 3).join(', ');
    }, 15 * 60000);
  },
  disable() { cy?.destroy(); cy = null; if (cyTrack) viewer.dataSources.remove(cyTrack, true); cyTrack = null; },
  contacts: () => (cy ? [...cy.values()].map((s) => ({ key: s.key, L: 'cyclones', label: s.name, lat: s.lat, lon: s.lon, alt: 0, color: cyColor(s.kmh) })) : []),
  position: (k, r) => cy?.position(k, r) || null,
  async onSelect(k) {
    const s = cy?.get(k);
    if (cyTrack) { viewer.dataSources.remove(cyTrack, true); cyTrack = null; }
    if (!s?.geo) return;
    try {
      const gj = await getJSON(s.geo, { proxy: true, ttl: 900, timeout: 30000 });
      gj.features = (gj.features || []).filter((f) => f.geometry && f.geometry.type !== 'Point');
      cyTrack = await C.GeoJsonDataSource.load(gj, { stroke: C.Color.fromCssColorString('#ffd65a'), fill: C.Color.fromCssColorString('#ffa23f').withAlpha(0.12), strokeWidth: 2 });
      viewer.dataSources.add(cyTrack);
    } catch { /* the marker alone is still useful */ }
  },
  onDeselect() { if (cyTrack) viewer.dataSources.remove(cyTrack, true); cyTrack = null; },
  info(k, brief) {
    const s = cy?.get(k);
    if (!s) return null;
    if (brief) return { title: s.name, kind: saffir(s.kmh), sub: `${Math.round(s.kmh)} km/h` };
    const [sv, su] = fmtSpeed(s.kmh / 3.6);
    return {
      title: s.name, kind: saffir(s.kmh), sub: s.country || 'Open ocean', color: cyColor(s.kmh), range: 2.4e6, pitch: -70, lat: s.lat, lon: s.lon,
      stats: [[sv, su, 'Sustained wind'], [s.pressure || '—', s.pressure ? 'hPa' : '', 'Pressure'], [s.moveKt != null ? `${s.moveKt}` : '—', s.moveKt != null ? `kt ${compass(s.moveDir || 0)}` : '', 'Moving']],
      rows: [['Centre', latlon(s.lat, s.lon)], ['Advisory', ago(s.updated)], ['Source', esc(s.src)]], link: s.link, linkLabel: 'Advisory',
      note: s.geo ? 'The outline is the forecast track and its uncertainty cone.' : '',
    };
  },
});

/* ------------------------------------------------------------ air quality */
let aq = null;
const aqiColor = (v) => (v > 300 ? '#8f3f97' : v > 200 ? '#c44fd0' : v > 150 ? '#ff5d52' : v > 100 ? '#ff9c3f' : v > 50 ? '#ffe14d' : '#5fdc93');
const aqiBand = (v) => (v > 300 ? 'Hazardous' : v > 200 ? 'Very unhealthy' : v > 150 ? 'Unhealthy' : v > 100 ? 'Unhealthy for sensitive groups' : v > 50 ? 'Moderate' : 'Good');
defineLayer({
  id: 'airquality', name: 'Air quality', group: 'Weather', color: '#ffe14d', icon: 'aq', trust: 'est',
  blurb: 'US AQI for 150 world cities', source: 'Open-Meteo (CAMS model)', aliases: ['air quality', 'aqi', 'pollution', 'smog'],
  enable(L) {
    aq = new PointSet('airquality', { near: 3e5, nearScale: 1.5, far: 2.5e7, farScale: 0.8 });
    L.poll(async () => {
      const d = await getJSON(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${CITIES.map((c) => c.lat).join(',')}&longitude=${CITIES.map((c) => c.lon).join(',')}&current=us_aqi,pm2_5,pm10,nitrogen_dioxide,ozone`, { timeout: 40000 });
      const items = (Array.isArray(d) ? d : [d]).map((p, i) => ({ key: 'aq' + i, lat: CITIES[i].lat, lon: CITIES[i].lon, name: CITIES[i].name, where: CITIES[i].where, aqi: p.current?.us_aqi, pm25: p.current?.pm2_5, pm10: p.current?.pm10, no2: p.current?.nitrogen_dioxide, o3: p.current?.ozone })).filter((x) => x.aqi != null);
      aq.set(items, (x) => ({ color: aqiColor(x.aqi), size: 9 + Math.min(9, x.aqi / 30), alpha: 0.85 }));
      L.setCount(items.length);
      const worst = items.reduce((a, b) => (b.aqi > (a?.aqi ?? -1) ? b : a), null);
      L.note = worst ? `Worst right now: ${worst.name}, AQI ${worst.aqi}` : '';
      emit('weather');
    }, 30 * 60000);
  },
  disable() { aq?.destroy(); aq = null; },
  contacts: () => (aq ? [...aq.values()].map((x) => ({ key: x.key, L: 'airquality', label: `AQI ${x.aqi}`, lat: x.lat, lon: x.lon, alt: 0, color: aqiColor(x.aqi), aqi: x.aqi, name: x.name })) : []),
  position: (k, r) => aq?.position(k, r) || null,
  all: () => (aq ? [...aq.values()] : []),
  info(k, brief) {
    const x = aq?.get(k);
    if (!x) return null;
    if (brief) return { title: `${x.name} · AQI ${x.aqi}`, kind: 'Air quality', sub: aqiBand(x.aqi) };
    return {
      title: `AQI ${x.aqi}`, kind: 'Air quality', sub: `${x.name}, ${x.where} · ${aqiBand(x.aqi)}`, color: aqiColor(x.aqi), range: 120000, pitch: -50, lat: x.lat, lon: x.lon,
      stats: [[x.pm25?.toFixed(0) ?? '—', 'µg/m³', 'PM2.5'], [x.pm10?.toFixed(0) ?? '—', 'µg/m³', 'PM10'], [x.no2?.toFixed(0) ?? '—', 'µg/m³', 'NO₂']],
      rows: [['Ozone', x.o3 != null ? `${x.o3.toFixed(0)} µg/m³` : '—'], ['Scale', 'US EPA AQI, 0 to 500']], note: 'Modelled by the Copernicus atmosphere service, not a ground sensor reading.',
    };
  },
});

/* ------------------------------------------------------------------ panel */
let here = null, hereKey = '';
async function loadHere() {
  const c = camInfo();
  if (!c.onGlobe) return;
  const key = c.clat.toFixed(1) + ',' + c.clon.toFixed(1);
  if (key === hereKey) return;
  hereKey = key;
  try {
    const d = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${c.clat.toFixed(3)}&longitude=${c.clon.toFixed(3)}&current=temperature_2m,apparent_temperature,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,precipitation,surface_pressure&wind_speed_unit=ms`, { timeout: 15000 });
    here = { ...d.current, lat: c.clat, lon: c.clon };
    emit('weather');
  } catch { /* keep the previous reading */ }
}
const WMO = { 0: 'Clear sky', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Showers', 81: 'Showers', 82: 'Violent showers', 85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with hail' };
export const wmoText = (c) => WMO[c] || 'Unsettled';
export async function weatherAt(lat, lon) {
  const d = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=temperature_2m,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,visibility&wind_speed_unit=ms`, { timeout: 12000 });
  return d.current;
}

registerPanel({
  id: 'weather', title: 'Weather', icon: 'cloud', key: 'W',
  render(body) {
    const row = (id) => { const L = registry.get(id); return `<button class="row ${L.enabled ? 'on' : ''}" role="switch" aria-checked="${L.enabled}" data-layer="${id}" style="--c:${L.color}"><span class="glyph">${icon(L.icon, 17)}</span><span><span class="name">${L.name}</span><span class="meta ${L.status === 'error' ? 'err' : ''}">${esc(L.enabled ? L.note || (L.status === 'loading' ? 'Loading' : L.source) : L.blurb)}</span></span><span class="right">${L.enabled && L.status === 'loading' ? '<span class="spinner"></span>' : ''}<span class="switch"></span></span></button>`; };
    const draw = () => {
      const top = body.scrollTop;
      const f = obs.frames[obs.idx], last = obs.frames.length - 1;
      const anyObs = registry.get('radar').enabled || registry.get('clouds').enabled;
      const w = here ? windAt(here.lat, here.lon) : null;
      const [ws, wu] = here ? fmtSpeed(here.wind_speed_10m) : ['—', ''];
      body.innerHTML = `
        <div class="tuner" style="margin-top:2px">
          <span class="eyebrow">At the centre of your view</span>
          ${here ? `<div style="display:flex;align-items:baseline;gap:10px;margin-top:10px"><span class="mono" style="font-size:34px;font-weight:500;letter-spacing:-0.04em">${Math.round(here.temperature_2m)}°</span><span style="font-size:14px;font-weight:500">${wmoText(here.weather_code)}</span></div>
          <div class="note" style="padding:6px 0 0">Wind ${ws} ${wu} from the ${compass(here.wind_direction_10m)} · cloud ${here.cloud_cover}% · ${Math.round(here.surface_pressure)} hPa${here.precipitation ? ` · ${here.precipitation} mm rain` : ''}</div>` : '<div class="skel" style="margin:10px 0 0"></div>'}
        </div>
        <section class="group"><div class="group-head"><span class="eyebrow">Forecast</span></div>${row('wind')}
          ${registry.get('wind').enabled ? `<div class="legend" style="background:linear-gradient(90deg,#96c8ff,#aaf0d2,#c8f55a,#ffc454,#ff6e5a)"></div><div class="legend-l"><span>calm</span><span>${w ? `here ${fmtSpeed(w.speed).join(' ')} from ${compass(w.from)}` : ''}</span><span>20 m/s</span></div>` : ''}</section>
        <section class="group"><div class="group-head"><span class="eyebrow">Observed</span></div>${row('radar')}${row('clouds')}
          ${anyObs && f ? `<div class="timeline"><div class="tl-top"><span class="tl-time">${new Date(f.time).toISOString().slice(11, 16)} UTC<small>${obs.idx === last ? 'latest' : ago(f.time)}</small></span>
            <span style="display:flex;gap:4px"><button class="btn sm" data-a="play">${icon(obs.playing ? 'pause' : 'play', 13)}${obs.playing ? 'Pause' : 'Play'}</button><button class="btn sm" data-a="latest" ${obs.idx === last ? 'disabled' : ''}>Latest</button></span></div>
            <div class="ticks">${obs.frames.map((x, i) => `<button class="${i === obs.idx ? 'cur' : i < obs.idx ? 'past' : ''}" data-f="${i}" aria-label="Frame ${new Date(x.time).toISOString().slice(11, 16)}"></button>`).join('')}</div></div>` : ''}</section>
        <section class="group"><div class="group-head"><span class="eyebrow">Hazards and air</span></div>${row('cyclones')}${row('airquality')}
          ${registry.get('airquality').enabled ? `<div class="legend" style="background:linear-gradient(90deg,#5fdc93,#ffe14d,#ff9c3f,#ff5d52,#c44fd0,#8f3f97)"></div><div class="legend-l"><span>good</span><span>US AQI</span><span>hazardous</span></div>` : ''}</section>
        <p class="note" style="margin-top:14px">Wind is a forecast model. Radar and clouds are observations, about 10 and 40 minutes behind. Lightning is not included: no open feed allows it.</p>`;
      body.scrollTop = top;
    };
    body.addEventListener('click', (e) => {
      const r = e.target.closest('[data-layer]'); if (r) return void setLayer(r.dataset.layer, !registry.get(r.dataset.layer).enabled);
      const fr = e.target.closest('[data-f]'); if (fr) { play(false); return setFrame(+fr.dataset.f); }
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'play') play(!obs.playing);
      if (a === 'latest') { play(false); setFrame(obs.frames.length - 1); }
    });
    let raf = 0;
    const q = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };
    const offs = [on('weather', q), on('layers', q), on('layers:toggle', q), on('camera:end', loadHere)];
    hereKey = ''; loadHere(); draw();
    return () => offs.forEach((f) => f());
  },
});
