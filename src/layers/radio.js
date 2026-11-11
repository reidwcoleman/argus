// World radio with an analog tuner: drag the needle and the globe flies to whoever is broadcasting.
import { defineLayer, setLayer, registry } from './base.js';
import { PointSet } from './points.js';
import { getJSON } from '../core/net.js';
import { on, emit, state } from '../core/bus.js';
import { lookAt, camInfo } from '../core/viewer.js';
import { latlon, distM, fmtDist, esc } from '../core/geo.js';
import { select } from '../core/select.js';
import { registerPanel } from '../ui/shell.js';
import { el, $, icon, toast } from '../ui/dom.js';

const COLOR = '#ff8ad8';
let set = null, stations = [], audio = null, now = null, playing = false;
const HOSTS = ['de1.api.radio-browser.info', 'all.api.radio-browser.info'];

async function load() {
  if (stations.length) return stations;
  let last;
  for (const h of HOSTS) {
    try {
      const d = await getJSON(`https://${h}/json/stations/search?limit=750&has_geo_info=true&hidebroken=true&order=clickcount&reverse=true`, { timeout: 30000 });
      stations = d.filter((s) => s.geo_lat != null && s.geo_long != null && (s.url_resolved || s.url)).map((s) => ({ key: s.stationuuid, lat: +s.geo_lat, lon: +s.geo_long, name: s.name.trim().slice(0, 60), url: s.url_resolved || s.url, country: s.country, cc: s.countrycode, state: s.state, tags: (s.tags || '').split(',').filter(Boolean).slice(0, 4), codec: s.codec, bitrate: s.bitrate, home: s.homepage }));
      // West to east, so sweeping the dial sweeps the planet.
      stations.sort((a, b) => a.lon - b.lon);
      return stations;
    } catch (e) { last = e; }
  }
  throw last;
}

const L = defineLayer({
  id: 'radio', name: 'World radio', group: 'Audio', color: COLOR, icon: 'tower', trust: 'live',
  blurb: '750 geolocated stations, playable', source: 'Radio Browser', aliases: ['radio', 'radio stations', 'stations'],
  async enable(L) {
    set = new PointSet('radio', { near: 2e5, nearScale: 1.4, far: 2e7, farScale: 0.7 });
    await load();
    set.set(stations, () => ({ color: COLOR, size: 5.5, alpha: 0.95 }));
    L.setCount(stations.length);
  },
  disable() { set?.destroy(); set = null; },
  contacts: () => (set && camInfo().range < 3e6 ? [...set.values()].map((s) => ({ key: s.key, L: 'radio', label: s.name.slice(0, 18), lat: s.lat, lon: s.lon, alt: 0, color: COLOR })) : []),
  position: (k, r) => set?.position(k, r) || null,
  info(k, brief) {
    const s = set?.get(k);
    if (!s) return null;
    if (brief) return { title: s.name, kind: 'Radio station', sub: s.country };
    return {
      title: s.name, kind: now?.key === k && playing ? 'On air now' : 'Radio station', sub: [s.state, s.country].filter(Boolean).join(', '), color: COLOR, range: 90000, pitch: -45, lat: s.lat, lon: s.lon, radio: true,
      stats: [[s.bitrate || '—', s.bitrate ? 'kbps' : '', 'Bitrate'], [s.codec || '—', '', 'Codec'], [s.cc || '—', '', 'Country']],
      rows: [['Genres', s.tags.length ? esc(s.tags.join(', ')) : 'Not tagged'], ['Position', latlon(s.lat, s.lon)], ...(s.home ? [['Website', `<a href="${esc(s.home)}" target="_blank" rel="noopener">Open</a>`]] : [])],
    };
  },
});

export function tune(st, { fly = true } = {}) {
  if (!st) return;
  if (!audio) {
    audio = new Audio();
    audio.preload = 'none';
    audio.addEventListener('playing', () => { playing = true; emit('radio'); });
    audio.addEventListener('pause', () => { playing = false; emit('radio'); });
    audio.addEventListener('error', () => { if (now) { playing = false; emit('radio'); toast(`${now.name} is not answering. Try the next station.`, 'err'); } });
  }
  now = st;
  audio.src = st.url;
  audio.play().catch(() => {});
  emit('radio');
  if (fly) lookAt({ lat: st.lat, lon: st.lon, range: 260000, pitch: -50, duration: 1.6 });
  if (registry.get('radio').enabled) select('radio', st.key, { fly: false });
}
export function stopRadio() { audio?.pause(); playing = false; emit('radio'); }
export const radioState = () => ({ now, playing });
export async function radioNear(lat, lon, tag) {
  await load();
  let list = stations;
  if (tag) { const t = tag.toLowerCase(); const f = list.filter((s) => s.tags.some((x) => x.includes(t)) || s.name.toLowerCase().includes(t)); if (f.length) list = f; }
  return [...list].sort((a, b) => distM(lat, lon, a.lat, a.lon) - distM(lat, lon, b.lat, b.lon));
}
on('radio:play', (key) => { const s = stations.find((x) => x.key === key); if (s) (now?.key === key && playing ? stopRadio() : tune(s, { fly: false })); });

registerPanel({
  id: 'radio', title: 'Radio', icon: 'radio',
  badge: () => (playing ? '♪' : ''),
  render(body, { sub }) {
    body.innerHTML = '<div class="skel"></div><div class="skel"></div>';
    let idx = 0, offset = 0, drag = null, settle = null, dead = false;
    const offs = [];
    (async () => {
      try { await load(); } catch { body.innerHTML = `<div class="empty">${icon('tower', 28)}<b>The station directory is not answering</b>Radio Browser is a volunteer network. Try again in a minute.<button class="btn" id="retry">Try again</button></div>`; $('#retry', body).onclick = () => emit('state:panel'); return; }
      if (dead) return;
      if (!L.enabled) setLayer('radio', true);
      const c = camInfo();
      idx = now ? stations.indexOf(now) : stations.reduce((b, s, i) => (distM(c.clat, c.clon, s.lat, s.lon) < distM(c.clat, c.clon, stations[b].lat, stations[b].lon) ? i : b), 0);
      offset = idx;
      body.innerHTML = `<div class="tuner">
          <div class="tuner-now"><div class="n"></div><button class="play" aria-label="Play or pause">${icon('play', 18)}</button><div class="p"></div></div>
          <div class="dial" role="slider" aria-label="Tuner" tabindex="0"><canvas></canvas><i class="needle"></i></div>
          <div class="legend-l"><span>West</span><span class="mono" id="pos"></span><span>East</span></div>
        </div>
        <p class="note">Drag the dial, or use the arrow keys. Stations run west to east, so the needle sweeps the planet.</p>
        <section class="group"><div class="group-head"><span class="eyebrow">Closest to this view</span></div><div id="near"></div></section>`;
      const dial = $('.dial', body), cv = $('canvas', dial), g = cv.getContext('2d');
      const STEP = 13;
      const paint = () => {
        const w = dial.clientWidth, h = dial.clientHeight, dpr = devicePixelRatio || 1;
        if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, w, h);
        const span = Math.ceil(w / STEP / 2) + 2;
        const base = Math.round(offset);
        g.font = '500 9px "Geist Mono", monospace';
        g.textAlign = 'center';
        for (let i = base - span; i <= base + span; i++) {
          if (i < 0 || i >= stations.length) continue;
          const x = w / 2 + (i - offset) * STEP;
          const near = Math.max(0, 1 - Math.abs(i - offset) / 6);
          const major = i % 10 === 0;
          g.fillStyle = `rgba(233,237,230,${0.16 + near * 0.6})`;
          g.fillRect(x - 0.5, h - (major ? 26 : 14) - near * 8, 1, (major ? 26 : 14) + near * 8);
          if (major) { g.fillStyle = 'rgba(162,170,158,0.75)'; g.fillText(stations[i].cc || '', x, 14); }
        }
      };
      const show = () => {
        const s = stations[idx];
        $('.tuner-now .n', body).textContent = s.name;
        $('.tuner-now .p', body).innerHTML = `${esc([s.state, s.country].filter(Boolean).join(', '))} ${now?.key === s.key && playing ? '<span class="eq"><i></i><i></i><i></i></span>' : ''}`;
        $('.play', body).innerHTML = icon(now?.key === s.key && playing ? 'pause' : 'play', 18);
        $('#pos', body).textContent = `${idx + 1} / ${stations.length}`;
        sub.textContent = playing ? 'On air' : '';
        const cc = camInfo();
        $('#near', body).innerHTML = [...stations].sort((a, b) => distM(cc.clat, cc.clon, a.lat, a.lon) - distM(cc.clat, cc.clon, b.lat, b.lon)).slice(0, 7).map((x) => `<button class="item" data-st="${x.key}"><span class="t">${esc(x.name)}</span><span class="r">${fmtDist(distM(cc.clat, cc.clon, x.lat, x.lon))}</span><span class="d">${esc(x.country)}${x.tags[0] ? ' · ' + esc(x.tags[0]) : ''}</span></button>`).join('');
      };
      const go = (i, flyNow = true) => {
        idx = Math.max(0, Math.min(stations.length - 1, i));
        offset = idx; paint(); show();
        clearTimeout(settle);
        settle = setTimeout(() => tune(stations[idx], { fly: flyNow }), 260);
      };
      dial.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, o: offset }; dial.setPointerCapture(e.pointerId); });
      dial.addEventListener('pointermove', (e) => {
        if (!drag) return;
        offset = Math.max(0, Math.min(stations.length - 1, drag.o - (e.clientX - drag.x) / STEP));
        const i = Math.round(offset);
        if (i !== idx) { idx = i; show(); }
        paint();
      });
      const end = () => { if (drag) { drag = null; go(Math.round(offset)); } };
      dial.addEventListener('pointerup', end); dial.addEventListener('pointercancel', end);
      dial.addEventListener('wheel', (e) => { e.preventDefault(); go(idx + (e.deltaY + e.deltaX > 0 ? 1 : -1)); }, { passive: false });
      dial.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') go(idx + 1); if (e.key === 'ArrowLeft') go(idx - 1); });
      $('.play', body).onclick = () => { const s = stations[idx]; if (now?.key === s.key && playing) stopRadio(); else tune(s); };
      body.addEventListener('click', (e) => { const b = e.target.closest('[data-st]'); if (b) go(stations.findIndex((s) => s.key === b.dataset.st)); });
      offs.push(on('radio', () => { if (now) { const i = stations.indexOf(now); if (i >= 0 && i !== idx && !drag) { idx = i; offset = i; paint(); } } show(); }), on('camera:end', show));
      paint(); show();
    })();
    return () => { dead = true; clearTimeout(settle); offs.forEach((f) => f()); };
  },
});
void state;
