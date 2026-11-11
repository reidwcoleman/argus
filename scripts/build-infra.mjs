// Builds compact point datasets (datacenters, dams) from OSM-derived GeoJSONL extracts.
// Input files are ODbL (c) OpenStreetMap contributors / Open Infrastructure Map.
import { readFileSync, writeFileSync } from 'node:fs';
const [,, kind, src, dst] = process.argv;
const out = [];
function centroid(g) {
  let pts = [];
  const walk = (c) => { if (typeof c[0] === 'number') pts.push(c); else c.forEach(walk); };
  walk(g.coordinates);
  let x = 0, y = 0; for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}
for (const line of readFileSync(src, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  let f; try { f = JSON.parse(line); } catch { continue; }
  if (!f.geometry) continue;
  const [lon, lat] = centroid(f.geometry);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  const t = f.properties?.tags || f.properties || {};
  const name = t.name || t['name:en'] || t.operator || '';
  const row = [Math.round(lat * 1e4) / 1e4, Math.round(lon * 1e4) / 1e4, name, t.operator || ''];
  if (kind === 'dams') row.push(t.height || '', t['generator:output:electricity'] || t['plant:output:electricity'] || '', t.waterway || '');
  else row.push(t.ref || '', t.capacity || t['rating'] || '');
  out.push(row);
}
writeFileSync(dst, JSON.stringify({ attribution: '(c) OpenStreetMap contributors, ODbL 1.0; Open Infrastructure Map', rows: out }));
console.log(kind, out.length, 'rows ->', dst);
