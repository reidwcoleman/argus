// Public camera mesh: official open traffic and weather cameras, with estimated viewsheds.
import { C, viewer, scene, camInfo, lookAt } from '../core/viewer.js';
import { defineLayer, setLayer, registry } from './base.js';
import { PointSet } from './points.js';
import { getJSON, prox } from '../core/net.js';
import { on, emit, state, set } from '../core/bus.js';
import { latlon, distM, fmtDist, dest, esc } from '../core/geo.js';
import { select, current } from '../core/select.js';
import { el, ui, icon, toast } from '../ui/dom.js';

const COLOR = '#9be564';
const DIR = { north: 0, northbound: 0, n: 0, east: 90, eastbound: 90, e: 90, south: 180, southbound: 180, s: 180, west: 270, westbound: 270, w: 270, northeast: 45, ne: 45, southeast: 135, se: 135, southwest: 225, sw: 225, northwest: 315, nw: 315 };
let cams = null, wedges = [], monitor = null, monitorTimer = null, viewerEl = null, hls = null;
const sources = {};

async function loadTfl(add) {
  const list = await getJSON('https://api.tfl.gov.uk/Place/Type/JamCam', { timeout: 40000 });
  for (const c of list) {
    const g = (k) => c.additionalProperties.find((p) => p.key === k)?.value;
    if (g('available') === 'false' || !g('imageUrl')) continue;
    add({ key: 'tfl' + c.id, lat: c.lat, lon: c.lon, name: c.commonName, src: 'Transport for London', place: 'London', img: g('imageUrl'), video: g('videoUrl'), dir: null });
  }
}
async function loadCaltrans(add) {
  const ds = [3, 4, 5, 6, 7, 8, 10, 11, 12, 1, 2, 9];
  let i = 0;
  const worker = async () => {
    while (i < ds.length) {
      const d = ds[i++];
      try {
        const j = await getJSON(`https://cwwp2.dot.ca.gov/data/d${d}/cctv/cctvStatusD${String(d).padStart(2, '0')}.json`, { timeout: 40000 });
        for (const r of j.data) {
          const c = r.cctv, loc = c.location, img = c.imageData?.static?.currentImageURL;
          if (c.inService !== 'true' || !img || !+loc.latitude) continue;
          add({ key: `ca${d}_${c.index}`, lat: +loc.latitude, lon: +loc.longitude, name: loc.locationName, src: 'Caltrans', place: `${loc.nearbyPlace || loc.county}, California`, img, hls: c.imageData.streamingVideoURL || '', dir: DIR[(loc.direction || '').toLowerCase()] ?? null, route: loc.route });
        }
      } catch { /* one district failing must not block the rest */ }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}
async function loadFinland(add) {
  const j = await getJSON('https://tie.digitraffic.fi/api/weathercam/v1/stations', { timeout: 40000 });
  for (const f of j.features) {
    const p = f.properties, preset = (p.presets || []).find((x) => x.inCollection) || p.presets?.[0];
    if (!preset || p.collectionStatus === 'REMOVED_PERMANENTLY') continue;
    add({ key: 'fi' + p.id, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], name: (p.name || '').replace(/_/g, ' '), src: 'Fintraffic', place: 'Finland', img: `https://weathercam.digitraffic.fi/${preset.id}.jpg`, presets: (p.presets || []).map((x) => x.id), dir: null });
  }
}

const L = defineLayer({
  id: 'cameras', name: 'Public cameras', group: 'Cameras', color: COLOR, icon: 'cctv', trust: 'live',
  blurb: 'Open traffic and road-weather cameras', source: 'TfL · Caltrans · Fintraffic', aliases: ['cameras', 'camera', 'cctv', 'webcams', 'traffic cameras'],
  subs: () => [{ id: 'viewshed', name: 'Viewsheds', color: COLOR, on: state.coverage === 'viewshed' }],
  setSub(id, v) { set('coverage', v ? 'viewshed' : 'off'); emit('layers', 'cameras'); drawWedges(); },
  async enable(L) {
    cams = new PointSet('cameras', { near: 3e3, nearScale: 1.25, far: 2.5e6, farScale: 0.34 });
    const style = () => ({ shape: 'camera', color: COLOR, size: 18 });
    const add = (c) => { if (cams && !cams.get(c.key)) { cams.add(c, style); } };
    const jobs = { London: loadTfl, California: loadCaltrans, Finland: loadFinland };
    let ok = 0;
    await Promise.allSettled(Object.entries(jobs).map(async ([n, fn]) => { try { await fn(add); sources[n] = true; ok++; L.setCount(cams.size); L.note = `${Object.keys(sources).join(', ')}`; emit('layers', 'cameras'); } catch (e) { console.warn('[cameras]', n, e); } }));
    if (!ok) throw new Error('No camera network answered');
    L.setCount(cams.size);
    drawWedges();
  },
  disable() { cams?.destroy(); cams = null; clearWedges(); closeMonitor(); closeViewer(); },
  onView() { drawWedges(); },
  contacts: () => (cams && camInfo().range < 400000 ? nearby(camInfo().clat, camInfo().clon, 60).map((c) => ({ key: c.key, L: 'cameras', label: 'CAM', lat: c.lat, lon: c.lon, alt: 8, color: COLOR })) : []),
  position: (k, r) => cams?.position(k, r) || null,
  onSelect(k) { openMonitor(cams?.get(k)); },
  onDeselect() { closeMonitor(); },
  info(k, brief) {
    const c = cams?.get(k);
    if (!c) return null;
    if (brief) return { title: c.name, kind: 'Camera', sub: c.src };
    const bust = Math.floor(Date.now() / 20000);
    return {
      title: c.name, kind: 'Public camera', sub: c.place, color: COLOR, range: 900, pitch: -38, lat: c.lat, lon: c.lon, viewer: true,
      photo: { url: frame(c, bust), video: c.video || null, live: true, credit: c.src },
      rows: [['Operator', c.src], ['Looking', c.dir != null ? ['north', 'east', 'south', 'west'][Math.round(c.dir / 90) % 4] + ' (as published)' : 'Not published'], ['Position', latlon(c.lat, c.lon)]],
      note: 'An official public feed, refreshed every 20 seconds. The position is published; the view direction and coverage are estimates.',
    };
  },
});
const frame = (c, bust) => c.img + (c.img.includes('?') ? '&' : '?') + 't=' + bust;

function nearby(lat, lon, max = 12, maxM = 80000) {
  if (!cams) return [];
  const out = [];
  for (const c of cams.values()) {
    if (Math.abs(c.lat - lat) > 1 || Math.abs(c.lon - lon) > 1.6) continue;
    const d = distM(lat, lon, c.lat, c.lon);
    if (d <= maxM) out.push({ ...c, d });
  }
  return out.sort((a, b) => a.d - b.d).slice(0, max);
}
export function nearestCamera(lat, lon) {
  if (!cams) return null;
  let best = null, bd = Infinity;
  for (const c of cams.values()) { const d = distM(lat, lon, c.lat, c.lon); if (d < bd) { bd = d; best = c; } }
  return best ? { ...best, d: bd } : null;
}

/* Estimated viewsheds: a 60 degree wedge where the direction is published, a ring where it is not. */
function clearWedges() { for (const w of wedges) viewer.entities.remove(w); wedges = []; }
function drawWedges() {
  clearWedges();
  if (!cams || state.coverage !== 'viewshed') return;
  const cam = camInfo();
  if (!cam.onGlobe || cam.range > 60000) { if (L.enabled) { L.note = 'Zoom in below 60 km to see viewsheds'; emit('layers', 'cameras'); } return; }
  for (const c of nearby(cam.clat, cam.clon, 140, Math.max(4000, cam.range * 1.2))) {
    const reach = 260, pts = [];
    if (c.dir != null) { pts.push(c.lon, c.lat); for (let a = -30; a <= 30; a += 6) { const [la, lo] = dest(c.lat, c.lon, c.dir + a, reach); pts.push(lo, la); } }
    else for (let a = 0; a < 360; a += 15) { const [la, lo] = dest(c.lat, c.lon, a, 110); pts.push(lo, la); }
    wedges.push(viewer.entities.add({ polygon: { hierarchy: C.Cartesian3.fromDegreesArray(pts), material: C.Color.fromCssColorString(COLOR).withAlpha(c.dir != null ? 0.22 : 0.1), outline: true, outlineColor: C.Color.fromCssColorString(COLOR).withAlpha(0.7), height: 0, heightReference: C.HeightReference.CLAMP_TO_GROUND, classificationType: C.ClassificationType.BOTH } }));
  }
}
on('camera:end', () => { if (L.enabled && state.coverage === 'viewshed') drawWedges(); });

/* In-world monitor: the live frame floats above the camera it comes from. */
function closeMonitor() { clearInterval(monitorTimer); if (monitor) viewer.entities.remove(monitor); monitor = null; }
function openMonitor(c) {
  closeMonitor();
  if (!c) return;
  const url = () => prox(frame(c, Math.floor(Date.now() / 20000)), 15, true);
  monitor = viewer.entities.add({
    position: C.Cartesian3.fromDegrees(c.lon, c.lat, 0),
    billboard: { image: url(), width: 220, height: 124, pixelOffset: new C.Cartesian2(0, -96), heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY, distanceDisplayCondition: new C.DistanceDisplayCondition(0, 30000), scaleByDistance: new C.NearFarScalar(500, 1.2, 30000, 0.45) },
    polyline: undefined,
  });
  monitor.argus = { L: 'cameras', k: c.key };
  monitorTimer = setInterval(() => { if (monitor) monitor.billboard.image = url(); }, 20000);
}

/* Feed viewer: big frame or live video, with next-nearest stepping. */
function closeViewer() { hls?.destroy?.(); hls = null; viewerEl?.remove(); viewerEl = null; }
async function openViewer(key) {
  const c = cams?.get(key);
  if (!c) return;
  closeViewer();
  viewerEl = el(`<section class="viewer surface" aria-label="Camera feed">
    <div class="viewer-head"><span class="eyebrow" style="color:${COLOR}">${c.hls || c.video ? 'Live video' : 'Live frame'}</span><span class="t">${esc(c.name)}</span>
      <button class="btn sm" data-a="next">Next nearest</button><button class="icon-btn" data-a="big" aria-label="Expand" data-tip="Expand">${icon('expand', 16)}</button><button class="icon-btn" data-a="x" aria-label="Close">${icon('x', 16)}</button></div>
    <div class="viewer-stage"></div><div class="viewer-foot"><span>${esc(c.place)} · ${latlon(c.lat, c.lon)}</span><span>${esc(c.src)}</span></div></section>`);
  ui().appendChild(viewerEl);
  const stage = viewerEl.querySelector('.viewer-stage');
  const still = () => { stage.innerHTML = `<img alt="Camera frame" src="${esc(frame(c, Date.now()))}">`; };
  if (c.hls) {
    const v = document.createElement('video');
    v.muted = true; v.autoplay = true; v.playsInline = true; v.controls = true;
    stage.appendChild(v);
    if (v.canPlayType('application/vnd.apple.mpegurl')) { v.src = c.hls; v.onerror = still; }
    else {
      try {
        const { default: Hls } = await import('hls.js');
        if (Hls.isSupported()) { hls = new Hls({ maxBufferLength: 8 }); hls.loadSource(c.hls); hls.attachMedia(v); hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) { hls.destroy(); hls = null; still(); } }); }
        else still();
      } catch { still(); }
    }
  } else if (c.video) {
    stage.innerHTML = `<video src="${esc(c.video)}" poster="${esc(c.img)}" autoplay muted loop playsinline></video>`;
    stage.firstChild.onerror = still;
  } else still();
  const t = setInterval(() => { if (!viewerEl) return clearInterval(t); const im = stage.querySelector('img'); if (im) im.src = frame(c, Date.now()); }, 20000);
  viewerEl.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'x') closeViewer();
    if (a === 'big') viewerEl.classList.toggle('big');
    if (a === 'next') { const n = nearby(c.lat, c.lon, 2, 4e5).find((x) => x.key !== c.key); if (n) { select('cameras', n.key); openViewer(n.key); } else toast('No other camera within 400 km.'); }
  });
}
on('camera:view', openViewer);
on('selected', (s) => { if (viewerEl && s?.L.id !== 'cameras') closeViewer(); });

/** NEAREST: hand off from any target (a fire, a ship, the view centre) to the closest public camera. */
on('camera:nearest', async (info) => {
  const at = info?.lat != null ? info : { lat: camInfo().clat, lon: camInfo().clon };
  if (!registry.get('cameras').enabled) { toast('Loading the camera mesh'); await setLayer('cameras', true); }
  const c = nearestCamera(at.lat, at.lon);
  if (!c) return toast('No public camera is loaded yet.', 'err');
  if (c.d > 250000) toast(`The nearest public camera is ${fmtDist(c.d)} away.`);
  select('cameras', c.key, { fly: false });
  await lookAt({ lat: c.lat, lon: c.lon, range: 1200, pitch: -35, heading: c.dir ?? 0 });
  openViewer(c.key);
});
export { nearby as camerasNear };
void scene; void current;
