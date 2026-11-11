// Inspector: the contact card for whatever is selected, plus the 250 km roster.
import { el, $, ui, icon } from './dom.js';
import { on, state, emit } from '../core/bus.js';
import { current, currentInfo, deselect, startTracking, stopTracking, select, focus } from '../core/select.js';
import { esc, fmtDist, fmtAlt } from '../core/geo.js';
import { aircraftNear } from '../layers/flights.js';

let box = null, timer = null, photoUrl = null, rosterOpen = false;

export function initCard() {
  on('selected', draw);
  on('state:tracking', refresh);
  on('state:units', refresh);
}
function draw() {
  clearInterval(timer);
  box?.remove(); box = null; photoUrl = null;
  const sel = current();
  if (!sel) return;
  box = el(`<aside class="inspector surface" aria-label="Selected contact">
    <div class="card-head"></div><div class="card-photo" hidden></div><div class="stats"></div><dl class="kv"></dl><p class="card-note" hidden></p>
    <div class="card-actions"></div><div class="roster" hidden></div></aside>`);
  ui().appendChild(box);
  box.addEventListener('click', onClick);
  rosterOpen = sel.L.id === 'flights' || sel.L.id === 'military';
  refresh();
  timer = setInterval(refresh, 600);
}
function onClick(e) {
  const a = e.target.closest('[data-act]');
  if (a) {
    const act = a.dataset.act;
    if (act === 'close') deselect();
    else if (act === 'track') (state.tracking ? stopTracking() : startTracking());
    else if (act === 'focus') focus();
    else if (act === 'cockpit') emit('cockpit:enter');
    else if (act === 'nearest') emit('camera:nearest', currentInfo());
    else if (act === 'passes') emit('sat:passes', currentInfo());
    else if (act === 'replay') emit('launch:replay', current().key);
    else if (act === 'play') emit('radio:play', current().key);
    else if (act === 'view') emit('camera:view', current().key);
    else if (act === 'open') window.open(a.dataset.url, '_blank', 'noopener');
    refresh();
    return;
  }
  const c = e.target.closest('[data-contact]');
  if (c) { const [l, k] = c.dataset.contact.split('|'); select(l, k, { track: true }); }
}
function refresh() {
  const sel = current();
  if (!box || !sel) return;
  const info = sel.L.info?.(sel.key);
  if (!info) return;
  box.style.setProperty('--c', info.color || 'var(--text-3)');
  $('.card-head', box).innerHTML = `<div class="card-kind"><i class="dot"></i>${esc(info.kind)}</div><button class="icon-btn" data-act="close" aria-label="Close" data-tip="Deselect" data-key="Esc">${icon('x', 16)}</button><div class="card-title">${esc(info.title)}</div><div class="card-sub">${esc(info.sub || '')}</div>`;
  const ph = $('.card-photo', box);
  const p = info.photo;
  if (p && (p.thumb || p.url) !== photoUrl) {
    photoUrl = p.thumb || p.url;
    ph.hidden = false;
    ph.innerHTML = p.video ? `<video src="${esc(p.video)}" autoplay muted loop playsinline poster="${esc(p.url)}"></video>` : `<img src="${esc(p.thumb || p.url)}" alt="" loading="lazy">`;
    ph.insertAdjacentHTML('beforeend', `<div class="cap"><span>${p.live ? '<span class="rec">LIVE</span>' : ''}</span><span>${esc(p.credit || '')}</span></div>`);
    const img = ph.querySelector('img');
    if (img) img.onerror = () => { ph.hidden = true; };
  } else if (!p) { ph.hidden = true; photoUrl = null; }
  $('.stats', box).innerHTML = (info.stats || []).map(([v, u, l]) => `<div class="stat"><div class="v">${esc(v)}${u ? `<small>${esc(u)}</small>` : ''}</div><div class="l">${esc(l)}</div></div>`).join('');
  $('.stats', box).hidden = !info.stats?.length;
  $('.kv', box).innerHTML = (info.rows || []).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('');
  const note = $('.card-note', box);
  note.hidden = !info.note; note.textContent = info.note || '';
  const acts = [];
  if (info.moving) acts.push(`<button class="btn primary" data-act="track">${icon(state.tracking ? 'x' : 'lock', 15)}${state.tracking ? 'Release lock' : 'Track'}</button>`);
  else acts.push(`<button class="btn primary" data-act="focus">${icon('crosshair', 15)}Fly here</button>`);
  if (info.cockpit) acts.push(`<button class="btn" data-act="cockpit">${icon('cockpit', 15)}Cockpit</button>`);
  if (info.sat) acts.push(`<button class="btn" data-act="passes">${icon('history', 15)}Next pass</button>`);
  if (info.replay) acts.push(`<button class="btn" data-act="replay">${icon('play', 15)}Replay ascent</button>`);
  if (info.radio) acts.push(`<button class="btn" data-act="play">${icon('play', 15)}Tune in</button>`);
  if (info.viewer) acts.push(`<button class="btn" data-act="view">${icon('expand', 15)}Open feed</button>`);
  if (info.nearestCam) acts.push(`<button class="btn" data-act="nearest">${icon('cctv', 15)}Nearest camera</button>`);
  if (info.link) acts.push(`<button class="btn" data-act="open" data-url="${esc(info.link)}">${icon('external', 15)}${esc(info.linkLabel || 'Source')}</button>`);
  const html = acts.join('');
  const ac = $('.card-actions', box);
  if (ac.dataset.h !== html) { ac.innerHTML = html; ac.dataset.h = html; }
  // Contacts roster: everything flying within 250 km of an aircraft target.
  const ros = $('.roster', box);
  if (rosterOpen && info.lat != null) {
    const near = aircraftNear(info.lat, info.lon, 250).filter((c) => c.key !== sel.key).slice(0, 40);
    ros.hidden = !near.length;
    ros.innerHTML = `<div class="roster-head"><span class="eyebrow">Contacts within 250 km</span><span class="eyebrow">${near.length}</span></div>` + near.map((c) => `<button class="contact" data-contact="${c.L}|${c.key}" style="--c:${c.color}"><i class="dot"></i><span class="id">${esc(c.label)}<span class="ty">${esc(c.type || '')}</span></span><span class="d">${c.ground ? 'GND' : fmtAlt(c.alt).join(' ')}</span><span class="d">${fmtDist(c.d)}</span></button>`).join('');
  } else ros.hidden = true;
}
