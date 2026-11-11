// Cesium viewer bootstrap, basemap stack, and camera helpers.
import { state, set, emit, store } from './bus.js';
import { clamp, deg, rad } from './geo.js';

export const C = window.Cesium;
export let viewer, scene, camera;
let occluder;
const layers = { base: null, labels: null, night: null };
let tileset = null;

export const BASEMAPS = [
  { id: 'satellite', name: 'Satellite', desc: 'Esri World Imagery', credit: 'Imagery © Esri, Maxar, Earthstar Geographics' },
  { id: 'dark', name: 'Dark', desc: 'Carto dark matter', credit: '© OpenStreetMap contributors © CARTO' },
  { id: 'osm', name: 'Streets', desc: 'OpenStreetMap', credit: '© OpenStreetMap contributors' },
  { id: 'night', name: 'City lights', desc: 'NASA Black Marble', credit: 'NASA Earth Observatory, Black Marble' },
  { id: 'google3d', name: 'Photoreal 3D', desc: 'Google 3D Tiles (needs your free Cesium ion token)', credit: 'Google Photorealistic 3D Tiles', key: true },
];

function provider(id) {
  switch (id) {
    case 'dark':
      return new C.UrlTemplateImageryProvider({ url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png', subdomains: 'abcd', maximumLevel: 19, tileWidth: 512, tileHeight: 512 });
    case 'osm':
      return new C.UrlTemplateImageryProvider({ url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maximumLevel: 19 });
    case 'night':
      return new C.UrlTemplateImageryProvider({ url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png', maximumLevel: 8 });
    default:
      return new C.UrlTemplateImageryProvider({ url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', maximumLevel: 19 });
  }
}

export async function initViewer() {
  viewer = new C.Viewer('globe', {
    baseLayer: false, animation: false, timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false,
    sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false, infoBox: false, selectionIndicator: false,
    scene3DOnly: true, msaaSamples: 4, shadows: false,
    contextOptions: { webgl: { alpha: false, antialias: true, powerPreference: 'high-performance' } },
  });
  scene = viewer.scene;
  camera = viewer.camera;
  viewer.useBrowserRecommendedResolution = false;
  viewer.resolutionScale = Math.min(1, 2 / (window.devicePixelRatio || 1));
  scene.globe.baseColor = C.Color.fromCssColorString('#0b0f0c');
  scene.backgroundColor = C.Color.BLACK;
  scene.highDynamicRange = false;
  scene.globe.showGroundAtmosphere = true;
  scene.skyAtmosphere.show = true;
  scene.fog.enabled = true;
  scene.fog.density = 0.00012;
  scene.globe.maximumScreenSpaceError = 1.6;
  scene.globe.depthTestAgainstTerrain = false;
  scene.screenSpaceCameraController.minimumZoomDistance = 25;
  scene.screenSpaceCameraController.maximumZoomDistance = 7.5e7;
  scene.screenSpaceCameraController.inertiaZoom = 0.82;
  viewer.clock.shouldAnimate = true;
  viewer.clock.clockStep = C.ClockStep.SYSTEM_CLOCK;
  viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  occluder = new C.EllipsoidalOccluder(C.Ellipsoid.WGS84, camera.positionWC);
  scene.preRender.addEventListener(() => { occluder.cameraPosition = camera.positionWC; });

  setBasemap(store.get('basemap', 'satellite'), true);
  setLabels(store.get('labels', true));
  setLighting(store.get('lighting', false));
  loadTerrain();

  camera.setView({ destination: C.Cartesian3.fromDegrees(-40, 24, 2.4e7), orientation: { heading: 0, pitch: -C.Math.PI_OVER_TWO, roll: 0 } });
  camera.percentageChanged = 0.02;
  camera.changed.addEventListener(() => emit('camera'));
  camera.moveEnd.addEventListener(() => emit('camera:end'));
  return viewer;
}

export function keys() { return store.get('keys', {}); }

async function loadTerrain() {
  try {
    const k = keys();
    if (k.ion) { C.Ion.defaultAccessToken = k.ion; scene.terrainProvider = await C.createWorldTerrainAsync(); }
    else scene.terrainProvider = await C.CesiumTerrainProvider.fromUrl('https://terrain.reearth.land/cesium-mesh/ellipsoid', { requestVertexNormals: false });
    emit('terrain', true);
  } catch (e) {
    console.warn('[argus] terrain unavailable, continuing on the ellipsoid', e);
    emit('terrain', false);
  }
}

export async function setBasemap(id, silent = false) {
  const k = keys();
  if (id === 'google3d' && !k.ion && !k.google) {
    if (!silent) emit('toast', { text: 'Photoreal 3D needs a free Cesium ion token. Add it in Power Up.', kind: 'err' });
    if (!silent) emit('open:settings');
    id = state.basemap === 'google3d' ? 'satellite' : state.basemap || 'satellite';
    if (silent) id = 'satellite';
  }
  const il = scene.imageryLayers;
  if (tileset) { scene.primitives.remove(tileset); tileset = null; scene.globe.show = true; }
  if (layers.base) il.remove(layers.base, true);
  if (id === 'google3d') {
    try {
      if (k.ion) C.Ion.defaultAccessToken = k.ion; else C.GoogleMaps.defaultApiKey = k.google;
      tileset = await C.createGooglePhotorealistic3DTileset({ onlyUsingWithGoogleGeocoder: true }, { maximumScreenSpaceError: 12 });
      scene.primitives.add(tileset);
      scene.globe.show = false;
      layers.base = null;
    } catch (e) {
      console.warn(e);
      emit('toast', { text: 'Photoreal 3D could not start. Check the token in Power Up.', kind: 'err' });
      id = 'satellite';
    }
  }
  if (id !== 'google3d') {
    layers.base = il.addImageryProvider(provider(id), 0);
    if (id === 'night') { layers.base.brightness = 1.6; layers.base.gamma = 0.85; }
    if (id === 'satellite') { layers.base.saturation = 1.08; layers.base.contrast = 1.06; }
  }
  set('basemap', id);
  store.set('basemap', id);
  setLabels(state.labels);
  syncNight();
}

export function setLabels(on) {
  const il = scene.imageryLayers;
  if (layers.labels) { il.remove(layers.labels, true); layers.labels = null; }
  const wants = on && (state.basemap === 'satellite' || state.basemap === 'night');
  if (wants) {
    layers.labels = il.addImageryProvider(new C.UrlTemplateImageryProvider({ url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', maximumLevel: 19 }));
    layers.labels.alpha = 0.85;
  }
  set('labels', !!on);
  store.set('labels', !!on);
}

function syncNight() {
  const il = scene.imageryLayers;
  if (layers.night) { il.remove(layers.night, true); layers.night = null; }
  if (state.lighting && state.basemap === 'satellite') {
    const idx = layers.base ? il.indexOf(layers.base) + 1 : 0;
    layers.night = il.addImageryProvider(provider('night'), idx);
    layers.night.dayAlpha = 0; layers.night.nightAlpha = 1; layers.night.brightness = 2.2;
  }
}
export function setLighting(on) {
  scene.globe.enableLighting = !!on;
  scene.globe.dynamicAtmosphereLighting = !!on;
  set('lighting', !!on);
  store.set('lighting', !!on);
  syncNight();
}

/** Insert an overlay imagery layer above the base stack. */
export function addOverlay(prov, opts = {}) {
  const l = scene.imageryLayers.addImageryProvider(prov);
  Object.assign(l, opts);
  return l;
}
export function removeOverlay(l) { if (l) scene.imageryLayers.remove(l, true); }

/* ----------------------------------------------------------- camera info */
const scratchC = new C.Cartesian2();
export function camInfo() {
  const p = camera.positionCartographic;
  const canvas = scene.canvas;
  scratchC.x = canvas.clientWidth / 2; scratchC.y = canvas.clientHeight / 2;
  let clat = deg(p.latitude), clon = deg(p.longitude), range = p.height, onGlobe = false;
  const hit = pickCart(scratchC);
  if (hit) {
    const cg = C.Cartographic.fromCartesian(hit);
    clat = deg(cg.latitude); clon = deg(cg.longitude);
    range = C.Cartesian3.distance(camera.positionWC, hit);
    onGlobe = true;
  }
  return { lat: deg(p.latitude), lon: deg(p.longitude), height: p.height, heading: deg(camera.heading), pitch: deg(camera.pitch), roll: deg(camera.roll), clat, clon, range, onGlobe };
}
export function pickCart(windowPos) {
  let hit;
  if (scene.globe.show) {
    const ray = camera.getPickRay(windowPos);
    if (ray) hit = scene.globe.pick(ray, scene);
  }
  if (!hit) hit = camera.pickEllipsoid(windowPos, C.Ellipsoid.WGS84);
  return hit || null;
}
export function pickLatLon(windowPos) {
  const hit = pickCart(windowPos);
  if (!hit) return null;
  const cg = C.Cartographic.fromCartesian(hit);
  return { lat: deg(cg.latitude), lon: deg(cg.longitude), height: cg.height };
}
/** Approximate radius (m) of the ground currently in view. */
export function viewRadiusM() {
  const info = camInfo();
  const fov = camera.frustum.fovy || camera.frustum.fov || 1;
  const r = info.range * Math.tan(fov / 2) * Math.max(1, scene.canvas.clientWidth / scene.canvas.clientHeight);
  return clamp(r / Math.max(0.25, Math.sin(Math.abs(rad(info.pitch)))), 50, 6.4e6);
}
const scratchW = new C.Cartesian2();
export function toScreen(cart) {
  if (!occluder.isPointVisible(cart)) return null;
  const w = C.SceneTransforms.worldToWindowCoordinates(scene, cart, scratchW);
  if (!w) return null;
  return w;
}
export const isVisible = (cart) => occluder.isPointVisible(cart);

/* ---------------------------------------------------------------- motion */
export function flyTo({ lat, lon, height = 1.2e6, heading = 0, pitch = -90, duration = 2.2 }) {
  viewer.trackedEntity = undefined;
  return new Promise((resolve) => {
    camera.flyTo({
      destination: C.Cartesian3.fromDegrees(lon, lat, height),
      orientation: { heading: rad(heading), pitch: rad(pitch), roll: 0 },
      duration, easingFunction: C.EasingFunction.CUBIC_IN_OUT, complete: resolve, cancel: resolve,
    });
  });
}
/** Fly so that (lat, lon) is centered, viewed from `range` metres at the given heading / pitch. */
/** Ground elevation in metres from whatever terrain is already loaded (0 when unknown). */
export function groundNow(lat, lon) {
  const h = scene.globe.getHeight(C.Cartographic.fromDegrees(lon, lat));
  return Number.isFinite(h) ? h : 0;
}
/** Ground elevation from the terrain source itself, so a far-away target is right before we arrive. */
export async function groundAt(lat, lon) {
  try {
    const pts = [C.Cartographic.fromDegrees(lon, lat)];
    await Promise.race([C.sampleTerrainMostDetailed(viewer.terrainProvider, pts), new Promise((_, no) => setTimeout(no, 2500))]);
    if (Number.isFinite(pts[0].height)) return pts[0].height;
  } catch { /* flat terrain, or the sample was slow */ }
  return groundNow(lat, lon);
}
export async function lookAt({ lat, lon, alt = 0, range = 60000, heading = 0, pitch = -45, duration = 2.4 }) {
  viewer.trackedEntity = undefined;
  // Aim at the real ground, not sea level: otherwise close views of high places end up inside the terrain.
  if (!alt && range < 300000) alt = await groundAt(lat, lon);
  return new Promise((resolve) => {
    camera.flyToBoundingSphere(new C.BoundingSphere(C.Cartesian3.fromDegrees(lon, lat, alt), 1), {
      offset: new C.HeadingPitchRange(rad(heading), rad(pitch), range), duration,
      easingFunction: C.EasingFunction.CUBIC_IN_OUT, complete: resolve, cancel: resolve,
    });
  });
}
export function resetGlobe() {
  const i = camInfo();
  return flyTo({ lat: clamp(i.clat, -50, 50), lon: i.clon, height: 2.2e7, duration: 2.6 });
}
export function setTilt(oblique) {
  const i = camInfo();
  if (!i.onGlobe) return;
  return lookAt({ lat: i.clat, lon: i.clon, range: Math.max(400, i.range), heading: i.heading, pitch: oblique ? -35 : -90, duration: 1.1 });
}
export function northUp() {
  const i = camInfo();
  if (!i.onGlobe) return;
  return lookAt({ lat: i.clat, lon: i.clon, range: Math.max(400, i.range), heading: 0, pitch: clamp(i.pitch, -90, -10), duration: 0.9 });
}
export function cart(lat, lon, alt = 0) { return C.Cartesian3.fromDegrees(lon, lat, alt); }
export function color(css, alpha = 1) { return C.Color.fromCssColorString(css).withAlpha(alpha); }
