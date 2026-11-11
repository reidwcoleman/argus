// Publishes the feeds a browser cannot fetch on its own (no CORS, or they need shaping) as static JSON,
// for the hosted build. It starts the normal Argus server, asks it for each feed, and writes the answers.
// A feed that fails keeps its previous file, so one bad upstream never blanks the hosted site.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] || 'snapshot');
const PORT = 4399;
const base = `http://127.0.0.1:${PORT}`;
const viaProxy = (u, ttl = 60) => `/api/p?u=${encodeURIComponent(u)}&ttl=${ttl}`;
const FEEDS = [
  ['flights.json', '/api/flights/global', 60000],
  ['mil.json', '/api/flights/mil', 30000],
  ['fires.json', '/api/fires', 90000],
  ['gnss.json', '/api/gnss', 90000],
  ['news.json', '/api/news', 120000],
  ['cameras.json', '/api/cameras', 120000],
  ['storms.json', viaProxy('https://www.nhc.noaa.gov/CurrentStorms.json'), 40000],
  ['cable-geo.json', viaProxy('https://www.submarinecablemap.com/api/v3/cable/cable-geo.json'), 90000],
  ['landing-point-geo.json', viaProxy('https://www.submarinecablemap.com/api/v3/landing-point/landing-point-geo.json'), 90000],
];

mkdirSync(OUT, { recursive: true });
const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: String(PORT), ARGUS_API_ONLY: '1' }, stdio: 'ignore' });
const stop = () => { try { server.kill(); } catch { /* already gone */ } };
process.on('exit', stop);

for (let i = 0; i < 40; i++) {
  try { await fetch(`${base}/api/cameras/keyed`, { signal: AbortSignal.timeout(1500) }); break; } catch { await new Promise((r) => setTimeout(r, 500)); }
}

const now = Date.now();
const metaFile = path.join(OUT, 'meta.json');
const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : { feeds: {} };
await Promise.all(FEEDS.map(async ([file, url, timeout]) => {
  try {
    const res = await fetch(base + url, { signal: AbortSignal.timeout(timeout) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (res.headers.get('x-argus-stale') === '1') throw new Error('upstream failed, only stale data');
    const data = await res.json();
    // GeoJSON and arrays are published untouched; row tables carry the time they were taken.
    const body = Array.isArray(data) || data.type === 'FeatureCollection' ? data : { ...data, snap: now };
    writeFileSync(path.join(OUT, file), JSON.stringify(body));
    meta.feeds[file] = { ok: true, at: now, bytes: JSON.stringify(body).length };
    console.log(`ok   ${file}`);
  } catch (e) {
    meta.feeds[file] = { ...(meta.feeds[file] || {}), ok: false, failedAt: now, why: String(e.message || e).slice(0, 120) };
    console.log(`FAIL ${file}: ${e.message}`);
  }
}));
meta.updated = now;
writeFileSync(metaFile, JSON.stringify(meta, null, 1));
stop();
process.exit(Object.values(meta.feeds).some((f) => f.ok && f.at === now) ? 0 : 1);
