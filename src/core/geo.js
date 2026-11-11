// Spherical math and formatting helpers.
import { state } from './bus.js';
export const R_EARTH = 6371008.8;
export const rad = (d) => (d * Math.PI) / 180;
export const deg = (r) => (r * 180) / Math.PI;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
export const wrap360 = (d) => ((d % 360) + 360) % 360;
export function angLerp(a, b, t) { return a + wrap180(b - a) * t; }
export const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function distM(lat1, lon1, lat2, lon2) {
  const p1 = rad(lat1), p2 = rad(lat2), dp = p2 - p1, dl = rad(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}
export function bearing(lat1, lon1, lat2, lon2) {
  const p1 = rad(lat1), p2 = rad(lat2), dl = rad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return wrap360(deg(Math.atan2(y, x)));
}
// Destination point: returns [lat, lon]
export function dest(lat, lon, brg, d) {
  const ad = d / R_EARTH, b = rad(brg), p1 = rad(lat), l1 = rad(lon);
  const sp = Math.sin(p1) * Math.cos(ad) + Math.cos(p1) * Math.sin(ad) * Math.cos(b);
  const p2 = Math.asin(clamp(sp, -1, 1));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(ad) * Math.cos(p1), Math.cos(ad) - Math.sin(p1) * sp);
  return [deg(p2), wrap180(deg(l2))];
}
export function greatCircle(lat1, lon1, lat2, lon2, n = 64) {
  const d = distM(lat1, lon1, lat2, lon2) / R_EARTH;
  if (d < 1e-9) return [[lat1, lon1], [lat2, lon2]];
  const p1 = rad(lat1), l1 = rad(lon1), p2 = rad(lat2), l2 = rad(lon2), out = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
    const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
    const z = A * Math.sin(p1) + B * Math.sin(p2);
    out.push([deg(Math.atan2(z, Math.hypot(x, y))), deg(Math.atan2(y, x))]);
  }
  return out;
}

/* formatting */
const pad = (n, w = 2) => String(n).padStart(w, '0');
export function dms(v, pos, neg) {
  const a = Math.abs(v), d = Math.floor(a), mf = (a - d) * 60, m = Math.floor(mf), s = Math.round((mf - m) * 60);
  return `${pad(d, pos === 'E' ? 3 : 2)}°${pad(m)}'${pad(Math.min(s, 59))}"${v >= 0 ? pos : neg}`;
}
export const latlon = (lat, lon) => `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(4)}°${lon >= 0 ? 'E' : 'W'}`;
export function fmtAlt(m) {
  if (m == null || !Number.isFinite(m)) return ['—', ''];
  if (state.units === 'metric') return m >= 10000 ? [(m / 1000).toFixed(1), 'km'] : [Math.round(m).toLocaleString(), 'm'];
  return [Math.round(m / 0.3048 / 25) * 25 === 0 ? '0' : (Math.round(m / 0.3048 / 25) * 25).toLocaleString(), 'ft'];
}
export function fmtSpeed(ms) {
  if (ms == null || !Number.isFinite(ms)) return ['—', ''];
  if (state.units === 'metric') return [Math.round(ms * 3.6).toLocaleString(), 'km/h'];
  if (state.units === 'imperial') return [Math.round(ms * 2.23694).toLocaleString(), 'mph'];
  return [Math.round(ms / 0.514444).toLocaleString(), 'kt'];
}
/** Distances read in km or miles; nautical miles only where pilots expect them (pass nautical = true). */
export function fmtDist(m, nautical = false) {
  if (!Number.isFinite(m)) return '—';
  if (state.units === 'metric' || (state.units === 'aviation' && !nautical)) return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 1e5 ? 1 : 0)} km`;
  if (state.units === 'imperial') { const mi = m / 1609.344; return mi < 0.2 ? `${Math.round(m / 0.3048)} ft` : `${mi.toFixed(mi < 100 ? 1 : 0)} mi`; }
  const nm = m / 1852; return nm < 0.2 ? `${Math.round(m)} m` : `${nm.toFixed(nm < 100 ? 1 : 0)} nm`;
}
export function fmtHeight(m) {
  if (m >= 1e6) return `${(m / 1e6).toFixed(2)} Mm`;
  if (m >= 1e4) return `${(m / 1000).toFixed(0)} km`;
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}
export function ago(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 5) return 'now';
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
export function until(ms) {
  let s = Math.round((ms - Date.now()) / 1000);
  const sign = s < 0 ? '+' : '-';
  s = Math.abs(s);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `T${sign}${d ? d + 'd ' : ''}${pad(h)}:${pad(m)}:${pad(sec)}`;
}
export const compass = (d) => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(wrap360(d) / 22.5) % 16];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
