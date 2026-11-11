// Place lookup: coordinates and bundled places first (no network), then Photon, then Nominatim.
import { parseCoords, searchPlaces } from '../data/places.js';
import { getJSON } from './net.js';
import { camInfo } from './viewer.js';

const cache = new Map();
function rangeFor(extent, type) {
  if (extent) { const w = Math.abs(extent[2] - extent[0]) * 111000, h = Math.abs(extent[1] - extent[3]) * 111000; return Math.max(800, Math.min(6e6, Math.max(w, h) * 1.6)); }
  return { country: 2.5e6, state: 9e5, city: 60000, town: 25000, district: 12000, street: 1500, house: 600 }[type] || 30000;
}
export async function remoteSearch(q, limit = 5) {
  const key = q.toLowerCase().trim();
  if (cache.has(key)) return cache.get(key);
  let out = [];
  try {
    const c = camInfo();
    const d = await getJSON(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=${limit}&lang=en${c.onGlobe && c.range < 3e6 ? `&lat=${c.clat.toFixed(3)}&lon=${c.clon.toFixed(3)}` : ''}`, { timeout: 8000 });
    out = (d.features || []).map((f) => { const p = f.properties; return { name: p.name || p.street || q, where: [p.city !== p.name ? p.city : '', p.state, p.country].filter(Boolean).join(', '), lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], kind: (p.type || p.osm_value || 'place').replace(/_/g, ' '), range: rangeFor(p.extent, p.type) }; });
  } catch { /* fall through to Nominatim */ }
  if (!out.length) {
    try {
      const d = await getJSON(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=${limit}`, { timeout: 9000 });
      out = d.map((r) => ({ name: r.name || r.display_name.split(',')[0], where: r.display_name.split(',').slice(1, 4).join(',').trim(), lat: +r.lat, lon: +r.lon, kind: (r.type || 'place').replace(/_/g, ' '), range: rangeFor(r.boundingbox ? [+r.boundingbox[2], +r.boundingbox[1], +r.boundingbox[3], +r.boundingbox[0]] : null, r.addresstype), bbox: r.boundingbox?.map(Number) }));
    } catch { /* no network geocoder available */ }
  }
  cache.set(key, out);
  return out;
}
/** Best single match for free text, or null. */
export async function geocode(q) {
  q = q.replace(/^(the|a)\s+/i, '').replace(/[?.!]+$/, '').trim();
  if (!q) return null;
  const c = parseCoords(q);
  if (c) return { name: `${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}`, where: 'Coordinates', lat: c.lat, lon: c.lon, range: 20000, kind: 'Coordinates' };
  const local = searchPlaces(q, 1)[0];
  if (local && local.score >= 69) return local;
  const remote = await remoteSearch(q, 3);
  return remote[0] || local || null;
}
/** Boundary polygon and bounding box for a named area (state, country, park, building grounds). */
export async function boundary(q) {
  const d = await getJSON(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=3&polygon_geojson=1&polygon_threshold=0.002`, { timeout: 15000 });
  const hit = d.find((r) => r.geojson && /Polygon/.test(r.geojson.type)) || d[0];
  if (!hit) return null;
  const bb = hit.boundingbox.map(Number); // [s, n, w, e]
  return { name: hit.name || hit.display_name.split(',')[0], lat: +hit.lat, lon: +hit.lon, bbox: { s: bb[0], n: bb[1], w: bb[2], e: bb[3] }, geojson: hit.geojson };
}
