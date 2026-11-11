// First-run launcher, field missions, and Global Context (stage the whole picture, then get your view back).
import { C, camera, camInfo, flyTo, lookAt, resetGlobe } from '../core/viewer.js';
import { state, set, on, emit, store } from '../core/bus.js';
import { registerPanel } from './shell.js';
import { el, ui, icon, toast } from './dom.js';
import { setLayer, setOnly, enabledIds, registry } from '../layers/base.js';
import { select } from '../core/select.js';
import { aircraftNear } from '../layers/flights.js';
import { findSatellite } from '../layers/satellites.js';
import { orbit } from '../core/motion.js';
import { addShape, solveRoute, flyRoute } from './tools.js';
import { distM, fmtDist } from '../core/geo.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await sleep(400); } return null; }
/** A busy hub in the user's own part of the world, guessed from the clock rather than their location. */
function homeHub() {
  const lon = -new Date().getTimezoneOffset() / 4;
  const hubs = [['New York', 40.64, -73.78], ['Los Angeles', 33.94, -118.4], ['Chicago', 41.97, -87.9], ['London', 51.47, -0.45], ['Frankfurt', 50.04, 8.56], ['Dubai', 25.25, 55.36], ['Delhi', 28.56, 77.1], ['Singapore', 1.36, 103.99], ['Tokyo', 35.55, 139.78], ['Sydney', -33.94, 151.18], ['São Paulo', -23.43, -46.47]];
  return hubs.reduce((a, b) => (Math.abs(b[2] - lon) < Math.abs(a[2] - lon) ? b : a));
}

const LAUNCH = {
  async contacts() {
    const [name, lat, lon] = homeHub();
    await setOnly(['flights', 'military']);
    set('detect', true);
    await lookAt({ lat, lon, range: 520000, pitch: -48, duration: 3 });
    toast(`Live traffic around ${name}. Click any aircraft to lock on.`);
  },
  async space() {
    await setOnly(['satellites', 'launches']);
    set('detect', false);
    await flyTo({ lat: 15, lon: camInfo().clon, height: 2.6e7, duration: 2.4 });
    const iss = await until(() => findSatellite('iss'), 20000);
    if (iss) { select('satellites', iss.id, { track: true }); toast('Riding with the International Space Station. The ring is one full orbit.'); }
  },
  async environment() {
    await setOnly(['earthquakes', 'fires', 'hazards', 'cyclones', 'wind']);
    set('detect', false);
    await flyTo({ lat: 10, lon: camInfo().clon, height: 2.4e7, duration: 2.4 });
    toast('Quakes, fires, storms and wind, all from the last 24 hours.');
  },
};

export function showLauncher() {
  const m = el(`<div class="scrim"><div class="modal surface" role="dialog" aria-modal="true" aria-labelledby="lt">
    <div class="modal-head"><div><span class="eyebrow">Argus</span><h1 id="lt">See what the planet is broadcasting.</h1><p>Aircraft transponders, ship beacons, orbital elements, seismographs and public cameras are already public. Argus puts them on one globe. Pick a place to start.</p></div>
      <button class="icon-btn" data-m="skip" aria-label="Close">${icon('x', 18)}</button></div>
    <div class="missions">
      <button class="mission primary" data-m="contacts"><div class="art"><svg viewBox="0 0 120 54" width="120" height="54" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 44c24-30 88-30 112 0" stroke-dasharray="3 6"/><path d="M60 8l5 14 20 12v4l-20-5v9l6 5v3l-11-3-11 3v-3l6-5v-9l-20 5v-4l20-12 5-14Z" fill="currentColor" stroke="none"/></svg></div><h3>Live contacts</h3><p>Thousands of aircraft on real telemetry. Click one and ride along.</p></button>
      <button class="mission" data-m="space" style="--c:#c9b8ff"><div class="art"><svg viewBox="0 0 120 54" width="120" height="54" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="60" cy="27" r="13"/><ellipse cx="60" cy="27" rx="46" ry="12" transform="rotate(-18 60 27)"/><circle cx="101" cy="15" r="3.5" fill="currentColor"/></svg></div><h3>Space missions</h3><p>Follow the ISS around its orbit and scrub through recent launches.</p></button>
      <button class="mission" data-m="environment" style="--c:#ff9a5c"><div class="art"><svg viewBox="0 0 120 54" width="120" height="54" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 30h20l8-18 12 34 10-26 8 14h50"/></svg></div><h3>Environmental</h3><p>Earthquakes, fires, storms and wind from the last 24 hours.</p></button>
      <button class="mission" data-m="skip" style="--c:#e9ede6"><div class="art"><svg viewBox="0 0 120 54" width="120" height="54" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="60" cy="27" r="20"/><path d="M60 7v40M40 27h40M46 13c8 8 8 20 0 28M74 13c-8 8-8 20 0 28"/></svg></div><h3>Explore manually</h3><p>Start with an empty globe and switch layers on yourself.</p></button>
    </div>
    <div class="modal-foot"><span>No account and no API keys. Everything here is a public feed.</span><span><span class="kbd">⌘K</span> to search or give a command</span></div></div></div>`);
  ui().appendChild(m);
  const close = () => { m.remove(); store.set('seen', true); removeEventListener('keydown', esc, true); };
  const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  addEventListener('keydown', esc, true);
  m.addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]');
    if (!b && e.target !== m) return;
    const id = b?.dataset.m;
    close();
    if (id && LAUNCH[id]) { set('panel', 'layers'); LAUNCH[id](); }
  });
  m.querySelector('.mission.primary').focus();
}
export const runLaunch = (id) => LAUNCH[id]?.();

/* ---------------------------------------------------------- field missions */
const FIELD = [
  { id: 'approach', name: 'Final approach', need: 'Live flights', blurb: 'Lock onto an airliner descending toward a runway, then take the cockpit.', async run() {
    const [name, lat, lon] = homeHub();
    await setLayer('flights', true);
    await lookAt({ lat, lon, range: 160000, pitch: -45, duration: 2.6 });
    const pick = await until(() => aircraftNear(lat, lon, 120, (o) => !o.gnd && o.alt < 3200 && o.alt > 300 && o.vr < -1.5)[0], 25000);
    if (!pick) return toast(`Nothing is on approach near ${name} right now. Try again in a minute.`);
    select(pick.L, pick.key, { track: true });
    toast(`${pick.label} is descending into ${name}. Press Cockpit on its card.`);
  } },
  { id: 'night', name: 'Night watch', need: 'NVG optic', blurb: 'Night vision over your own part of the world, HUD and detection reading the scene.', async run() {
    const [, lat, lon] = homeHub();
    await setLayer('flights', true);
    set('style', 'nvg'); set('hud', true); set('detect', true);
    await lookAt({ lat, lon, range: 90000, pitch: -38, duration: 2.8 });
    orbit(3);
  } },
  { id: 'port', name: 'Port call', need: 'Live vessels', blurb: 'Ships working the Port of Helsinki, then the same water through a public camera.', async run() {
    await setLayer('vessels', true); await setLayer('cameras', true);
    await lookAt({ lat: 60.15, lon: 24.95, range: 26000, pitch: -42, duration: 2.8 });
    const L = registry.get('vessels');
    const ship = await until(() => L.contacts().filter((c) => distM(60.15, 24.95, c.lat, c.lon) < 30000).sort((a, b) => (b.spd || 0) - (a.spd || 0))[0], 20000);
    if (ship) { select('vessels', ship.key, { track: true }); toast(`${ship.label} is under way. Press Nearest camera on its card for a ground view.`); }
    else toast('No vessels are reporting near Helsinki yet. Give the feed a few seconds.');
  } },
  { id: 'radio', name: 'Tokyo FM', need: 'World radio', blurb: 'Orbit Shibuya, then drag the tuner: every position is a real station.', async run() {
    await setLayer('radio', true);
    set('panel', 'radio');
    await lookAt({ lat: 35.6595, lon: 139.7005, range: 9000, pitch: -30, duration: 2.8 });
    orbit(5);
  } },
  { id: 'fire', name: 'Fire line', need: 'Active fires', blurb: 'Dive to the most intense heat detection on Earth right now.', async run() {
    await setLayer('fires', true);
    const L = registry.get('fires');
    const top = await until(() => { const a = L.all?.() || []; return a.length ? a.reduce((x, y) => (y.frp > x.frp ? y : x)) : null; }, 40000);
    if (!top) return toast('The fire feed has not loaded yet. Try again in a moment.');
    select('fires', top.key, { fly: true });
    toast(`${Math.round(top.frp).toLocaleString()} megawatts of radiative power. Nearest camera gives a ground view where one exists.`);
  } },
  { id: 'launch', name: 'Launch replay', need: 'Space missions', blurb: 'Ride the most recent launch from T-minus through ascent to orbit.', async run() {
    await setLayer('launches', true);
    const L = registry.get('launches');
    const last = await until(() => (L.all?.() || []).filter((l) => !l.upcoming).sort((a, b) => b.net - a.net)[0], 30000);
    if (!last) return toast('No launch from the last 30 days is loaded yet.');
    select('launches', last.key, { fly: false });
    emit('launch:replay', last.key);
  } },
  { id: 'loops', name: 'Ask the planet', need: 'Military flights', blurb: 'Pick a military helicopter and see what its track has been doing.', async run() {
    await setLayer('military', true);
    const L = registry.get('military');
    const heli = await until(() => { const c = L.contacts(); return c.find((x) => x.klass === 'heli' && !x.ground) || c.find((x) => !x.ground && x.spd > 40); }, 25000);
    if (!heli) return toast('No airborne military contact is reporting right now.');
    select('military', heli.key, { track: true });
    toast(`${heli.label}: the trail fills in with real track history when the source has it.`);
  } },
  { id: 'boneyard', name: 'Walk the boneyard', need: 'Satellite map', blurb: 'Rows of retired airframes in the Arizona desert, from regional view to the ramp.', async run() {
    await lookAt({ lat: 32.155, lon: -110.835, range: 60000, pitch: -60, duration: 2.4 });
    await lookAt({ lat: 32.1512, lon: -110.8262, range: 3200, pitch: -42, heading: 30, duration: 4 });
    orbit(4);
  } },
  { id: 'gorges', name: 'Orbit Three Gorges', need: 'Dams', blurb: 'Sweep the largest dam on Earth, then find 703 more.', async run() {
    await setLayer('dams', true);
    await lookAt({ lat: 30.8231, lon: 111.0037, range: 9000, pitch: -28, heading: 200, duration: 3 });
    orbit(5);
  } },
  { id: 'measure', name: 'Measure LAX to DFW', need: 'Draw', blurb: 'An arrow across the country, with the distance pinned to the real world.', async run() {
    const s = addShape({ type: 'measure', name: 'LAX to DFW', color: '#c8f55a', pts: [[33.9416, -118.4085], [32.8998, -97.0403]] });
    await flyTo({ lat: 34, lon: -107.5, height: 3.4e6, duration: 2.4 });
    toast(`LAX to DFW is ${fmtDist(distM(...s.pts[0], ...s.pts[1]))} in a straight line.`);
  } },
  { id: 'walk', name: 'Walk Austin', need: 'Directions', blurb: 'A real walking route from the Capitol to Zilker Park, flown like a drone shot.', async run() {
    set('panel', 'tools');
    const r = await solveRoute({ lat: 30.2747, lon: -97.7404, name: 'Texas State Capitol' }, { lat: 30.267, lon: -97.7729, name: 'Zilker Park' }, 'foot');
    if (!r) return toast('The routing server did not answer. Try again in a moment.', 'err');
    await sleep(2200);
    flyRoute();
  } },
];
registerPanel({
  id: 'missions', title: 'Missions', icon: 'target', key: 'M',
  render(body) {
    body.innerHTML = `<section class="group"><div class="group-head"><span class="eyebrow">Start here</span></div>
        ${[['contacts', 'Live contacts', 'Aircraft on real telemetry around a busy hub'], ['space', 'Space missions', 'The ISS, the satellite shell and recent launches'], ['environment', 'Environmental', 'Quakes, fires, storms and wind']].map(([id, n, d]) => `<button class="item" data-l="${id}"><span class="t">${n}</span><span class="r">${icon('chevron', 14)}</span><span class="d">${d}</span></button>`).join('')}</section>
      <section class="group"><div class="group-head"><span class="eyebrow">Field missions</span></div>
        ${FIELD.map((m) => `<button class="item" data-f="${m.id}"><span class="t">${m.name}</span><span class="r">${m.need}</span><span class="d" style="display:block">${m.blurb}</span></button>`).join('')}</section>`;
    body.addEventListener('click', async (e) => {
      const l = e.target.closest('[data-l]'), f = e.target.closest('[data-f]');
      if (l) LAUNCH[l.dataset.l]();
      if (f) { const m = FIELD.find((x) => x.id === f.dataset.f); try { await m.run(); } catch (err) { console.warn(err); toast(`${m.name} could not start: a feed did not answer.`, 'err'); } }
    });
  },
});
export function runMission(text) {
  const t = text.toLowerCase();
  const m = FIELD.find((x) => t.includes(x.name.toLowerCase()) || t.includes(x.id));
  if (m) { m.run(); return m.name; }
  return null;
}

/* --------------------------------------------------------- global context */
let before = null;
const STAGE = ['flights', 'satellites', 'vessels', 'earthquakes', 'cables', 'datacenters'];
export async function setContext(v, stage = STAGE) {
  if (v === state.context) return;
  if (v) {
    const c = camInfo();
    before = { cam: { pos: camera.positionWC.clone(), h: camera.heading, p: camera.pitch }, layers: enabledIds(), detect: state.detect };
    set('context', true);
    set('detect', false);
    for (const id of stage) setLayer(id, true, { persist: false });
    await flyTo({ lat: Math.max(-40, Math.min(40, c.clat)), lon: c.clon, height: 2.3e7, duration: 2.6 });
    toast('Global context: the whole picture. Press G again to get your exact view back.');
  } else {
    set('context', false);
    if (!before) return;
    for (const id of enabledIds()) if (!before.layers.includes(id)) setLayer(id, false, { persist: false });
    set('detect', before.detect);
    camera.flyTo({ destination: before.cam.pos, orientation: { heading: before.cam.h, pitch: before.cam.p, roll: 0 }, duration: 2.2, easingFunction: C.EasingFunction.CUBIC_IN_OUT });
    before = null;
  }
}
on('context:toggle', () => setContext(!state.context));
void resetGlobe;
