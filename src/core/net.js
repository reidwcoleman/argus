// Fetch helpers. `prox` routes a public URL through the local allowlisted proxy.
export const prox = (url, ttl = 60, bin = false) => `/api/p?u=${encodeURIComponent(url)}&ttl=${ttl}${bin ? '&b=1' : ''}`;
export async function getJSON(url, { timeout = 25000, proxy = false, ttl = 60, init } = {}) {
  const res = await fetch(proxy ? prox(url, ttl) : url, { signal: AbortSignal.timeout(timeout), ...init });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return res.json();
}
export async function getText(url, { timeout = 25000, proxy = false, ttl = 60 } = {}) {
  const res = await fetch(proxy ? prox(url, ttl) : url, { signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return res.text();
}
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
export async function overpass(query, ttl = 600) {
  let last;
  for (const base of OVERPASS) {
    try {
      const res = await fetch(prox(base, ttl), { method: 'POST', body: 'data=' + encodeURIComponent(query), signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) { last = e; }
  }
  throw last || new Error('Overpass unavailable');
}
export function explain(err) {
  if (!err) return 'Unknown error';
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'The source timed out';
  if (err.status === 429) return 'The source is rate-limiting; retrying soon';
  if (err.status >= 500 || err.status === 502) return 'The source is unreachable right now';
  return err.message || 'Could not load';
}
