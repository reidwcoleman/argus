// Infrastructure: datacenters, dams, submarine cables.
import { C, scene } from '../core/viewer.js';
import { defineLayer } from './base.js';
import { PointSet } from './points.js';
import { getJSON, prox } from '../core/net.js';
import { latlon } from '../core/geo.js';

function staticPoints({ id, name, color, icon, blurb, file, aliases, map, kind, shape, stats }) {
  let set = null;
  defineLayer({
    id, name, group: 'Infrastructure', color, icon, trust: 'static', blurb, source: 'OpenStreetMap contributors', aliases,
    async enable(L) {
      set = new PointSet(id, { near: 4e4, nearScale: 1.5, far: 1.5e7, farScale: 0.6 });
      const d = await getJSON(file);
      set.set(d.rows.map((r, i) => ({ key: id + i, ...map(r) })), () => (shape ? { shape, color, size: 15 } : { color, size: 4.5, alpha: 0.9 }));
      L.setCount(set.size);
    },
    disable() { set?.destroy(); set = null; },
    contacts: () => (set ? [...set.values()].map((x) => ({ key: x.key, L: id, label: (x.name || kind).slice(0, 24), lat: x.lat, lon: x.lon, alt: 0, color, operator: x.operator })) : []),
    position: (k, r) => set?.position(k, r) || null,
    info(k, brief) {
      const x = set?.get(k);
      if (!x) return null;
      const title = x.name || `Unnamed ${kind.toLowerCase()}`;
      if (brief) return { title, kind, sub: x.operator || '' };
      return { title, kind, sub: x.operator && x.operator !== x.name ? x.operator : '', color, range: 2600, pitch: -40, lat: x.lat, lon: x.lon, stats: stats?.(x), rows: [['Operator', x.operator || 'Not tagged'], ['Position', latlon(x.lat, x.lon)], ['Mapped by', 'OpenStreetMap contributors']], note: 'Community-mapped, so the list is incomplete by nature.' };
    },
  });
}
staticPoints({ id: 'datacenters', name: 'Datacenters', color: '#8ea8ff', icon: 'server', blurb: '4,352 mapped facilities worldwide', file: '/data/datacenters.json', aliases: ['datacenters', 'data centers', 'datacenter', 'data centres'], kind: 'Datacenter', map: (r) => ({ lat: r[0], lon: r[1], name: r[2], operator: r[3] }) });
staticPoints({ id: 'dams', name: 'Dams', color: '#58c4dd', icon: 'dam', blurb: '704 mapped dams and their output', file: '/data/dams.json', aliases: ['dams', 'dam', 'hydro'], kind: 'Dam', shape: 'tri', map: (r) => ({ lat: r[0], lon: r[1], name: r[2], operator: r[3], height: r[4], output: r[5] }), stats: (x) => (x.height || x.output ? [[x.height || '—', x.height ? 'm' : '', 'Height'], [x.output || '—', '', 'Output'], ['', '', '']] : null) });

/* --------------------------------------------------------------- cables */
let cablePrim = null, landings = null, cables = new Map();
const detail = new Map();
defineLayer({
  id: 'cables', name: 'Submarine cables', group: 'Infrastructure', color: '#6fe0ff', icon: 'cable', trust: 'static',
  blurb: 'The undersea internet and where it lands', source: 'TeleGeography (CC BY-NC-SA 3.0)', aliases: ['cables', 'submarine cables', 'undersea cables', 'internet cables'],
  async enable(L) {
    const [geo, land] = await Promise.all([
      getJSON('https://www.submarinecablemap.com/api/v3/cable/cable-geo.json', { proxy: true, ttl: 86400, timeout: 45000 }),
      getJSON('https://www.submarinecablemap.com/api/v3/landing-point/landing-point-geo.json', { proxy: true, ttl: 86400, timeout: 45000 }).catch(() => ({ features: [] })),
    ]);
    const instances = [];
    cables = new Map();
    for (const f of geo.features) {
      const p = f.properties, id = p.id;
      const lines = f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates];
      const col = C.Color.fromCssColorString(p.color || '#6fe0ff').withAlpha(0.85);
      let mid = null;
      for (const line of lines) {
        if (line.length < 2) continue;
        if (!mid || line.length > mid.n) mid = { n: line.length, c: line[Math.floor(line.length / 2)] };
        instances.push(new C.GeometryInstance({
          id: { L: 'cables', k: id },
          geometry: new C.PolylineGeometry({ positions: C.Cartesian3.fromDegreesArray(line.flat()), width: 1.7, arcType: C.ArcType.GEODESIC, vertexFormat: C.PolylineColorAppearance.VERTEX_FORMAT }),
          attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(col) },
        }));
      }
      if (mid) cables.set(id, { id, name: p.name, color: p.color || '#6fe0ff', lat: mid.c[1], lon: mid.c[0] });
    }
    cablePrim = scene.primitives.add(new C.Primitive({ geometryInstances: instances, appearance: new C.PolylineColorAppearance({ translucent: true }), asynchronous: true }));
    landings = new PointSet('cables', { near: 5e4, nearScale: 1.4, far: 1.2e7, farScale: 0.5 });
    landings.set(land.features.map((f) => ({ key: 'lp:' + f.properties.id, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], name: f.properties.name })), () => ({ color: '#e9fbff', size: 3.2, alpha: 0.8, outline: 0 }));
    L.setCount(cables.size);
  },
  disable() { if (cablePrim) scene.primitives.remove(cablePrim); landings?.destroy(); cablePrim = landings = null; },
  contacts: () => [],
  position(k, r) {
    if (String(k).startsWith('lp:')) return landings?.position(k, r) || null;
    const c = cables.get(k);
    return c ? C.Cartesian3.fromDegrees(c.lon, c.lat, 0, C.Ellipsoid.WGS84, r) : null;
  },
  onSelect(k) {
    if (String(k).startsWith('lp:') || detail.has(k)) return;
    detail.set(k, null);
    getJSON(`https://www.submarinecablemap.com/api/v3/cable/${k}.json`, { proxy: true, ttl: 86400 }).then((d) => detail.set(k, d)).catch(() => {});
  },
  info(k, brief) {
    if (String(k).startsWith('lp:')) {
      const p = landings?.get(k);
      if (!p) return null;
      if (brief) return { title: p.name, kind: 'Cable landing', sub: '' };
      return { title: p.name, kind: 'Cable landing point', sub: 'Where undersea fibre comes ashore', color: '#e9fbff', range: 30000, pitch: -45, lat: p.lat, lon: p.lon, rows: [['Position', latlon(p.lat, p.lon)]] };
    }
    const c = cables.get(k);
    if (!c) return null;
    if (brief) return { title: c.name, kind: 'Submarine cable', sub: '' };
    const d = detail.get(k);
    return {
      title: c.name, kind: 'Submarine cable', sub: d?.owners || 'Loading details', color: c.color, range: 2.5e6, pitch: -75, lat: c.lat, lon: c.lon,
      stats: d ? [[d.length || '—', '', 'Length'], [d.rfs_year || d.rfs || '—', '', 'Ready for service'], [d.landing_points?.length || '—', '', 'Landings']] : null,
      rows: d ? [['Suppliers', d.suppliers || 'Not listed'], ['Lands at', (d.landing_points || []).slice(0, 6).map((l) => l.name.split(',')[0]).join(', ') + ((d.landing_points || []).length > 6 ? ' and more' : '')], ...(d.url ? [['Website', `<a href="${d.url}" target="_blank" rel="noopener">Open</a>`]] : [])] : [],
      note: 'Routes are schematic, not surveyed positions. Data © TeleGeography, non-commercial use.',
    };
  },
});
void prox;
