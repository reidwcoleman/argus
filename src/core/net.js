// Fetch helpers. Locally, `prox` routes a public URL through the allowlisted proxy in server.mjs.
// On the hosted (static) build there is no server: feeds that need one are read from a data snapshot
// that a scheduled job publishes, and everything else is fetched straight from its source.
const ENV = import.meta.env || {};
export const BASE = ENV.BASE_URL || '/';
export const HOSTED = ENV.VITE_HOSTED === '1';
const DATA = ENV.VITE_DATA_URL || '';
/** Path to a bundled file (models, data), correct under any base path. */
export const asset = (p) => BASE + p.replace(/^\//, '');
const SNAPSHOT = {
  '/api/flights/global': 'flights.json', '/api/flights/mil': 'mil.json', '/api/fires': 'fires.json', '/api/gnss': 'gnss.json',
  '/api/news': 'news.json', '/api/cameras': 'cameras.json',
  'https://www.nhc.noaa.gov/CurrentStorms.json': 'storms.json',
  'https://www.submarinecablemap.com/api/v3/cable/cable-geo.json': 'cable-geo.json',
  'https://www.submarinecablemap.com/api/v3/landing-point/landing-point-geo.json': 'landing-point-geo.json',
};
export const localOnly = () => Object.assign(new Error('This feed needs the Argus app running on your own machine'), { name: 'LocalOnly' });
/** Where a request really goes. Returns null when the hosted build cannot serve it at all. */
function route(url, proxy, ttl, bin) {
  if (!HOSTED) return proxy ? `/api/p?u=${encodeURIComponent(url)}&ttl=${ttl}${bin ? '&b=1' : ''}` : url;
  const snap = SNAPSHOT[url.split('?')[0]];
  if (snap) return DATA + snap;
  if (url.startsWith('/api/')) return null;
  return url.startsWith('/') ? asset(url) : url;
}
export const prox = (url, ttl = 60, bin = false) => route(url, true, ttl, bin) || url;
async function request(url, { timeout, proxy, ttl, init }) {
  const target = route(url, proxy, ttl, false);
  if (!target) throw localOnly();
  let res;
  try { res = await fetch(target, { signal: AbortSignal.timeout(timeout), ...init }); }
  catch (e) { if (HOSTED && proxy && e.name === 'TypeError') throw localOnly(); throw e; } // blocked by the source's CORS policy
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return res;
}
export async function getJSON(url, { timeout = 25000, proxy = false, ttl = 60, init } = {}) {
  return (await request(url, { timeout, proxy, ttl, init })).json();
}
export async function getText(url, { timeout = 25000, proxy = false, ttl = 60 } = {}) {
  return (await request(url, { timeout, proxy, ttl })).text();
}
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
export async function overpass(query, ttl = 600) {
  // The public servers are often busy, so ask all of them at once and take the first good answer.
  const one = async (base) => {
    const res = await fetch(prox(base, ttl), { method: 'POST', body: 'data=' + encodeURIComponent(query), signal: AbortSignal.timeout(22000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    if (!Array.isArray(d.elements)) throw new Error('bad payload');
    return d;
  };
  try { return await Promise.any(OVERPASS.map(one)); }
  catch { const e = new Error('Overpass timed out'); e.name = 'TimeoutError'; throw e; }
}
export function explain(err) {
  if (!err) return 'Unknown error';
  if (err.name === 'LocalOnly') return 'Needs the Argus app running locally (see the project page)';
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'The source timed out';
  if (err.status === 429) return 'The source is rate-limiting; retrying soon';
  if (err.status >= 500 || err.status === 502) return 'The source is unreachable right now';
  return err.message || 'Could not load';
}
