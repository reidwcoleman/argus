// Scene director: capture camera shots, play them back as a cinematic tour, share scenes as files.
import { C, camera, camInfo } from '../core/viewer.js';
import { state, set, on, emit, store } from '../core/bus.js';
import { registerPanel } from './shell.js';
import { icon, toast } from './dom.js';
import { setLayer, enabledIds, registry } from '../layers/base.js';
import { spin, orbit, stopMotion } from '../core/motion.js';
import { esc } from '../core/geo.js';
import { regionName } from '../fx/hud.js';

const BUILTIN = [
  { id: 'orbital-watch', name: 'Orbital Watch', blurb: 'The satellite shell, from far out to the station', layers: ['satellites'], style: 'normal', shots: [
    { name: 'The whole shell', cam: [-40, 12, 3.4e7, 0, -90], dur: 4, hold: 7, move: 'spin' },
    { name: 'Pacific limb', cam: [-150, 20, 1.6e7, 20, -72], dur: 6, hold: 6, move: 'spin' },
    { name: 'Low orbit lane', cam: [15, 42, 5.5e6, 40, -55], dur: 6, hold: 7, move: 'orbit', style: 'nvg' },
    { name: 'Home again', cam: [-40, 24, 2.4e7, 0, -90], dur: 5, hold: 3, style: 'normal' }] },
  { id: 'ring-of-fire', name: 'Ring of Fire', blurb: 'Quakes and volcanoes around the Pacific rim', layers: ['earthquakes', 'hazards'], style: 'normal', shots: [
    { name: 'The Pacific', cam: [-170, 5, 2.3e7, 0, -90], dur: 4, hold: 5 },
    { name: 'Japan trench', cam: [142, 30, 3.2e6, 330, -50], dur: 6, hold: 6, move: 'orbit' },
    { name: 'Indonesia arc', cam: [118, -14, 4.2e6, 350, -52], dur: 6, hold: 6, move: 'orbit', style: 'flir' },
    { name: 'Andes', cam: [-82, -24, 4.4e6, 70, -48], dur: 7, hold: 6, move: 'orbit', style: 'normal' },
    { name: 'Cascadia', cam: [-130, 40, 3e6, 80, -50], dur: 6, hold: 5, move: 'orbit' }] },
  { id: 'air-rush', name: 'Air Rush', blurb: 'The busiest skies on Earth, hub to hub', layers: ['flights', 'military'], style: 'normal', detect: true, shots: [
    { name: 'North Atlantic tracks', cam: [-35, 42, 9e6, 0, -80], dur: 4, hold: 6 },
    { name: 'London', cam: [-0.45, 50.6, 260000, 0, -42], dur: 7, hold: 8, move: 'orbit' },
    { name: 'New York', cam: [-73.9, 39.9, 260000, 0, -42], dur: 8, hold: 8, move: 'orbit', style: 'crt' },
    { name: 'Los Angeles', cam: [-118.4, 33.2, 240000, 0, -40], dur: 8, hold: 8, move: 'orbit', style: 'nvg' }] },
  { id: 'cable-run', name: 'Cable Run', blurb: 'The undersea internet, coast to coast', layers: ['cables', 'datacenters'], style: 'noir', shots: [
    { name: 'Atlantic bundle', cam: [-38, 38, 9e6, 0, -85], dur: 4, hold: 6 },
    { name: 'Landing at Cornwall', cam: [-5.2, 48.4, 700000, 10, -45], dur: 7, hold: 6, move: 'orbit' },
    { name: 'Red Sea chokepoint', cam: [38, 14, 2.6e6, 340, -55], dur: 8, hold: 6, move: 'orbit' },
    { name: 'Singapore hub', cam: [104, -2.5, 1.3e6, 0, -50], dur: 8, hold: 6, move: 'orbit', style: 'normal' }] },
];
let scenes = store.get('scenes', []);
let cur = store.get('scene:cur', null) || { id: 'mine', name: 'My scene', shots: [] };
let playing = null;
const saveCur = () => store.set('scene:cur', cur);

function capture() {
  const c = camInfo();
  cur.shots.push({ name: c.onGlobe ? regionName(c.clat, c.clon) : 'Deep space', cam: [+c.lon.toFixed(5), +c.lat.toFixed(5), Math.round(c.height), +c.heading.toFixed(1), +c.pitch.toFixed(1)], dur: 4, hold: 3, style: state.style });
  saveCur(); emit('director');
}
const fly = (s, token) => new Promise((res) => {
  camera.flyTo({ destination: C.Cartesian3.fromDegrees(s.cam[0], s.cam[1], s.cam[2]), orientation: { heading: C.Math.toRadians(s.cam[3]), pitch: C.Math.toRadians(s.cam[4]), roll: 0 }, duration: s.dur, easingFunction: C.EasingFunction.QUADRATIC_IN_OUT, complete: res, cancel: res });
  token.cancelFly = () => camera.cancelFlight();
});
const wait = (ms, token) => new Promise((res) => { token.timer = setTimeout(res, ms); token.skip = res; });

export async function playScene(scene, { loop = false } = {}) {
  if (typeof scene === 'string') scene = BUILTIN.find((s) => s.id === scene || s.name.toLowerCase() === scene.toLowerCase()) || scenes.find((s) => s.name.toLowerCase() === scene.toLowerCase());
  if (!scene || !scene.shots.length) return false;
  stopScene();
  const token = { live: true };
  playing = { token, scene, i: 0, before: { layers: enabledIds(), style: state.style, detect: state.detect, panel: state.panel } };
  if (scene.layers) for (const id of scene.layers) if (registry.has(id)) setLayer(id, true, { persist: false });
  if (scene.detect != null) set('detect', scene.detect);
  if (scene.style) set('style', scene.style);
  document.body.classList.add('cinema');
  set('panel', null);
  emit('director');
  const onKey = (e) => { if (e.key === 'Escape') stopScene(); };
  addEventListener('keydown', onKey, true);
  token.cleanup = () => removeEventListener('keydown', onKey, true);
  do {
    for (let i = 0; i < scene.shots.length && token.live; i++) {
      const s = scene.shots[i];
      playing.i = i;
      emit('director:shot', { scene, i, s });
      stopMotion();
      if (s.style) set('style', s.style);
      await fly(s, token);
      if (!token.live) break;
      if (s.move === 'spin') spin(1, 3); else if (s.move === 'orbit') orbit(4);
      await wait((s.hold ?? 3) * 1000, token);
    }
  } while (loop && token.live);
  if (token.live) stopScene(true);
  return true;
}
export function stopScene(finished = false) {
  if (!playing) return;
  const { token } = playing;
  token.live = false;
  clearTimeout(token.timer); token.skip?.(); token.cancelFly?.(); token.cleanup?.();
  stopMotion();
  document.body.classList.remove('cinema');
  const b = playing.before;
  playing = null;
  set('panel', b.panel);
  emit('director');
  emit('director:shot', null);
  if (finished) emit('toast', { text: 'Scene finished. Your layers are still staged from it.' });
}
export const sceneNames = () => [...BUILTIN, ...scenes].map((s) => s.name);

function exportScene(scene) {
  const blob = new Blob([JSON.stringify({ argusScene: 1, ...scene }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = scene.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.argus-scene.json';
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function importScene(file) {
  try {
    const d = JSON.parse(await file.text());
    if (!d.argusScene || !Array.isArray(d.shots) || !d.shots.every((s) => Array.isArray(s.cam) && s.cam.length >= 5)) throw new Error('shape');
    const sc = { id: 'u' + Date.now(), name: String(d.name || 'Imported scene').slice(0, 60), blurb: `${d.shots.length} shots, imported`, layers: d.layers, style: d.style, detect: d.detect, shots: d.shots.slice(0, 60) };
    scenes.push(sc); store.set('scenes', scenes); emit('director');
    toast(`Imported "${sc.name}". Press play to preview it.`);
  } catch { toast('That file is not an Argus scene. Export one from this panel to see the format.', 'err'); }
}

registerPanel({
  id: 'director', title: 'Scene director', icon: 'film',
  render(body) {
    const draw = () => {
      const top = body.scrollTop;
      body.innerHTML = `
        <section class="group"><div class="group-head"><span class="eyebrow">Your scene</span><span class="eyebrow">${cur.shots.length} ${cur.shots.length === 1 ? 'shot' : 'shots'}</span></div>
          ${cur.shots.length ? cur.shots.map((s, i) => `<div class="shot"><span class="i">${String(i + 1).padStart(2, '0')}</span><button data-go="${i}" style="text-align:left;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.name)}<span class="note" style="padding:0;display:block">${s.style && s.style !== 'normal' ? s.style.toUpperCase() + ' · ' : ''}${(s.cam[2] / 1000).toFixed(0)} km up</span></button><input class="input" type="number" min="1" max="30" step="1" value="${s.dur}" data-dur="${i}" aria-label="Seconds to arrive" data-tip="Seconds to arrive"><button class="icon-btn" data-del="${i}" aria-label="Delete shot">${icon('trash', 15)}</button></div>`).join('')
            : `<div class="empty">${icon('film', 26)}<b>Build a camera tour</b>Frame a view you like and capture it. Add a few and Argus flies between them, optic and all.</div>`}
          <div style="display:flex;gap:6px;padding:8px"><button class="btn ${cur.shots.length ? '' : 'primary'}" style="flex:1" data-a="capture">${icon('plus', 15)}Capture this view</button>${cur.shots.length > 1 ? `<button class="btn primary" data-a="play">${icon('play', 15)}Play</button>` : ''}</div>
          ${cur.shots.length ? `<div style="display:flex;gap:6px;padding:0 8px"><button class="btn sm ghost" data-a="export">${icon('download', 14)}Export</button><button class="btn sm ghost" data-a="save">Save to library</button><button class="btn sm ghost danger" data-a="reset">Clear</button></div>` : ''}
        </section>
        <section class="group"><div class="group-head"><span class="eyebrow">Library</span><label class="btn ghost sm" style="cursor:pointer">${icon('upload', 14)}Import<input type="file" accept=".json" hidden></label></div>
          ${[...BUILTIN, ...scenes].map((s) => `<div class="item" style="grid-template-columns:1fr auto auto;align-items:center"><span><span class="t">${esc(s.name)}</span><span class="d">${esc(s.blurb || s.shots.length + ' shots')}</span></span>${s.id.startsWith('u') ? `<button class="icon-btn" data-rm="${s.id}" aria-label="Remove scene">${icon('trash', 15)}</button>` : '<span></span>'}<button class="btn sm" data-scene="${s.id}">${icon('play', 13)}Play</button></div>`).join('')}
        </section>
        <p class="note" style="margin-top:12px">Playback hides the interface. Press Esc or click the globe to take the camera back.</p>`;
      body.scrollTop = top;
    };
    body.addEventListener('click', (e) => {
      const t = (s) => e.target.closest(s);
      let b;
      if ((b = t('[data-go]'))) { const s = cur.shots[+b.dataset.go]; if (s.style) set('style', s.style); return void camera.flyTo({ destination: C.Cartesian3.fromDegrees(s.cam[0], s.cam[1], s.cam[2]), orientation: { heading: C.Math.toRadians(s.cam[3]), pitch: C.Math.toRadians(s.cam[4]), roll: 0 }, duration: 1.6 }); }
      if ((b = t('[data-del]'))) { cur.shots.splice(+b.dataset.del, 1); saveCur(); return draw(); }
      if ((b = t('[data-scene]'))) return void playScene([...BUILTIN, ...scenes].find((s) => s.id === b.dataset.scene));
      if ((b = t('[data-rm]'))) { scenes = scenes.filter((s) => s.id !== b.dataset.rm); store.set('scenes', scenes); return draw(); }
      const a = t('[data-a]')?.dataset.a;
      if (a === 'capture') capture();
      if (a === 'play') playScene(cur);
      if (a === 'export') exportScene({ ...cur, layers: enabledIds() });
      if (a === 'save') { scenes.push({ ...cur, id: 'u' + Date.now(), name: `My scene ${scenes.length + 1}`, blurb: `${cur.shots.length} shots`, layers: enabledIds() }); store.set('scenes', scenes); toast('Saved to your library.'); draw(); }
      if (a === 'reset') { cur.shots = []; saveCur(); draw(); }
    });
    body.addEventListener('change', (e) => {
      const d = e.target.closest('[data-dur]');
      if (d) { cur.shots[+d.dataset.dur].dur = Math.max(1, Math.min(30, +d.value || 4)); saveCur(); }
      if (e.target.type === 'file' && e.target.files[0]) importScene(e.target.files[0]);
    });
    const off = on('director', draw);
    draw();
    return off;
  },
});
