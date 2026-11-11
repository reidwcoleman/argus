// Utilities: a whiteboard over the real world (areas, lines, pins, measurements), street-following
// directions you can fly, and file import.
import { C, viewer, scene, camera, lookAt, camInfo } from '../core/viewer.js';
import { state, set, on, emit, store } from '../core/bus.js';
import { registerPanel, refreshPanel } from './shell.js';
import { el, $, icon, toast } from './dom.js';
import { distM, fmtDist, bearing, esc, latlon, angLerp } from '../core/geo.js';
import { geocode } from '../core/geocode.js';
import { getJSON } from '../core/net.js';

/* ------------------------------------------------------------ annotations */
const COLORS = ['#c8f55a', '#6fc3ff', '#ffb53a', '#ff6257', '#ff8ad8', '#ffffff'];
let shapes = store.get('shapes', []);
const ents = new Map();
let seq = Date.now();
const save = () => store.set('shapes', shapes);
const carts = (pts) => pts.map((p) => C.Cartesian3.fromDegrees(p[1], p[0]));
function areaKm2(pts) {
  // Spherical excess approximation, fine for annotation-sized shapes.
  let a = 0; const R = 6371.0088;
  for (let i = 0; i < pts.length; i++) { const [la1, lo1] = pts[i], [la2, lo2] = pts[(i + 1) % pts.length]; a += ((lo2 - lo1) * Math.PI / 180) * (2 + Math.sin(la1 * Math.PI / 180) + Math.sin(la2 * Math.PI / 180)); }
  return Math.abs((a * R * R) / 2);
}
const lineLen = (pts) => pts.reduce((a, p, i) => (i ? a + distM(pts[i - 1][0], pts[i - 1][1], p[0], p[1]) : 0), 0);
export function describe(s) {
  if (s.type === 'area') { const k = areaKm2(s.pts); return k < 1 ? `${Math.round(k * 100)} ha` : `${k < 100 ? k.toFixed(1) : Math.round(k).toLocaleString()} km²`; }
  if (s.type === 'pin') return latlon(s.pts[0][0], s.pts[0][1]);
  return fmtDist(lineLen(s.pts));
}
function render(s) {
  const old = ents.get(s.id);
  if (old) old.forEach((e) => viewer.entities.remove(e));
  if (s.hidden) return void ents.delete(s.id);
  const col = C.Color.fromCssColorString(s.color);
  const list = [];
  const label = (pos, text) => ({ position: pos, label: { text, font: '600 13px Geist, sans-serif', fillColor: C.Color.WHITE, outlineColor: C.Color.BLACK.withAlpha(0.85), outlineWidth: 4, style: C.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new C.Cartesian2(0, -18), disableDepthTestDistance: Number.POSITIVE_INFINITY, heightReference: C.HeightReference.CLAMP_TO_GROUND, showBackground: true, backgroundColor: C.Color.fromCssColorString('#0a0c0a').withAlpha(0.72), backgroundPadding: new C.Cartesian2(7, 4) } });
  if (s.type === 'area' && s.pts.length >= 3) {
    for (const ring of s.rings || [s.pts]) {
      list.push(viewer.entities.add({ polygon: { hierarchy: carts(ring), material: col.withAlpha(0.16), classificationType: C.ClassificationType.BOTH }, polyline: { positions: carts([...ring, ring[0]]), width: 2.5, material: col, clampToGround: true } }));
    }
    const c = C.BoundingSphere.fromPoints(carts(s.pts)).center;
    list.push(viewer.entities.add(label(C.Ellipsoid.WGS84.scaleToGeodeticSurface(c), s.name)));
  } else if (s.type === 'pin') {
    list.push(viewer.entities.add({ ...label(carts(s.pts)[0], s.name), point: { pixelSize: 12, color: col, outlineColor: C.Color.BLACK, outlineWidth: 2, heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY } }));
  } else if (s.pts.length >= 2) {
    const arrow = s.type === 'measure';
    list.push(viewer.entities.add({ polyline: { positions: carts(s.pts), width: arrow ? 9 : 3.5, material: arrow ? new C.PolylineArrowMaterialProperty(col) : s.type === 'route' ? new C.PolylineGlowMaterialProperty({ color: col, glowPower: 0.2 }) : col, clampToGround: !arrow && s.pts.length < 4000, arcType: C.ArcType.GEODESIC } }));
    const mid = s.pts[Math.floor(s.pts.length / 2)];
    const m = s.pts.length === 2 ? C.Cartesian3.midpoint(...carts(s.pts), new C.Cartesian3()) : C.Cartesian3.fromDegrees(mid[1], mid[0]);
    list.push(viewer.entities.add(label(C.Ellipsoid.WGS84.scaleToGeodeticSurface(m), arrow || s.type === 'route' ? `${s.name} · ${describe(s)}` : s.name)));
  }
  ents.set(s.id, list);
}
export function addShape(s) {
  const shape = { id: 's' + seq++, color: COLORS[0], hidden: false, name: 'Shape', ...s };
  shapes.push(shape); render(shape); save(); emit('shapes');
  return shape;
}
export function removeShape(id) { ents.get(id)?.forEach((e) => viewer.entities.remove(e)); ents.delete(id); shapes = shapes.filter((s) => s.id !== id); save(); emit('shapes'); }
export function clearShapes() { for (const s of [...shapes]) removeShape(s.id); clearRoute(); }
export const allShapes = () => shapes;
export function flyToShape(s) {
  const bs = C.BoundingSphere.fromPoints(carts(s.pts));
  const cg = C.Cartographic.fromCartesian(bs.center);
  return lookAt({ lat: C.Math.toDegrees(cg.latitude), lon: C.Math.toDegrees(cg.longitude), range: Math.max(600, bs.radius * 3.2), pitch: -55, heading: camInfo().heading, duration: 1.8 });
}
/** Turns a GeoJSON Polygon / MultiPolygon into an outline annotation. */
export function addBoundary(name, geojson, color = COLORS[0]) {
  const polys = geojson.type === 'Polygon' ? [geojson.coordinates] : geojson.type === 'MultiPolygon' ? geojson.coordinates : [];
  const rings = polys.map((p) => p[0].map(([lon, lat]) => [lat, lon])).filter((r) => r.length >= 3).sort((a, b) => b.length - a.length).slice(0, 12);
  if (!rings.length) return null;
  return addShape({ type: 'area', name, color, pts: rings[0], rings });
}

/* ---------------------------------------------------------------- drawing */
let draft = null; // { type, color, pts, ent }
function startDraw(type, color) {
  cancelDraw();
  draft = { type, color, pts: [], cursor: null };
  draft.ent = viewer.entities.add({
    polyline: { positions: new C.CallbackProperty(() => carts(draft && draft.cursor ? [...draft.pts, draft.cursor, ...(draft.type === 'area' && draft.pts.length > 1 ? [draft.pts[0]] : [])] : draft?.pts || []), false), width: 2.5, material: new C.PolylineDashMaterialProperty({ color: C.Color.fromCssColorString(color), dashLength: 10 }), clampToGround: true },
  });
  set('tool', 'draw');
  toast(type === 'pin' ? 'Click the map to drop the pin.' : type === 'measure' ? 'Click two points to measure between them.' : 'Click to add points. Double-click or press Enter to finish.');
}
function finishDraw() {
  if (!draft) return;
  const { type, color, pts } = draft;
  const min = type === 'area' ? 3 : type === 'pin' ? 1 : 2;
  if (pts.length >= min) {
    const n = shapes.filter((s) => s.type === type).length + 1;
    addShape({ type, color, pts, name: type === 'measure' ? 'Distance' : `${type === 'area' ? 'Area' : type === 'pin' ? 'Pin' : 'Line'} ${n}` });
  }
  cancelDraw();
}
function cancelDraw() {
  if (draft) viewer.entities.remove(draft.ent);
  draft = null;
  if (state.tool === 'draw') set('tool', null);
}
on('map:click', (p) => {
  if (state.tool === 'draw' && draft) {
    const last = draft.pts[draft.pts.length - 1];
    if (last && distM(last[0], last[1], p.lat, p.lon) < 0.5) return; // the second click of a double-click
    draft.pts.push([p.lat, p.lon]);
    if (draft.type === 'pin' || (draft.type === 'measure' && draft.pts.length === 2)) finishDraw();
  } else if (state.tool === 'route') setRoutePoint(p);
});
on('map:move', (p) => { if (draft) draft.cursor = [p.lat, p.lon]; });
on('map:dblclick', () => { if (state.tool === 'draw') finishDraw(); });
on('tool:cancel', () => { cancelDraw(); if (state.tool) set('tool', null); });
on('key', ({ k }) => { if (k === 'enter' && state.tool === 'draw') finishDraw(); });

/* ------------------------------------------------------------- directions */
const route = { a: null, b: null, mode: 'car', result: null, picking: null, ents: [], busy: false, error: '' };
const PROFILE = { car: ['routed-car', 'Drive'], foot: ['routed-foot', 'Walk'], bike: ['routed-bike', 'Cycle'] };
function clearRoute() { route.ents.forEach((e) => viewer.entities.remove(e)); route.ents = []; route.result = null; emit('route'); }
function marker(p, text, color) {
  return viewer.entities.add({ position: C.Cartesian3.fromDegrees(p.lon, p.lat), point: { pixelSize: 14, color: C.Color.fromCssColorString(color), outlineColor: C.Color.BLACK, outlineWidth: 2, heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY }, label: { text, font: '700 11px Geist Mono, monospace', fillColor: C.Color.BLACK, pixelOffset: new C.Cartesian2(0, 0), disableDepthTestDistance: Number.POSITIVE_INFINITY, heightReference: C.HeightReference.CLAMP_TO_GROUND } });
}
function setRoutePoint(p) {
  const which = route.picking || (!route.a ? 'a' : 'b');
  route[which] = { lat: p.lat, lon: p.lon, name: latlon(p.lat, p.lon) };
  route.picking = null;
  if (route.a && route.b) { set('tool', null); solveRoute(); }
  else { route.picking = which === 'a' ? 'b' : 'a'; toast(`Now click the ${route.picking === 'b' ? 'destination' : 'start'}.`); }
  emit('route');
}
function stepText(s) {
  const m = s.maneuver, road = s.name ? ` onto ${s.name}` : '', mod = m.modifier ? ' ' + m.modifier : '';
  switch (m.type) {
    case 'depart': return `Head ${['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round((m.bearing_after || 0) / 45) % 8]}${s.name ? ' on ' + s.name : ''}`;
    case 'arrive': return 'Arrive at your destination';
    case 'roundabout': case 'rotary': return `Take exit ${m.exit || 1} at the roundabout${road}`;
    case 'merge': return `Merge${mod}${road}`;
    case 'on ramp': return `Take the ramp${mod}${road}`;
    case 'off ramp': return `Take the exit${mod}${road}`;
    case 'fork': return `Keep${mod} at the fork${road}`;
    case 'new name': return `Continue${road}`;
    case 'continue': return `Continue${mod}${road}`;
    case 'end of road': return `At the end of the road turn${mod}${road}`;
    default: return `Turn${mod}${road}`;
  }
}
export async function solveRoute(a = route.a, b = route.b, mode = route.mode) {
  route.a = a; route.b = b; route.mode = mode;
  if (!a || !b) return null;
  tab = 'route';
  clearRoute();
  route.busy = true; route.error = ''; emit('route');
  try {
    const d = await getJSON(`https://routing.openstreetmap.de/${PROFILE[mode][0]}/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson&steps=true`, { timeout: 25000 });
    const r = d.routes?.[0];
    if (!r) throw new Error('none');
    const pts = r.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
    route.result = { pts, dist: r.distance, dur: r.duration, steps: r.legs[0].steps.map((s) => ({ text: stepText(s), dist: s.distance })).filter((s) => s.dist > 0 || /Arrive/.test(s.text)) };
    route.ents.push(viewer.entities.add({ polyline: { positions: carts(pts), width: 6, material: new C.PolylineOutlineMaterialProperty({ color: C.Color.fromCssColorString('#6fc3ff'), outlineWidth: 2, outlineColor: C.Color.fromCssColorString('#06202f') }), clampToGround: true } }));
    route.ents.push(marker(a, 'A', '#c8f55a'), marker(b, 'B', '#ff6257'));
    const bs = C.BoundingSphere.fromPoints(carts(pts)), cg = C.Cartographic.fromCartesian(bs.center);
    lookAt({ lat: C.Math.toDegrees(cg.latitude), lon: C.Math.toDegrees(cg.longitude), range: Math.max(900, bs.radius * 3), pitch: -60, duration: 1.8 });
  } catch (e) {
    route.error = e.message === 'none' ? 'No route connects those two points by that mode.' : 'The routing server is not answering. Try again in a moment.';
  }
  route.busy = false; emit('route');
  return route.result;
}
let flying = null;
/** Drone-style flythrough of the current route: the camera leads the path with banked, eased turns. */
export function flyRoute() {
  const r = route.result;
  if (!r) return false;
  stopFly();
  const pts = r.pts, cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + distM(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  const total = cum[cum.length - 1], dur = Math.max(14, Math.min(60, total / 60)) * 1000, t0 = performance.now();
  const range = Math.max(260, Math.min(2600, total / 14));
  let hdg = bearing(pts[0][0], pts[0][1], pts[1][0], pts[1][1]), i = 0;
  const at = (s) => { while (i < cum.length - 2 && cum[i + 1] < s) i++; const f = (s - cum[i]) / Math.max(1, cum[i + 1] - cum[i]); return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f]; };
  viewer.trackedEntity = undefined;
  const off = scene.preUpdate.addEventListener(() => {
    let u = (performance.now() - t0) / dur;
    if (u >= 1) return stopFly();
    u = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; // eased ends
    const s = u * total, here = at(s), j = i, ahead = at(Math.min(total, s + range * 0.9));
    i = j;
    if (distM(here[0], here[1], ahead[0], ahead[1]) > 2) hdg = angLerp(hdg, bearing(here[0], here[1], ahead[0], ahead[1]), 0.045);
    camera.lookAt(C.Cartesian3.fromDegrees(here[1], here[0], 0), new C.HeadingPitchRange(C.Math.toRadians(hdg), C.Math.toRadians(-24), range));
  });
  flying = { off };
  const cancel = () => stopFly();
  scene.canvas.addEventListener('pointerdown', cancel, { once: true });
  flying.cancel = cancel;
  emit('route');
  return true;
}
export function stopFly() {
  if (!flying) return;
  flying.off();
  scene.canvas.removeEventListener('pointerdown', flying.cancel);
  flying = null;
  camera.lookAtTransform(C.Matrix4.IDENTITY);
  emit('route');
}
export const routeState = () => route;

/* ----------------------------------------------------------------- import */
const imports = [];
async function importFile(file) {
  const name = file.name, ext = name.split('.').pop().toLowerCase();
  try {
    let ds;
    if (ext === 'kml' || ext === 'kmz') ds = await C.KmlDataSource.load(file, { camera, canvas: scene.canvas, clampToGround: true });
    else if (ext === 'gpx') ds = await C.GpxDataSource.load(file, { clampToGround: true });
    else if (ext === 'geojson' || ext === 'json') ds = await C.GeoJsonDataSource.load(JSON.parse(await file.text()), { stroke: C.Color.fromCssColorString('#c8f55a'), fill: C.Color.fromCssColorString('#c8f55a').withAlpha(0.18), strokeWidth: 3, clampToGround: true, markerColor: C.Color.fromCssColorString('#c8f55a') });
    else throw new Error('type');
    await viewer.dataSources.add(ds);
    imports.push({ name, ds, n: ds.entities.values.length });
    viewer.flyTo(ds, { duration: 1.8 });
    emit('imports');
  } catch (e) {
    toast(e.message === 'type' ? `${name} is not a GeoJSON, KML or GPX file.` : `${name} could not be read. Check that it is valid ${ext.toUpperCase()}.`, 'err');
  }
}
addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
addEventListener('drop', (e) => { if (!e.dataTransfer?.files.length) return; e.preventDefault(); [...e.dataTransfer.files].forEach(importFile); });

/* ------------------------------------------------------------------ panel */
let tab = 'draw', drawType = 'area', drawColor = COLORS[0];
registerPanel({
  id: 'tools', title: 'Utilities', icon: 'tools', key: 'U',
  badge: () => shapes.length || '',
  render(body) {
    const draw = () => {
      const top = body.scrollTop;
      const r = route;
      const tabs = `<div style="padding:2px 8px 12px"><div class="seg" style="width:100%">${[['draw', 'Draw'], ['route', 'Directions'], ['import', 'Import']].map(([id, n]) => `<button data-tab="${id}" aria-pressed="${tab === id}">${n}</button>`).join('')}</div></div>`;
      let html = '';
      if (tab === 'draw') {
        html = `<div class="field"><label>Shape</label><div class="seg">${[['area', 'Area'], ['line', 'Line'], ['pin', 'Pin'], ['measure', 'Measure']].map(([id, n]) => `<button data-type="${id}" aria-pressed="${drawType === id}">${n}</button>`).join('')}</div></div>
          <div class="field"><label>Colour</label><div class="swatches">${COLORS.map((c) => `<button data-color="${c}" style="--c:${c}" aria-pressed="${c === drawColor}" aria-label="Colour ${c}"></button>`).join('')}</div></div>
          <div style="padding:8px"><button class="btn primary wide" data-a="start">${icon(state.tool === 'draw' ? 'x' : 'pen', 15)}${state.tool === 'draw' ? 'Cancel drawing' : 'Start drawing'}</button></div>
          <section class="group"><div class="group-head"><span class="eyebrow">On the map</span>${shapes.length ? '<button class="btn ghost sm" data-a="clear">Clear all</button>' : ''}</div>
          ${shapes.length ? shapes.map((s) => `<div class="shot" style="grid-template-columns:14px 1fr auto auto auto"><i style="width:10px;height:10px;border-radius:50%;background:${s.color};opacity:${s.hidden ? 0.3 : 1}"></i>
              <span style="min-width:0"><input class="input" data-name="${s.id}" value="${esc(s.name)}" aria-label="Name" style="width:100%;height:26px;text-align:left;font:500 13px var(--font);background:none;border-color:transparent;padding:0 4px"><span class="note" style="padding:0 4px;display:block">${describe(s)}</span></span>
              <button class="icon-btn" data-fly="${s.id}" data-tip="Fly to">${icon('crosshair', 15)}</button><button class="icon-btn" data-hide="${s.id}" data-tip="${s.hidden ? 'Show' : 'Hide'}" aria-pressed="${!s.hidden}">${icon('eye', 15)}</button><button class="icon-btn" data-del="${s.id}" data-tip="Delete">${icon('trash', 15)}</button></div>`).join('')
            : `<div class="empty">${icon('pen', 26)}<b>Nothing drawn yet</b>Mark up the real world: outline an area, trace a line, drop a pin or measure a distance. It stays until you clear it.</div>`}</section>`;
      } else if (tab === 'route') {
        const pt = (k, lbl) => `<div class="field"><label>${lbl}<span>${r.picking === k ? 'click the map' : ''}</span></label><div style="display:flex;gap:6px"><input class="input" data-pt="${k}" placeholder="Place, address or lat, lon" value="${esc(r[k]?.name || '')}"><button class="icon-btn" data-pick="${k}" data-tip="Pick on the map" aria-pressed="${r.picking === k}" style="height:36px;width:36px;background:var(--s2);border:1px solid var(--line-2);border-radius:var(--r-m)">${icon('pin', 16)}</button></div></div>`;
        html = `${pt('a', 'From')}${pt('b', 'To')}
          <div class="field"><label>Travel by</label><div class="seg">${Object.entries(PROFILE).map(([id, p]) => `<button data-mode="${id}" aria-pressed="${r.mode === id}">${p[1]}</button>`).join('')}</div></div>
          <div style="padding:8px;display:flex;gap:6px"><button class="btn primary" style="flex:1" data-a="solve" ${r.a && r.b && !r.busy ? '' : 'disabled'}>${r.busy ? '<span class="spinner"></span>Routing' : icon('route', 15) + 'Get route'}</button>${r.result ? `<button class="btn" data-a="fly">${icon(flying ? 'pause' : 'play', 15)}${flying ? 'Stop' : 'Fly it'}</button><button class="icon-btn" data-a="rclear" data-tip="Clear route" style="height:34px">${icon('trash', 15)}</button>` : ''}</div>
          ${r.error ? `<p class="note" style="color:var(--danger)">${r.error}</p>` : ''}
          ${r.result ? `<div class="stats" style="margin:8px 0;border-radius:var(--r-m);overflow:hidden;border:1px solid var(--line)"><div class="stat"><div class="v">${fmtDist(r.result.dist)}</div><div class="l">Distance</div></div><div class="stat"><div class="v">${r.result.dur >= 3600 ? Math.floor(r.result.dur / 3600) + 'h ' : ''}${Math.round((r.result.dur % 3600) / 60)}<small>min</small></div><div class="l">${PROFILE[r.mode][1]} time</div></div><div class="stat"><div class="v">${r.result.steps.length}</div><div class="l">Steps</div></div></div>
            <div class="steps">${r.result.steps.map((s) => `<div class="step"><span>${esc(s.text)}</span><span class="d">${s.dist ? fmtDist(s.dist) : ''}</span></div>`).join('')}</div>`
            : !r.busy ? `<div class="empty">${icon('route', 26)}<b>Street-following routes</b>Type two places or pick them on the map. Then fly the route like a drone shot.</div>` : ''}
          <p class="note">Routing by OSRM on FOSSGIS servers, © OpenStreetMap contributors.</p>`;
      } else {
        html = `<label class="mission" style="min-height:0;align-items:center;text-align:center;margin:0 8px;cursor:pointer;border-style:dashed"><input type="file" accept=".geojson,.json,.kml,.kmz,.gpx" multiple hidden>${icon('upload', 26)}<h3>Drop a file anywhere</h3><p>GeoJSON, KML or GPX. It stays in this browser tab.</p></label>
          <section class="group"><div class="group-head"><span class="eyebrow">Imported</span></div>${imports.length ? imports.map((m, i) => `<div class="shot" style="grid-template-columns:1fr auto auto"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.name)}<span class="note" style="padding:0;display:block">${m.n} features</span></span><button class="icon-btn" data-ifly="${i}" data-tip="Fly to">${icon('crosshair', 15)}</button><button class="icon-btn" data-idel="${i}" data-tip="Remove">${icon('trash', 15)}</button></div>`).join('') : '<p class="note">No files yet.</p>'}</section>`;
      }
      body.innerHTML = tabs + html;
      body.scrollTop = top;
    };
    body.addEventListener('click', (e) => {
      const t = (sel) => e.target.closest(sel);
      let b;
      if ((b = t('[data-tab]'))) { tab = b.dataset.tab; return draw(); }
      if ((b = t('[data-type]'))) { drawType = b.dataset.type; if (state.tool === 'draw') startDraw(drawType, drawColor); return draw(); }
      if ((b = t('[data-color]'))) { drawColor = b.dataset.color; if (draft) startDraw(drawType, drawColor); return draw(); }
      if ((b = t('[data-fly]'))) return void flyToShape(shapes.find((s) => s.id === b.dataset.fly));
      if ((b = t('[data-hide]'))) { const s = shapes.find((x) => x.id === b.dataset.hide); s.hidden = !s.hidden; render(s); save(); return draw(); }
      if ((b = t('[data-del]'))) return removeShape(b.dataset.del);
      if ((b = t('[data-mode]'))) { route.mode = b.dataset.mode; if (route.result) solveRoute(); return draw(); }
      if ((b = t('[data-pick]'))) { route.picking = route.picking === b.dataset.pick ? null : b.dataset.pick; set('tool', route.picking ? 'route' : null); return draw(); }
      if ((b = t('[data-ifly]'))) return void viewer.flyTo(imports[+b.dataset.ifly].ds, { duration: 1.6 });
      if ((b = t('[data-idel]'))) { const m = imports.splice(+b.dataset.idel, 1)[0]; viewer.dataSources.remove(m.ds, true); return draw(); }
      const a = t('[data-a]')?.dataset.a;
      if (a === 'start') { if (state.tool === 'draw') cancelDraw(); else startDraw(drawType, drawColor); draw(); }
      if (a === 'clear') clearShapes();
      if (a === 'solve') solveRoute();
      if (a === 'fly') { if (flying) stopFly(); else flyRoute(); }
      if (a === 'rclear') { route.a = route.b = null; clearRoute(); }
    });
    body.addEventListener('change', async (e) => {
      const n = e.target.closest('[data-name]');
      if (n) { const s = shapes.find((x) => x.id === n.dataset.name); s.name = n.value.trim() || s.name; render(s); save(); return; }
      const p = e.target.closest('[data-pt]');
      if (p) { const q = p.value.trim(); if (!q) { route[p.dataset.pt] = null; return draw(); } const g = await geocode(q); if (!g) { toast(`Could not find "${q}". Try a fuller name or coordinates.`, 'err'); return; } route[p.dataset.pt] = { lat: g.lat, lon: g.lon, name: g.name }; draw(); if (route.a && route.b) solveRoute(); return; }
      if (e.target.type === 'file') [...e.target.files].forEach(importFile);
    });
    const offs = [on('shapes', draw), on('route', draw), on('imports', draw), on('state:tool', draw)];
    draw();
    return () => offs.forEach((f) => f());
  },
});
export function initTools() { shapes.forEach(render); }
void refreshPanel;
