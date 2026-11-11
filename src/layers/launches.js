// Space missions: a rolling window of launches, with a scrubbable reconstructed ascent.
import { C, viewer, scene, lookAt } from '../core/viewer.js';
import { defineLayer } from './base.js';
import { PointSet } from './points.js';
import { getJSON } from '../core/net.js';
import { on, emit } from '../core/bus.js';
import { latlon, until, dest, deg, rad, esc, fmtSpeed } from '../core/geo.js';
import { el, ui, icon } from '../ui/dom.js';
import { glyph } from './glyphs.js';

const COLOR = '#f4f1e8';
let set = null, items = [];
const statusColor = (s) => (/success/i.test(s) ? '#5fdc93' : /fail/i.test(s) ? '#ff6257' : /go/i.test(s) ? '#c8f55a' : '#f4f1e8');

function shape(l, upcoming) {
  const pad = l.pad || {};
  return {
    key: l.id, lat: +pad.latitude, lon: +pad.longitude, name: l.name, net: Date.parse(l.net), upcoming,
    status: l.status?.name || 'Unknown', statusAbbrev: l.status?.abbrev || '', provider: l.launch_service_provider?.name || '', rocket: l.rocket?.configuration?.full_name || l.rocket?.configuration?.name || '',
    mission: l.mission?.name || '', desc: l.mission?.description || '', type: l.mission?.type || '', orbit: l.mission?.orbit?.name || '', orbitAbbrev: l.mission?.orbit?.abbrev || 'LEO',
    pad: pad.name || '', site: pad.location?.name || '', image: typeof l.image === 'string' ? l.image : l.image?.image_url || null, webcast: l.vidURLs?.[0]?.url || null,
    recovery: (l.rocket?.launcher_stage || []).map((s) => s.landing?.attempt ? `${s.landing.type?.name || 'Landing'} at ${s.landing.location?.name || 'TBD'}${s.landing.success === true ? ' (landed)' : s.landing.success === false ? ' (lost)' : ''}` : null).filter(Boolean),
    reused: (l.rocket?.launcher_stage || []).map((s) => (s.launcher_flight_number ? `${s.launcher?.serial_number || 'Booster'}, flight ${s.launcher_flight_number}` : null)).filter(Boolean),
  };
}

const L = defineLayer({
  id: 'launches', name: 'Space missions', group: 'Space', color: COLOR, icon: 'rocket', trust: 'live',
  blurb: 'Launches in a rolling 30-day window', source: 'Launch Library 2 (The Space Devs)', aliases: ['launches', 'launch', 'rockets', 'space missions', 'missions'],
  enable(L) {
    set = new PointSet('launches', { near: 1e5, nearScale: 1.3, far: 2.5e7, farScale: 0.72 });
    L.poll(async () => {
      const base = 'https://ll.thespacedevs.com/2.2.0/launch';
      const [up, prev] = await Promise.all([
        getJSON(`${base}/upcoming/?limit=25&mode=detailed`, { proxy: true, ttl: 2400, timeout: 40000 }),
        getJSON(`${base}/previous/?limit=25&mode=detailed`, { proxy: true, ttl: 2400, timeout: 40000 }).catch(() => ({ results: [] })),
      ]);
      const win = 30 * 864e5, t = Date.now();
      items = [...up.results.map((l) => shape(l, true)), ...prev.results.map((l) => shape(l, false))].filter((l) => Number.isFinite(l.lat) && Math.abs(l.net - t) < win);
      // Several launches share a pad: fan them out a little so each can be clicked.
      const seen = new Map();
      for (const l of items) { const k = l.lat.toFixed(2) + l.lon.toFixed(2); const n = seen.get(k) || 0; seen.set(k, n + 1); if (n) { const [la, lo] = dest(l.lat, l.lon, n * 67, 9000 + n * 2500); l.lat = la; l.lon = lo; } }
      set.set(items, (l) => ({ shape: 'rocket', color: l.upcoming ? COLOR : statusColor(l.status), size: l.upcoming && l.net - t < 864e5 ? 28 : 22, alpha: l.upcoming ? 1 : 0.8 }));
      L.setCount(items.length);
      const next = items.filter((l) => l.upcoming && l.net > t).sort((a, b) => a.net - b.net)[0];
      L.note = next ? `Next: ${next.name.split('|')[0].trim()} ${until(next.net)}` : '';
    }, 20 * 60000);
  },
  disable() { set?.destroy(); set = null; stopReplay(); },
  contacts: () => items.map((l) => ({ key: l.key, L: 'launches', label: l.name.split('|')[0].trim().slice(0, 20), lat: l.lat, lon: l.lon, alt: 0, color: COLOR, net: l.net, upcoming: l.upcoming })),
  position: (k, r) => set?.position(k, r) || null,
  all: () => items,
  info(k, brief) {
    const l = set?.get(k);
    if (!l) return null;
    const [vehicle, payload] = l.name.split('|').map((s) => s.trim());
    if (brief) return { title: payload || vehicle, kind: l.upcoming ? 'Upcoming launch' : 'Launch', sub: until(l.net) };
    const rows = [['Vehicle', esc(l.rocket || vehicle)], ['Provider', esc(l.provider)], ['Status', esc(l.status)], ['NET (UTC)', new Date(l.net).toISOString().replace('T', ' ').slice(0, 16)], ['Orbit', esc(l.orbit || 'Not published')], ['Pad', esc(`${l.pad}, ${l.site}`)]];
    if (l.reused.length) rows.push(['First stage', esc(l.reused.join('; '))]);
    if (l.recovery.length) rows.push(['Recovery', esc(l.recovery.join('; '))]);
    if (l.webcast) rows.push(['Webcast', `<a href="${esc(l.webcast)}" target="_blank" rel="noopener">Watch</a>`]);
    return {
      title: payload || vehicle, kind: l.upcoming ? 'Upcoming launch' : 'Past launch', sub: vehicle + (l.type ? ` · ${l.type}` : ''), color: l.upcoming ? COLOR : statusColor(l.status), range: 240000, pitch: -40, lat: l.lat, lon: l.lon, replay: true,
      photo: l.image ? { url: l.image, credit: l.provider } : null,
      stats: [[until(l.net).replace(/^T[+-]/, '').split(':').slice(0, 2).join(':'), l.net > Date.now() ? 'to go' : 'ago', l.net > Date.now() ? 'Countdown' : 'Since liftoff'], [l.statusAbbrev || '—', '', 'Status'], [l.orbitAbbrev || '—', '', 'Orbit']],
      rows, note: l.desc ? l.desc.slice(0, 260) + (l.desc.length > 260 ? '…' : '') : '',
    };
  },
});

/* ---------------------------------------------------- reconstructed ascent */
// No public feed carries ascent telemetry, so this is a physics-shaped estimate from the pad and the target orbit.
const INC = { SSO: 97.6, PO: 90, 'Polar': 90, GTO: 27, GEO: 27, MEO: 55, ISS: 51.64, LEO: 51.6, TLI: 28.5, HEO: 63.4, 'Sub': 30, SO: 30, LO: 28.5, L2: 28.5 };
const EVENTS = [[0, 'Liftoff'], [68, 'Max Q'], [148, 'Main engine cutoff'], [152, 'Stage separation'], [205, 'Fairing separation'], [520, 'Orbit insertion']];
let replay = null;
function buildTrajectory(l) {
  let inc = INC[l.orbitAbbrev] ?? 51.6;
  if (inc < Math.abs(l.lat)) inc = Math.abs(l.lat) + 0.5;
  let az = deg(Math.asin(Math.max(-1, Math.min(1, Math.cos(rad(inc)) / Math.cos(rad(l.lat))))));
  if (l.lon < -115 && l.lon > -125 && l.lat > 33 && l.lat < 36) az = 180 - az; // Vandenberg flies south
  const apo = inc > 90 ? 520000 : /GTO|GEO|TLI|HEO/.test(l.orbitAbbrev) ? 240000 : 210000;
  const T = 520, pts = [];
  for (let t = 0; t <= T + 900; t += 4) {
    let h, d;
    if (t <= T) { const u = t / T; h = apo * (1 - Math.pow(1 - u, 2.3)); d = 2.15e6 * Math.pow(u, 2.5); }
    else { h = apo; d = 2.15e6 + (t - T) * 7650; }
    const [la, lo] = dest(l.lat, l.lon, az, d);
    const v = t <= T ? 7780 * Math.pow(t / T, 1.55) : 7780;
    pts.push({ t, lat: la, lon: lo, alt: h, v, d, cart: C.Cartesian3.fromDegrees(lo, la, h) });
  }
  return { pts, T, az, inc };
}
function sample(tr, t) {
  const i = Math.max(0, Math.min(tr.pts.length - 2, Math.floor(t / 4)));
  const a = tr.pts[i], b = tr.pts[i + 1], f = Math.max(0, Math.min(1, (t - a.t) / 4));
  return { alt: a.alt + (b.alt - a.alt) * f, v: a.v + (b.v - a.v) * f, d: a.d + (b.d - a.d) * f, cart: C.Cartesian3.lerp(a.cart, b.cart, f, new C.Cartesian3()), i };
}
function stopReplay() {
  if (!replay) return;
  replay.off();
  viewer.entities.remove(replay.rocket); viewer.entities.remove(replay.past); viewer.entities.remove(replay.future);
  replay.bar.remove();
  replay = null;
}
on('launch:replay', (key) => {
  const l = set?.get(key);
  if (!l) return;
  stopReplay();
  const tr = buildTrajectory(l);
  const st = { t: -8, speed: 1, playing: true, last: performance.now() };
  const rocket = viewer.entities.add({ position: new C.CallbackPositionProperty(() => sample(tr, Math.max(0, st.t)).cart, false), billboard: { image: glyph('rocket', '#ffffff', 34), width: 30, height: 30, disableDepthTestDistance: Number.POSITIVE_INFINITY }, point: { pixelSize: 1, color: C.Color.TRANSPARENT } });
  const past = viewer.entities.add({ polyline: { positions: new C.CallbackProperty(() => { const s = sample(tr, Math.max(0, st.t)); return [...tr.pts.slice(0, s.i + 1).map((p) => p.cart), s.cart]; }, false), width: 3, arcType: C.ArcType.NONE, material: new C.PolylineGlowMaterialProperty({ color: C.Color.fromCssColorString('#ffb347'), glowPower: 0.22 }) } });
  const future = viewer.entities.add({ polyline: { positions: tr.pts.map((p) => p.cart), width: 1.4, arcType: C.ArcType.NONE, material: new C.PolylineDashMaterialProperty({ color: C.Color.WHITE.withAlpha(0.45), dashLength: 14 }) } });
  const bar = el(`<div class="caption surface" style="top:auto;bottom:76px;gap:14px;max-width:min(860px,94vw)">
    <button class="icon-btn" data-a="play" aria-label="Play or pause">${icon('pause', 16)}</button>
    <span class="mono" id="rt" style="min-width:74px">T-00:08</span>
    <input type="range" min="-8" max="${tr.T + 420}" step="1" value="-8" style="width:220px" aria-label="Scrub ascent">
    <span class="mono" id="rtel" style="min-width:250px;color:var(--text-2);font-size:12px"></span>
    <div class="seg">${[0.25, 1, 2, 4].map((s) => `<button data-s="${s}" aria-pressed="${s === 1}">${s}×</button>`).join('')}</div>
    <span class="tag est">Reconstructed estimate</span>
    <button class="icon-btn" data-a="x" aria-label="Close replay">${icon('x', 16)}</button></div>`);
  ui().appendChild(bar);
  const range = bar.querySelector('input');
  bar.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a, s = e.target.closest('[data-s]')?.dataset.s;
    if (a === 'x') stopReplay();
    if (a === 'play') { st.playing = !st.playing; if (st.t >= tr.T + 420) st.t = -8; e.target.closest('button').innerHTML = icon(st.playing ? 'pause' : 'play', 16); }
    if (s) { st.speed = +s; bar.querySelectorAll('[data-s]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.s === s)); }
  });
  range.addEventListener('input', () => { st.t = +range.value; });
  const off = scene.preUpdate.addEventListener(() => {
    const nowT = performance.now(), dt = (nowT - st.last) / 1000; st.last = nowT;
    if (st.playing) { st.t = Math.min(tr.T + 420, st.t + dt * st.speed * 6); if (st.t >= tr.T + 420) st.playing = false; }
    const t = Math.max(0, st.t), s = sample(tr, t);
    range.value = st.t; range.style.setProperty('--p', ((st.t + 8) / (tr.T + 428)) * 100 + '%');
    const mm = Math.floor(Math.abs(st.t) / 60), ss = Math.floor(Math.abs(st.t) % 60);
    bar.querySelector('#rt').textContent = `T${st.t < 0 ? '-' : '+'}${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    const ev = [...EVENTS].reverse().find((e) => t >= e[0]);
    const [sv, su] = fmtSpeed(s.v);
    bar.querySelector('#rtel').textContent = `${(s.alt / 1000).toFixed(0)} km · ${sv} ${su} · ${ev ? ev[1] : ''}`;
  });
  replay = { rocket, past, future, bar, off };
  lookAt({ lat: l.lat, lon: l.lon, range: 1.9e6, heading: tr.az - 70, pitch: -24, duration: 2.2 });
  emit('toast', { text: 'Replaying a reconstructed ascent. Timing runs at 6× so the climb fits in about a minute and a half.' });
});
on('selected', (s) => { if (replay && s?.L.id !== 'launches') stopReplay(); });
export default L;
