// Tactical HUD: reticle, heading tape, grid reference and a terse read of the scene.
import { forward as toMgrs } from 'mgrs';
import { camInfo } from '../core/viewer.js';
import { state, on } from '../core/bus.js';
import { enabledLayers } from '../layers/base.js';
import { dms, fmtHeight, compass, distM } from '../core/geo.js';
import { CITIES } from '../data/places.js';
import { inView } from './detect.js';
import { STYLES } from './styles.js';

let root, timer = null, tapeTimer = null;

export function regionName(lat, lon) {
  let best = null, bd = 450000;
  for (const c of CITIES) { if (Math.abs(c.lat - lat) > 5) continue; const d = distM(lat, lon, c.lat, c.lon); if (d < bd) { bd = d; best = c; } }
  if (best) return bd < 60000 ? best.name : `${best.name} region`;
  if (lat > 66) return 'Arctic'; if (lat < -60) return 'Southern Ocean';
  if (lon > -70 && lon < 20 && lat > 0) return lon < -10 || lat < 35 ? 'North Atlantic' : 'Europe';
  if (lon > -70 && lon < 20) return lon > 8 && lat > -35 ? 'Central Africa' : 'South Atlantic';
  if (lon >= 20 && lon < 120 && lat < 25 && lat > -45) return lon < 52 && lat > -35 ? 'East Africa' : 'Indian Ocean';
  if (lon >= 20 && lon < 150 && lat >= 25) return 'Central Asia';
  if (lon <= -70 && lon > -130 && lat > 15) return 'North America';
  if (lon <= -34 && lon > -82 && lat <= 15) return 'South America';
  return lat > 0 ? 'North Pacific' : 'South Pacific';
}
/** A five-word-ish read of what is on screen, built from the live layers (no model involved). */
export function sceneSummary() {
  const c = camInfo();
  if (!c.onGlobe) return 'DEEP SPACE VIEW';
  const where = regionName(c.clat, c.clon).toUpperCase();
  const fl = inView('flights').length + inView('military').length, mil = inView('military').length, ships = inView('vessels').length, fires = inView('fires').length;
  const quakes = inView('earthquakes'), big = quakes.filter((q) => q.mag >= 5).length;
  if (inView('military').some((x) => x.tag === 'EMERG') || inView('flights').some((x) => x.tag === 'EMERG')) return `EMERGENCY SQUAWK · ${where}`;
  if (big) return `M5+ SEISMIC EVENT · ${where}`;
  if (fires > 400) return `WIDESPREAD FIRE ACTIVITY · ${where}`;
  if (mil > 12) return `${mil} MILITARY TRACKS · ${where}`;
  if (fl > 600) return `DENSE AIR TRAFFIC · ${where}`;
  if (ships > 150) return `BUSY SEA LANES · ${where}`;
  if (fl > 40) return `${fl} AIRCRAFT TRACKED · ${where}`;
  if (fires > 30) return `${fires} HEAT DETECTIONS · ${where}`;
  if (fl + ships > 0) return `${fl + ships} CONTACTS · ${where}`;
  return enabledLayers().length ? `QUIET SECTOR · ${where}` : `NO FEEDS · ${where}`;
}
function sun(lat, lon) {
  const d = new Date(), n = d.getTime() / 86400000 + 2440587.5 - 2451545, r = Math.PI / 180;
  const Ls = (280.46 + 0.9856474 * n) % 360, gg = ((357.528 + 0.9856003 * n) % 360) * r;
  const lam = (Ls + 1.915 * Math.sin(gg) + 0.02 * Math.sin(2 * gg)) * r, eps = 23.439 * r;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam)), ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24, ha = ((gmst * 15 + lon) * r - ra);
  const el = Math.asin(Math.sin(lat * r) * Math.sin(dec) + Math.cos(lat * r) * Math.cos(dec) * Math.cos(ha));
  return el / r;
}
function build() {
  root.innerHTML = `
    <svg viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid meet" fill="none" stroke="currentColor" stroke-width="1.2" style="opacity:.9">
      <circle cx="500" cy="500" r="3" fill="currentColor" stroke="none"/>
      <path d="M500 440v40M500 520v40M440 500h40M520 500h40"/>
      <circle cx="500" cy="500" r="74" stroke-dasharray="2 9" opacity=".65"/>
      <path d="M430 430h-16v16M570 430h16v16M430 570h-16v-16M570 570h16v-16" opacity=".8"/>
    </svg>
    <svg class="tape" style="inset:auto;left:50%;top:92px;width:520px;height:34px;margin-left:-260px" viewBox="0 0 520 34" fill="none" stroke="currentColor" stroke-width="1"><g id="hud-tape"></g><path d="M260 22l-5 9h10z" fill="currentColor" stroke="none"/></svg>
    <div class="hud-txt hud-sum" id="hud-sum"></div>
    <div class="hud-txt hud-tl" id="hud-tl"></div><div class="hud-txt hud-tr" id="hud-tr"></div>
    <div class="hud-txt hud-bl" id="hud-bl"></div><div class="hud-txt hud-br" id="hud-br"></div>
    <div class="hud-txt hud-c" id="hud-c"></div>`;
}
function tape() {
  const h = camInfo().heading, gEl = root.querySelector('#hud-tape');
  if (!gEl) return;
  let s = '';
  const start = Math.floor((h - 45) / 5) * 5;
  for (let a = start; a <= h + 45; a += 5) {
    const x = 260 + (a - h) * 5.6, m = ((a % 360) + 360) % 360, major = m % 15 === 0;
    s += `<path d="M${x.toFixed(1)} ${major ? 12 : 16}V22" opacity="${major ? 1 : 0.5}"/>`;
    if (m % 45 === 0) s += `<text x="${x.toFixed(1)}" y="8" fill="currentColor" stroke="none" font-size="9.5" font-family="Geist Mono, monospace" text-anchor="middle">${m % 90 === 0 ? 'NESW'[m / 90] : String(m).padStart(3, '0')}</text>`;
  }
  gEl.innerHTML = s;
}
function text() {
  const c = camInfo(), $ = (id) => root.querySelector(id);
  if (!$('#hud-tl')) return;
  const style = STYLES.find((s) => s.id === state.style)?.name.toUpperCase();
  $('#hud-tl').innerHTML = `<span class="big">ARGUS // OPEN SOURCE</span><br><span class="dim">PUBLIC DATA · UNCLASSIFIED</span><br><span class="hud-rec">${new Date().toISOString().slice(0, 19).replace('T', ' ')}Z</span><br>OPTIC ${style}${state.detect ? ' · DETECT ' + Math.round(state.density * 100) + '%' : ''}`;
  const ls = enabledLayers().filter((l) => l.count).slice(0, 7);
  $('#hud-tr').innerHTML = `<span class="dim">ACTIVE FEEDS ${enabledLayers().length}</span><br>` + ls.map((l) => `${l.name.toUpperCase()} <span class="big">${l.count.toLocaleString()}</span>`).join('<br>');
  let grid = '—';
  if (c.onGlobe && Math.abs(c.clat) < 80) { try { grid = toMgrs([c.clon, c.clat], 4).replace(/^(\d{1,2}[A-Z])([A-Z]{2})(\d{4})(\d{4})$/, '$1 $2 $3 $4'); } catch { grid = '—'; } }
  $('#hud-bl').innerHTML = c.onGlobe ? `<span class="dim">MGRS</span> <span class="big">${grid}</span><br>${dms(c.clat, 'N', 'S')} ${dms(c.clon, 'E', 'W')}<br><span class="dim">EYE</span> ${fmtHeight(c.height).toUpperCase()} <span class="dim">RNG</span> ${fmtHeight(c.range).toUpperCase()}` : `<span class="dim">EYE</span> ${fmtHeight(c.height).toUpperCase()}`;
  const el = c.onGlobe ? sun(c.clat, c.clon) : 0;
  $('#hud-br').innerHTML = `<span class="dim">HDG</span> <span class="big">${String(Math.round(c.heading) % 360).padStart(3, '0')}° ${compass(c.heading)}</span><br><span class="dim">TILT</span> ${Math.round(90 + c.pitch)}°<br><span class="dim">SUN</span> ${el >= 0 ? '+' : ''}${el.toFixed(0)}° ${el > 0 ? 'DAY' : el > -6 ? 'TWILIGHT' : 'NIGHT'}`;
  $('#hud-sum').textContent = sceneSummary();
  $('#hud-c').innerHTML = state.selected ? '' : '<span class="dim">CLICK A CONTACT TO LOCK</span>';
}
function sync() {
  clearInterval(timer); clearInterval(tapeTimer);
  root.classList.toggle('on', state.hud);
  if (!state.hud) return;
  if (!root.firstChild) build();
  text(); tape();
  timer = setInterval(text, 500);
  tapeTimer = setInterval(tape, 80);
}
export function initHud() {
  root = document.getElementById('hud');
  on('state:hud', sync);
  on('state:style', () => state.hud && text());
  sync();
}
