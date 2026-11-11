// Cockpit: ride a tracked flight. The camera sits on the live contact, the terrain holds underneath,
// and a contacts scope keeps everything within 250 km one click away.
import { C, scene, camera, viewer } from '../core/viewer.js';
import { state, set, on, emit } from '../core/bus.js';
import { current, currentInfo, select, stopTracking } from '../core/select.js';
import { aircraftNear } from '../layers/flights.js';
import { weatherAt, wmoText } from '../layers/weather.js';
import { headlinesNear } from '../layers/news.js';
import { regionName } from '../fx/hud.js';
import { el, icon, toast } from './dom.js';
import { fmtAlt, fmtSpeed, compass, fmtDist, bearing, wrap180, clamp, esc, rad } from '../core/geo.js';

let root, tick = null, look = { yaw: 0, pitch: -7 }, drag = null, hdgS = null, bank = 0, lastT = 0, filter = 'all', wx = null, wxAt = 0, uiTimer = null, saved = null;
const FILTERS = { all: ['All', null], jets: ['Jets', (o, k) => k === 'jet' || k === 'heavy' || k === 'biz'], helis: ['Helicopters', (o, k) => k === 'heli'], mil: ['Military', (o) => !!(o.flags & 1)] };
const scratch = new C.Cartesian3();

function frame() {
  const sel = current(), info = currentInfo();
  if (!sel || !info) return exit('The contact left the feed.');
  const pos = sel.L.position(sel.key, scratch);
  if (!pos) return exit('The contact left the feed.');
  const now = performance.now(), dt = Math.min(0.2, (now - lastT) / 1000 || 0.016); lastT = now;
  const h = info.hdg || 0;
  if (hdgS == null) hdgS = h;
  const dh = wrap180(h - hdgS);
  hdgS += dh * Math.min(1, dt * 1.6);
  bank += (clamp(dh * 1.4, -28, 28) - bank) * Math.min(1, dt * 2);
  // Keep the eye above the real ground all the way down.
  const cg = C.Cartographic.fromCartesian(pos);
  const ground = scene.globe.getHeight(cg) ?? 0;
  cg.height = Math.max(cg.height, ground + 4) + 2.5;
  const eye = C.Cartesian3.fromRadians(cg.longitude, cg.latitude, cg.height, C.Ellipsoid.WGS84, scratch);
  const climb = Math.atan2(info.vr || 0, Math.max(30, info.spd || 60));
  camera.setView({ destination: eye, orientation: { heading: rad(hdgS + look.yaw), pitch: rad(look.pitch) + climb * 0.6, roll: rad(-bank) * (Math.abs(look.yaw) < 60 ? 1 : 0.2) } });
}

function pfd(info) {
  const [sv, su] = fmtSpeed(info.spd), [av, au] = fmtAlt(info.alt);
  const h = ((hdgS ?? info.hdg ?? 0) % 360 + 360) % 360;
  let ticks = '';
  for (let a = Math.floor((h - 40) / 5) * 5; a <= h + 40; a += 5) {
    const x = 500 + (a - h) * 9, m = ((a % 360) + 360) % 360;
    ticks += `<path d="M${x} ${m % 10 === 0 ? 86 : 91}V98"/>`;
    if (m % 30 === 0) ticks += `<text x="${x}" y="80" text-anchor="middle">${m % 90 === 0 ? 'NESW'[m / 90] : String(m / 10).padStart(2, '0')}</text>`;
  }
  const vs = (info.vr || 0) / 0.00508;
  return `<svg class="pfd" viewBox="0 0 1000 620" preserveAspectRatio="xMidYMid slice" fill="none" stroke="currentColor" stroke-width="1.3" font-family="Geist Mono, monospace" font-size="11">
    <g fill="currentColor" stroke="none">${ticks.replace(/<path[^>]*>/g, '')}</g><g>${ticks.replace(/<text[\s\S]*?<\/text>/g, '')}</g>
    <path d="M500 102l-6 10h12z" fill="currentColor" stroke="none"/>
    <g transform="rotate(${(-bank).toFixed(1)} 500 320)"><path d="M400 320h64M536 320h64" stroke-width="1.6"/><path d="M420 250h30M550 250h30M420 390h30M550 390h30" opacity=".5"/></g>
    <path d="M470 320h18l12 10 12-10h18" stroke-width="2"/><circle cx="500" cy="320" r="2.4" fill="currentColor" stroke="none"/>
    <g transform="translate(150 320)"><rect x="-58" y="-19" width="104" height="38" rx="4" fill="rgba(6,8,6,.55)"/><text x="-6" y="7" text-anchor="middle" font-size="22" font-weight="600" fill="currentColor" stroke="none">${sv}</text><text x="-6" y="-28" text-anchor="middle" fill="currentColor" stroke="none" opacity=".7">SPD ${su.toUpperCase()}</text></g>
    <g transform="translate(850 320)"><rect x="-58" y="-19" width="116" height="38" rx="4" fill="rgba(6,8,6,.55)"/><text x="0" y="7" text-anchor="middle" font-size="22" font-weight="600" fill="currentColor" stroke="none">${av}</text><text x="0" y="-28" text-anchor="middle" fill="currentColor" stroke="none" opacity=".7">ALT ${au.toUpperCase()}</text>
      <text x="0" y="40" text-anchor="middle" fill="currentColor" stroke="none" opacity=".85">${Math.abs(vs) < 80 ? 'LEVEL' : (vs > 0 ? '▲ ' : '▼ ') + Math.round(Math.abs(vs) / 50) * 50 + ' FPM'}</text></g>
    <text x="500" y="126" text-anchor="middle" font-size="15" font-weight="600" fill="currentColor" stroke="none">${String(Math.round(h) % 360).padStart(3, '0')}° ${compass(h)}</text>
  </svg>`;
}
function radar(info) {
  const cv = root.querySelector('.ck-radar canvas');
  if (!cv) return;
  const g = cv.getContext('2d'), s = 392;
  if (cv.width !== s) cv.width = cv.height = s;
  g.clearRect(0, 0, s, s);
  g.fillStyle = 'rgba(8,11,8,0.9)'; g.beginPath(); g.arc(196, 196, 196, 0, 7); g.fill();
  g.strokeStyle = 'rgba(200,245,90,0.25)'; g.lineWidth = 1.5;
  for (const r of [60, 120, 180]) { g.beginPath(); g.arc(196, 196, r, 0, 7); g.stroke(); }
  g.beginPath(); g.moveTo(196, 16); g.lineTo(196, 376); g.moveTo(16, 196); g.lineTo(376, 196); g.stroke();
  const sweep = (performance.now() / 2600) % 1 * Math.PI * 2;
  const grad = g.createConicGradient(sweep, 196, 196); grad.addColorStop(0, 'rgba(200,245,90,0.28)'); grad.addColorStop(0.12, 'rgba(200,245,90,0)'); grad.addColorStop(1, 'rgba(200,245,90,0)');
  g.save(); g.translate(196, 196); g.rotate(Math.PI); g.translate(-196, -196); g.fillStyle = grad; g.beginPath(); g.arc(196, 196, 180, 0, 7); g.fill(); g.restore();
  const near = aircraftNear(info.lat, info.lon, 250, FILTERS[filter][1]).filter((c) => c.key !== current()?.key);
  root._blips = [];
  for (const c of near.slice(0, 80)) {
    const b = rad(bearing(info.lat, info.lon, c.lat, c.lon) - (hdgS ?? 0)), r = (c.d / 250000) * 180;
    const x = 196 + Math.sin(b) * r, y = 196 - Math.cos(b) * r;
    g.fillStyle = c.color; g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill();
    root._blips.push({ x: x / 2, y: y / 2, c });
  }
  g.fillStyle = '#c8f55a'; g.beginPath(); g.moveTo(196, 184); g.lineTo(204, 204); g.lineTo(188, 204); g.fill();
  g.fillStyle = 'rgba(233,237,230,0.6)'; g.font = '500 17px "Geist Mono", monospace'; g.textAlign = 'center'; g.fillText('250 KM', 196, 368);
}
async function brief(info) {
  if (Date.now() - wxAt > 90000) { wxAt = Date.now(); weatherAt(info.lat, info.lon).then((w) => { wx = w; }).catch(() => {}); }
  const near = aircraftNear(info.lat, info.lon, 250).length - 1;
  const head = headlinesNear(info.lat, info.lon, 800, 1)[0];
  const b = root.querySelector('.ck-brief');
  b.innerHTML = `<span><i>OVER</i><b>${esc(regionName(info.lat, info.lon))}</b></span><span><i>NEARBY</i><b>${Math.max(0, near)}</b> aircraft</span>
    <span><i>WX</i>${wx ? `<b>${Math.round(wx.temperature_2m)}°</b> ${wmoText(wx.weather_code)} · wind ${fmtSpeed(wx.wind_speed_10m).join(' ')} ${compass(wx.wind_direction_10m)}` : 'reading'}</span>${head ? `<span style="max-width:300px;overflow:hidden;text-overflow:ellipsis"><i>NEWS</i>${esc(head.title.slice(0, 48))}</span>` : ''}`;
}
function drawUi() {
  const info = currentInfo();
  if (!info) return;
  root.querySelector('.pfd-wrap').innerHTML = pfd(info);
  root.querySelector('.ck-id').innerHTML = `${esc(info.title)}<small>${esc((info.sub || info.kind).slice(0, 38))}</small>`;
  radar(info); brief(info);
}

function enter() {
  const info = currentInfo(), sel = current();
  if (!sel || !info?.cockpit) return toast('Select an aircraft first, then enter the cockpit.');
  if (state.cockpit) return;
  stopTracking();
  saved = { pos: camera.positionWC.clone(), h: camera.heading, p: camera.pitch };
  viewer.trackedEntity = undefined;
  scene.screenSpaceCameraController.enableInputs = false;
  look = { yaw: 0, pitch: -7 }; hdgS = null; bank = 0; lastT = performance.now(); wx = null; wxAt = 0;
  root.hidden = false;
  root.innerHTML = `<div class="pfd-wrap"></div>
    <div class="ck-brief surface"></div>
    <div class="ck-bar surface">
      <button class="icon-btn" data-a="prev" data-tip="Previous contact" data-side="top">${icon('prev', 16)}</button>
      <div class="ck-id"></div>
      <button class="icon-btn" data-a="next" data-tip="Next contact" data-key="→" data-side="top">${icon('next', 16)}</button>
      <span class="sep" style="width:1px;height:26px;background:var(--line-2)"></span>
      <div class="seg">${Object.entries(FILTERS).map(([id, f]) => `<button data-f="${id}" aria-pressed="${id === filter}">${f[0]}</button>`).join('')}</div>
      <button class="btn sm" data-a="center" data-tip="Look straight ahead" data-side="top">Centre view</button>
      <button class="btn primary sm" data-a="exit">Exit cockpit</button>
    </div>
    <button class="ck-radar surface" aria-label="Contacts within 250 kilometres"><canvas></canvas></button>`;
  set('cockpit', true);
  document.body.classList.add('in-cockpit');
  tick = scene.preUpdate.addEventListener(frame);
  uiTimer = setInterval(drawUi, 90);
  drawUi();
  toast('Drag to look around. Arrow keys jump between nearby aircraft.');
}
function exit(msg) {
  if (!state.cockpit) return;
  tick?.(); tick = null; clearInterval(uiTimer);
  root.hidden = true; root.innerHTML = '';
  scene.screenSpaceCameraController.enableInputs = true;
  document.body.classList.remove('in-cockpit');
  set('cockpit', false);
  if (msg) toast(msg);
  const info = currentInfo();
  if (info) select(current().L.id, current().key, { track: true });
  else if (saved) camera.flyTo({ destination: saved.pos, orientation: { heading: saved.h, pitch: saved.p, roll: 0 }, duration: 1.2 });
}
export function jump(dir = 1, f = filter) {
  const info = currentInfo();
  if (!info) return null;
  filter = FILTERS[f] ? f : 'all';
  const list = aircraftNear(info.lat, info.lon, 250, FILTERS[filter][1]).filter((c) => c.key !== current().key && !c.ground);
  if (!list.length) { toast(`No ${filter === 'all' ? '' : FILTERS[filter][0].toLowerCase() + ' '}contacts within 250 km.`); return null; }
  const c = dir > 0 ? list[0] : list[Math.min(list.length - 1, 1)];
  hdgS = null;
  select(c.L, c.key, { fly: false });
  root.querySelectorAll('[data-f]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.f === filter));
  return c;
}

export function initCockpit() {
  root = document.getElementById('cockpit');
  on('cockpit:enter', enter);
  on('cockpit:exit', () => exit());
  on('selected', (s) => { if (state.cockpit && !s) exit(); });
  root.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a, f = e.target.closest('[data-f]')?.dataset.f;
    if (a === 'exit') exit();
    if (a === 'next') jump(1);
    if (a === 'prev') jump(-1);
    if (a === 'center') look = { yaw: 0, pitch: -7 };
    if (f) { filter = f; root.querySelectorAll('[data-f]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.f === f)); }
    const r = e.target.closest('.ck-radar');
    if (r && root._blips) {
      const box = r.getBoundingClientRect(), x = e.clientX - box.left, y = e.clientY - box.top;
      const hit = root._blips.map((b) => [Math.hypot(b.x - x, b.y - y), b.c]).sort((p, q) => p[0] - q[0])[0];
      if (hit && hit[0] < 14) { hdgS = null; select(hit[1].L, hit[1].key, { fly: false }); }
    }
  });
  // Look around by dragging anywhere on the globe.
  const cv = () => scene.canvas;
  addEventListener('pointerdown', (e) => { if (state.cockpit && e.target === cv()) drag = { x: e.clientX, y: e.clientY, yaw: look.yaw, pitch: look.pitch }; });
  addEventListener('pointermove', (e) => { if (drag && state.cockpit) { look.yaw = clamp(drag.yaw - (e.clientX - drag.x) * 0.22, -170, 170); look.pitch = clamp(drag.pitch + (e.clientY - drag.y) * 0.16, -80, 35); } });
  addEventListener('pointerup', () => { drag = null; });
  on('key', ({ k }) => { if (!state.cockpit) return; if (k === 'arrowright') jump(1); if (k === 'arrowleft') jump(-1); });
  void fmtDist; void emit;
}
