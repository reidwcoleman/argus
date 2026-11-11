// Movement beyond aircraft: vessels (AIS), transit vehicles, bikeshare docks.
import { defineLayer } from './base.js';
import { Movers } from './movers.js';
import { PointSet } from './points.js';
import { getJSON } from '../core/net.js';
import { fmtSpeed, compass, latlon, ago, bearing, distM } from '../core/geo.js';

/* ---------------------------------------------------------------- vessels */
const SHIP = { cargo: '#4be3c1', tanker: '#ff9d5c', passenger: '#7fb8ff', fishing: '#ffe27a', tug: '#c9b8ff', other: '#9fd8cf' };
function shipKind(t) {
  if (t >= 70 && t <= 79) return 'cargo';
  if (t >= 80 && t <= 89) return 'tanker';
  if (t >= 60 && t <= 69) return 'passenger';
  if (t === 30) return 'fishing';
  if (t === 31 || t === 32 || t === 52 || t === 50) return 'tug';
  return 'other';
}
const KIND_NAME = { cargo: 'Cargo ship', tanker: 'Tanker', passenger: 'Passenger ship', fishing: 'Fishing vessel', tug: 'Tug or pilot', other: 'Vessel' };
let ships = null;
const shipMeta = new Map();
defineLayer({
  id: 'vessels', name: 'Live vessels', group: 'Movement', color: SHIP.cargo, icon: 'ship', trust: 'live',
  blurb: 'Ship AIS beacons: Baltic free, worldwide with a key', source: 'Fintraffic Digitraffic · AISStream', aliases: ['vessels', 'vessel', 'ships', 'ship', 'boats', 'ais', 'marine traffic'],
  trailColor: SHIP.cargo,
  enable(L) {
    ships = new Movers({ layerId: 'vessels', maxExtrap: 600, far: 8e6, farScale: 0.4, near: 8e3, iconFor: (o) => ({ shape: 'ship', color: SHIP[o.kind || 'other'], size: o.kind === 'cargo' || o.kind === 'tanker' ? 22 : 18 }) });
    getJSON('https://meri.digitraffic.fi/api/ais/v1/vessels', { timeout: 40000 }).then((list) => {
      for (const v of list) shipMeta.set(v.mmsi, v);
      for (const o of ships?.values() || []) applyMeta(o);
    }).catch(() => {});
    L.poll(async () => {
      const now = Date.now();
      let n = 0, world = false;
      const jobs = [
        getJSON('https://meri.digitraffic.fi/api/ais/v1/locations', { timeout: 30000 }).then((d) => {
          for (const f of d.features) {
            const p = f.properties, t = p.timestampExternal || now;
            if (now - t > 30 * 60000) continue;
            const o = ships.upsert('d' + f.mmsi, { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], alt: 0, spd: (p.sog || 0) * 0.514444, hdg: p.cog ?? p.heading ?? 0, ts: t }, { mmsi: f.mmsi, seen: now, navStat: p.navStat, src: 'Digitraffic', fast: false });
            applyMeta(o); n++;
          }
        }),
        getJSON('/api/ais', { timeout: 15000 }).then((d) => {
          world = d.live;
          for (const r of d.rows) {
            const o = ships.upsert('a' + r[0], { lat: r[2], lon: r[3], alt: 0, spd: r[4] * 0.514444, hdg: r[5] || 0, ts: r[9] * 1000 }, { mmsi: r[0], name: r[1], type: r[7], dest: r[8], seen: now, src: 'AISStream', kind: shipKind(r[7]) });
            if (ships.get('d' + r[0])) ships.remove('d' + r[0]);
            void o; n++;
          }
        }).catch(() => {}),
      ];
      await Promise.all(jobs);
      ships.prune(now - 20 * 60000);
      L.setCount(ships.size);
      L.note = world ? 'Worldwide via AISStream' : 'Baltic Sea live · add a free AISStream key for the world';
    }, 30000);
  },
  disable() { ships?.destroy(); ships = null; },
  contacts: () => (ships ? [...ships.values()].map((o) => ({ key: o.key, L: 'vessels', label: o.name || String(o.mmsi), lat: o.dlat, lon: o.dlon, alt: 0, spd: o.spd, hdg: o.hdg, dest: o.dest, klass: o.kind, color: SHIP[o.kind || 'other'] })) : []),
  position: (k, r) => ships?.positionOf(k, r) || null,
  trail: (k) => ships?.get(k)?.hist || null,
  trailVersion: (k) => ships?.get(k)?.histV || 0,
  onSelect(k) { const o = ships?.get(k); if (o) o.fast = true; },
  onDeselect(k) { const o = ships?.get(k); if (o) o.fast = false; },
  info(k, brief) {
    const o = ships?.get(k);
    if (!o) return null;
    const title = o.name || `MMSI ${o.mmsi}`;
    if (brief) return { title, kind: KIND_NAME[o.kind || 'other'], sub: o.dest ? 'to ' + o.dest : '' };
    const [sv, su] = fmtSpeed(o.spd);
    const moored = o.spd < 0.3;
    return {
      title, kind: KIND_NAME[o.kind || 'other'], sub: o.dest ? `Bound for ${o.dest}` : moored ? 'Stationary' : 'Under way', color: SHIP[o.kind || 'other'], moving: true, range: 4200, pitch: -32,
      lat: o.dlat, lon: o.dlon, alt: 0, nearestCam: true,
      stats: [[sv, su, 'Speed'], [String(Math.round(o.hdg || 0)).padStart(3, '0') + '°', compass(o.hdg || 0), 'Course'], [o.draught ? (o.draught / 10).toFixed(1) : '—', o.draught ? 'm' : '', 'Draught']],
      rows: [['MMSI', String(o.mmsi)], ['Call sign', o.callSign || 'Unknown'], ['IMO', o.imo ? String(o.imo) : 'Unknown'], ['Position', latlon(o.dlat, o.dlon)], ['Last report', `${ago(o.ts)} · ${o.src}`]],
    };
  },
});
function applyMeta(o) {
  const m = shipMeta.get(o.mmsi);
  if (!m) return;
  o.name = (m.name || '').trim(); o.dest = (m.destination || '').trim(); o.callSign = m.callSign; o.imo = m.imo; o.draught = m.draught; o.type = m.shipType;
  const k = shipKind(m.shipType);
  if (k !== o.kind) { o.kind = k; ships?.upsert(o.key, { lat: o.lat, lon: o.lon, alt: 0, spd: o.spd, hdg: o.hdg, ts: o.ts }); }
}

/* ---------------------------------------------------------------- transit */
const MODE = [['Tram', '#ff9ed8'], ['Subway', '#ff6f61'], ['Train', '#c9b8ff'], ['Bus', '#ffe14d'], ['Ferry', '#6fd3ff']];
let transit = null;
defineLayer({
  id: 'transit', name: 'Transit', group: 'Movement', color: '#ffe14d', icon: 'bus', trust: 'live',
  blurb: 'Live buses, trams and trains: Boston, Finland', source: 'MBTA v3 API · Fintraffic rail', aliases: ['transit', 'buses', 'bus', 'trains', 'train', 'subway', 'metro'],
  trailColor: '#ffe14d',
  enable(L) {
    transit = new Movers({ layerId: 'transit', maxExtrap: 25, far: 4e6, farScale: 0.4, near: 6e3, iconFor: (o) => ({ shape: 'bus', color: MODE[o.mode]?.[1] || '#ffe14d', size: o.mode === 3 ? 16 : 20 }) });
    L.poll(async () => {
      const now = Date.now();
      const jobs = [
        getJSON('https://api-v3.mbta.com/vehicles?include=route&fields%5Bvehicle%5D=latitude,longitude,bearing,speed,label,current_status,updated_at&fields%5Broute%5D=short_name,long_name,type', { timeout: 20000 }).then((d) => {
          const routes = new Map((d.included || []).map((r) => [r.id, r.attributes]));
          for (const v of d.data) {
            const a = v.attributes;
            if (a.latitude == null) continue;
            const r = routes.get(v.relationships?.route?.data?.id) || {};
            transit.upsert('mbta' + v.id, { lat: a.latitude, lon: a.longitude, alt: 0, spd: a.speed || 0, hdg: a.bearing || 0, ts: Date.parse(a.updated_at) || now }, { seen: now, mode: r.type ?? 3, route: r.short_name || r.long_name || '', routeName: r.long_name || '', label: a.label, status: (a.current_status || '').replace(/_/g, ' ').toLowerCase(), agency: 'MBTA, Boston', fast: true });
          }
        }),
        getJSON('https://rata.digitraffic.fi/api/v1/train-locations/latest', { timeout: 20000 }).then((d) => {
          for (const t of d) {
            const [lon, lat] = t.location.coordinates;
            const key = 'fi' + t.trainNumber;
            const prev = transit.get(key);
            const ts = Date.parse(t.timestamp) || now;
            let hdg = prev?.hdg || 0;
            if (prev && distM(prev.lat, prev.lon, lat, lon) > 30) hdg = bearing(prev.lat, prev.lon, lat, lon);
            transit.upsert(key, { lat, lon, alt: 0, spd: (t.speed || 0) / 3.6, hdg, ts }, { seen: now, mode: 2, route: 'Train ' + t.trainNumber, label: String(t.trainNumber), agency: 'Finnish rail network', status: '', fast: true });
          }
        }).catch(() => {}),
      ];
      await Promise.all(jobs);
      transit.prune(now - 3 * 60000);
      L.setCount(transit.size);
    }, 10000);
  },
  disable() { transit?.destroy(); transit = null; },
  contacts: () => (transit ? [...transit.values()].map((o) => ({ key: o.key, L: 'transit', label: o.route || o.label, lat: o.dlat, lon: o.dlon, alt: 0, spd: o.spd, color: MODE[o.mode]?.[1] || '#ffe14d', klass: MODE[o.mode]?.[0] })) : []),
  position: (k, r) => transit?.positionOf(k, r) || null,
  trail: (k) => transit?.get(k)?.hist || null,
  trailVersion: (k) => transit?.get(k)?.histV || 0,
  info(k, brief) {
    const o = transit?.get(k);
    if (!o) return null;
    const mode = MODE[o.mode] || MODE[3];
    if (brief) return { title: o.route || o.label, kind: mode[0], sub: o.agency };
    const [sv, su] = fmtSpeed(o.spd);
    return {
      title: o.route || o.label, kind: mode[0], sub: o.routeName && o.routeName !== o.route ? o.routeName : o.agency, color: mode[1], moving: true, range: 1600, pitch: -35, lat: o.dlat, lon: o.dlon, alt: 0,
      stats: [[sv, su, 'Speed'], [String(Math.round(o.hdg || 0)).padStart(3, '0') + '°', compass(o.hdg || 0), 'Heading'], [ago(o.ts).replace(' ago', ''), '', 'Reported']],
      rows: [['Vehicle', o.label || 'Unknown'], ['Status', o.status || 'In service'], ['Operator', o.agency], ['Position', latlon(o.dlat, o.dlon)]],
    };
  },
});

/* -------------------------------------------------------------- bikeshare */
const GBFS = [
  ['Citi Bike', 'New York', 'https://gbfs.citibikenyc.com/gbfs/en'], ['Divvy', 'Chicago', 'https://gbfs.divvybikes.com/gbfs/en'],
  ['Bay Wheels', 'San Francisco', 'https://gbfs.baywheels.com/gbfs/en'], ['Capital Bikeshare', 'Washington', 'https://gbfs.capitalbikeshare.com/gbfs/en'],
  ['Bluebikes', 'Boston', 'https://gbfs.bluebikes.com/gbfs/en'],
];
let docks = null;
const fill = (r) => (r == null ? '#8a9488' : r > 0.5 ? '#5ee6a8' : r > 0.15 ? '#ffd166' : '#ff6f61');
defineLayer({
  id: 'bikeshare', name: 'Bikeshare', group: 'Movement', color: '#5ee6a8', icon: 'bike', trust: 'live',
  blurb: 'Dock availability in six cities', source: 'GBFS operator feeds · TfL', aliases: ['bikeshare', 'bikes', 'bike share', 'citi bike'],
  enable(L) {
    docks = new PointSet('bikeshare', { near: 3e3, nearScale: 1.6, far: 4e5, farScale: 0.5 });
    L.poll(async () => {
      const items = [];
      await Promise.allSettled([
        ...GBFS.map(async ([sys, city, base]) => {
          const [inf, st] = await Promise.all([getJSON(base + '/station_information.json', { timeout: 30000 }), getJSON(base + '/station_status.json', { timeout: 30000 })]);
          const status = new Map(st.data.stations.map((s) => [s.station_id, s]));
          for (const s of inf.data.stations) {
            const x = status.get(s.station_id);
            if (s.lat == null || !x) continue;
            const bikes = x.num_bikes_available || 0, ebikes = x.num_ebikes_available || 0, free = x.num_docks_available || 0;
            items.push({ key: sys + s.station_id, lat: s.lat, lon: s.lon, name: s.name, sys, city, bikes, ebikes, free, cap: s.capacity || bikes + free, ok: x.is_renting !== 0 });
          }
        }),
        getJSON('https://api.tfl.gov.uk/BikePoint', { timeout: 30000 }).then((list) => {
          for (const s of list) {
            const g = (k) => +(s.additionalProperties.find((p) => p.key === k)?.value || 0);
            items.push({ key: s.id, lat: s.lat, lon: s.lon, name: s.commonName, sys: 'Santander Cycles', city: 'London', bikes: g('NbBikes'), ebikes: g('NbEBikes'), free: g('NbEmptyDocks'), cap: g('NbDocks'), ok: true });
          }
        }),
      ]);
      if (!items.length) throw new Error('No bikeshare feed answered');
      docks.set(items, (d) => ({ color: fill(d.cap ? d.bikes / d.cap : null), size: 5.5, alpha: d.ok ? 0.95 : 0.4 }));
      L.setCount(items.length);
    }, 120000);
  },
  disable() { docks?.destroy(); docks = null; },
  position: (k, r) => docks?.position(k, r) || null,
  info(k, brief) {
    const d = docks?.get(k);
    if (!d) return null;
    if (brief) return { title: d.name, kind: d.sys, sub: `${d.bikes} bikes` };
    return {
      title: d.name, kind: `Bikeshare dock · ${d.sys}`, sub: d.city, color: fill(d.cap ? d.bikes / d.cap : null), range: 900, pitch: -45, lat: d.lat, lon: d.lon,
      stats: [[d.bikes, '', 'Bikes'], [d.ebikes, '', 'Electric'], [d.free, '', 'Open docks']],
      rows: [['Capacity', String(d.cap)], ['Renting', d.ok ? 'Yes' : 'No'], ['Position', latlon(d.lat, d.lon)]],
    };
  },
});
