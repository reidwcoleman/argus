// Selection, click-to-track camera lock, hover labels and the fading trail.
import { C, viewer, scene, camera, lookAt, pickLatLon } from './viewer.js';
import { state, set, emit, on } from './bus.js';
import { registry } from '../layers/base.js';
import { glyph } from '../layers/glyphs.js';
import { esc } from './geo.js';

let sel = null; // { L, key }
let ui, reticle, tracker, trailPrim = null, trailV = -1, headLine, hoverEl, lastHover = 0;
const cur = new C.Cartesian3();
let curOk = false;

export const current = () => sel;
export function currentInfo() { return sel ? sel.L.info?.(sel.key) || null : null; }
export function currentPos() { return curOk ? cur : null; }

export function initSelect() {
  ui = scene.primitives.add(new C.BillboardCollection({ scene }));
  reticle = ui.add({ image: glyph('reticle', '#c8f55a', 46), width: 46, height: 46, show: false, disableDepthTestDistance: Number.POSITIVE_INFINITY });
  tracker = viewer.entities.add({
    position: new C.CallbackPositionProperty(() => (curOk ? cur : C.Cartesian3.fromDegrees(0, 0, 0)), false),
    point: { pixelSize: 1, color: C.Color.TRANSPARENT },
  });
  headLine = viewer.entities.add({
    show: false,
    polyline: { positions: new C.CallbackProperty(() => headPositions(), false), width: 2.5, arcType: C.ArcType.NONE, material: C.Color.fromCssColorString('#c8f55a').withAlpha(0.95) },
  });
  hoverEl = document.createElement('div');
  hoverEl.className = 'hover-tag';
  hoverEl.hidden = true;
  document.body.appendChild(hoverEl);

  const h = new C.ScreenSpaceEventHandler(scene.canvas);
  h.setInputAction((e) => {
    const ll = pickLatLon(e.position);
    if (state.tool) { if (ll) emit('map:click', { ...ll, x: e.position.x, y: e.position.y }); return; }
    const id = resolve(scene.pick(e.position));
    if (id) select(id.L, id.k, { fly: false });
    else if (ll) emit('map:empty', { ...ll, x: e.position.x, y: e.position.y });
  }, C.ScreenSpaceEventType.LEFT_CLICK);
  h.setInputAction((e) => {
    if (state.tool) { const ll = pickLatLon(e.position); if (ll) emit('map:dblclick', ll); return; }
    const id = resolve(scene.pick(e.position));
    if (id) select(id.L, id.k, { track: true });
  }, C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  h.setInputAction((e) => {
    const now = performance.now();
    if (now - lastHover < 70) return;
    lastHover = now;
    if (state.tool) { scene.canvas.style.cursor = 'crosshair'; hoverEl.hidden = true; const ll = pickLatLon(e.endPosition); if (ll) emit('map:move', ll); return; }
    const id = resolve(scene.pick(e.endPosition));
    if (!id) { hoverEl.hidden = true; scene.canvas.style.cursor = ''; return; }
    const info = registry.get(id.L)?.info?.(id.k, true);
    if (!info) { hoverEl.hidden = true; return; }
    scene.canvas.style.cursor = 'pointer';
    hoverEl.innerHTML = `${esc(info.title)}<small>${esc(info.kind)}${info.sub ? ' · ' + esc(info.sub) : ''}</small>`;
    hoverEl.style.left = e.endPosition.x + 'px';
    hoverEl.style.top = e.endPosition.y + 'px';
    hoverEl.hidden = false;
  }, C.ScreenSpaceEventType.MOUSE_MOVE);
  scene.canvas.addEventListener('mouseleave', () => { hoverEl.hidden = true; });

  scene.preUpdate.addEventListener(frame);
  on('layers:toggle', ({ id, on: isOn }) => { if (!isOn && sel?.L.id === id) deselect(); });
}

function resolve(picked) {
  if (!picked) return null;
  const id = picked.id;
  if (id && id.L && id.k != null) return id;
  if (id && id.argus) return id.argus; // entity-based layers attach { L, k } as entity.argus
  if (picked.primitive?.argus) return picked.primitive.argus;
  return null;
}

function frame() {
  if (!sel) return;
  const p = sel.L.position?.(sel.key, cur);
  if (!p) {
    // Contact dropped out of the feed.
    curOk = false;
    if (state.cockpit) return;
    emit('toast', { text: 'Contact lost: it left the feed.' });
    deselect();
    return;
  }
  curOk = true;
  reticle.position = cur;
  reticle.show = !state.cockpit;
  const v = sel.L.trailVersion?.(sel.key) ?? 0;
  if (v !== trailV) { trailV = v; drawTrail(); }
}

let lastTrailPoint = null;
function headPositions() {
  if (!sel || !curOk || !lastTrailPoint) return [];
  return [lastTrailPoint, cur];
}
function drawTrail() {
  if (trailPrim) { scene.primitives.remove(trailPrim); trailPrim = null; }
  lastTrailPoint = null;
  headLine.show = false;
  const pts = sel?.L.trail?.(sel.key);
  if (!pts || pts.length < 1) return;
  const positions = pts.map((p) => C.Cartesian3.fromDegrees(p[1], p[0], p[2] || 0));
  lastTrailPoint = positions[positions.length - 1];
  headLine.show = true;
  if (positions.length < 2) return;
  const base = C.Color.fromCssColorString(sel.L.trailColor || '#c8f55a');
  const n = positions.length;
  const colors = positions.map((_, i) => base.withAlpha(0.04 + 0.9 * Math.pow(i / (n - 1), 1.6)));
  trailPrim = scene.primitives.add(new C.Primitive({
    geometryInstances: new C.GeometryInstance({ geometry: new C.PolylineGeometry({ positions, colors, colorsPerVertex: true, width: 2.5, arcType: C.ArcType.NONE, vertexFormat: C.PolylineColorAppearance.VERTEX_FORMAT }) }),
    appearance: new C.PolylineColorAppearance({ translucent: true }), asynchronous: false,
  }));
}

export function select(layerId, key, { track = false, fly = true } = {}) {
  const L = registry.get(layerId);
  if (!L) return false;
  const info = L.info?.(key);
  if (!info) return false;
  if (state.tracking) stopTracking();
  sel = { L, key };
  curOk = !!L.position?.(key, cur);
  trailV = -1;
  L.onSelect?.(key);
  set('selected', `${layerId}:${key}`);
  emit('selected', sel);
  if (track && info.moving) startTracking(info);
  else if (fly || track) focus(info);
  return true;
}

export function focus(info = currentInfo()) {
  if (!info || !curOk) return;
  const cg = C.Cartographic.fromCartesian(cur);
  return lookAt({ lat: C.Math.toDegrees(cg.latitude), lon: C.Math.toDegrees(cg.longitude), alt: cg.height, range: info.range || 40000, heading: C.Math.toDegrees(camera.heading), pitch: info.pitch ?? -42, duration: 1.8 });
}

export async function startTracking(info = currentInfo()) {
  if (!sel || !info) return;
  if (!info.moving) return focus(info);
  set('tracking', true);
  const token = sel.key;
  await focus(info);
  if (!sel || sel.key !== token || !state.tracking) return;
  const r = info.range || 40000;
  tracker.viewFrom = new C.ConstantProperty(offsetFromCamera(r));
  viewer.trackedEntity = tracker;
}
function offsetFromCamera(range) {
  // Keep the current viewing direction when the lock engages.
  const enu = C.Transforms.eastNorthUpToFixedFrame(cur);
  const inv = C.Matrix4.inverseTransformation(enu, new C.Matrix4());
  const local = C.Matrix4.multiplyByPoint(inv, camera.positionWC, new C.Cartesian3());
  const d = C.Cartesian3.magnitude(local);
  if (d < 1 || !Number.isFinite(d)) return new C.Cartesian3(-range * 0.6, -range * 0.6, range * 0.55);
  return C.Cartesian3.multiplyByScalar(local, Math.min(1, (range * 1.2) / d) || 1, local);
}
export function stopTracking() {
  if (viewer.trackedEntity) {
    viewer.trackedEntity = undefined;
    camera.lookAtTransform(C.Matrix4.IDENTITY);
  }
  set('tracking', false);
}
export function deselect() {
  if (!sel) return;
  const prev = sel;
  stopTracking();
  sel = null; curOk = false;
  reticle.show = false; headLine.show = false; lastTrailPoint = null;
  if (trailPrim) { scene.primitives.remove(trailPrim); trailPrim = null; }
  prev.L.onDeselect?.(prev.key);
  set('selected', null);
  emit('selected', null);
}
