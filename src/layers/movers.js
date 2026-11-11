// Shared renderer for moving contacts (aircraft, ships, transit, simulated cars).
// Feeds arrive every few seconds; between fixes each contact is dead-reckoned
// along its last heading and speed, and corrections are blended in so nothing snaps.
import { C, scene } from '../core/viewer.js';
import { glyph } from './glyphs.js';

const R = 6371008.8;
const D2R = Math.PI / 180;

export class Movers {
  constructor({ layerId, iconFor, maxExtrap = 90, far = 1.4e7, farScale = 0.36, near = 2.5e4, nearScale = 1 }) {
    this.layerId = layerId;
    this.iconFor = iconFor;
    this.maxExtrap = maxExtrap;
    this.map = new Map();
    this.bbs = scene.primitives.add(new C.BillboardCollection({ scene }));
    this.scale = new C.NearFarScalar(near, nearScale, far, farScale);
    this.frame = 0;
    this._scratch = new C.Cartesian3();
    this._tick = scene.preUpdate.addEventListener(() => this.update(Date.now()));
  }

  upsert(key, fix, props) {
    let o = this.map.get(key);
    const now = Date.now();
    if (!o) {
      o = { key, olat: 0, olon: 0, ot: 0, hist: [], fast: false, dlat: fix.lat, dlon: fix.lon, dalt: fix.alt || 0 };
      Object.assign(o, fix, props);
      const ic = this.iconFor(o);
      o._ik = ic.shape + ic.color + ic.size;
      o.bb = this.bbs.add({
        position: C.Cartesian3.fromDegrees(fix.lon, fix.lat, fix.alt || 0),
        image: glyph(ic.shape, ic.color, ic.size), width: ic.size, height: ic.size,
        rotation: -(fix.hdg || 0) * D2R, alignedAxis: ic.noRotate ? C.Cartesian3.ZERO : C.Cartesian3.UNIT_Z,
        scaleByDistance: this.scale, id: { L: this.layerId, k: key },
      });
      this.map.set(key, o);
      o.hist.push([fix.lat, fix.lon, fix.alt || 0, fix.ts]);
      return o;
    }
    if (fix.ts < o.ts) { if (props) Object.assign(o, props); return o; } // older than what we have
    const moved = fix.ts !== o.ts || fix.lat !== o.lat || fix.lon !== o.lon;
    if (moved) {
      // Blend from where the contact is currently drawn to the new prediction.
      this.compute(o, now);
      const pLat = o.dlat, pLon = o.dlon;
      Object.assign(o, fix, props);
      o.olat = 0; o.olon = 0;
      this.compute(o, now);
      let dLon = pLon - o.dlon; if (dLon > 180) dLon -= 360; else if (dLon < -180) dLon += 360;
      const jump = Math.abs(pLat - o.dlat) + Math.abs(dLon);
      if (jump < 0.6) { o.olat = pLat - o.dlat; o.olon = dLon; o.ot = now; }
      const h = o.hist, last = h[h.length - 1];
      if (!last || Math.abs(last[0] - fix.lat) + Math.abs(last[1] - fix.lon) > 0.0015) {
        h.push([fix.lat, fix.lon, fix.alt || 0, fix.ts]);
        const cap = o.fast ? 400 : 8;
        if (h.length > cap) h.splice(0, h.length - cap);
        o.histV = (o.histV || 0) + 1;
      }
      o.bb.rotation = -(fix.hdg || 0) * D2R;
    } else if (props) Object.assign(o, props);
    const ic = this.iconFor(o);
    const ik = ic.shape + ic.color + ic.size;
    if (ik !== o._ik) { o._ik = ik; o.bb.image = glyph(ic.shape, ic.color, ic.size); o.bb.width = o.bb.height = ic.size; }
    return o;
  }

  compute(o, now) {
    let dt = (now - o.ts) / 1000;
    const cap = o.maxEx ?? this.maxExtrap;
    if (dt > cap) dt = cap; else if (dt < 0) dt = 0;
    let lat = o.lat, lon = o.lon;
    if (o.spd > 0.5 && dt > 0) {
      const d = (o.spd * dt) / R, b = (o.hdg || 0) * D2R;
      lat += (d * Math.cos(b)) / D2R;
      lon += (d * Math.sin(b)) / (D2R * Math.max(0.05, Math.cos(o.lat * D2R)));
    }
    const k = 1 - (now - o.ot) / 3000;
    if (k > 0) { const e = k * k * (3 - 2 * k); lat += o.olat * e; lon += o.olon * e; }
    if (lat > 89.9) lat = 89.9; else if (lat < -89.9) lat = -89.9;
    o.dlat = lat; o.dlon = lon;
    o.dalt = Math.max(0, (o.alt || 0) + (o.vr || 0) * Math.min(dt, 20));
  }

  /** Current interpolated position of a contact. */
  positionOf(key, result) {
    const o = typeof key === 'object' ? key : this.map.get(key);
    if (!o) return null;
    this.compute(o, Date.now());
    return C.Cartesian3.fromDegrees(o.dlon, o.dlat, o.dalt, C.Ellipsoid.WGS84, result);
  }

  update(now) {
    const n = this.map.size;
    if (!n || !this.bbs.show) return;
    const stride = n > 7000 ? 8 : n > 3000 ? 4 : n > 1000 ? 2 : 1;
    const f = this.frame++;
    let i = 0;
    for (const o of this.map.values()) {
      i++;
      if (!o.fast && stride > 1 && (i + f) % stride) continue;
      if (!o.fast && o.spd < 0.5 && now - o.ot > 3000) continue;
      this.compute(o, now);
      o.bb.position = C.Cartesian3.fromDegrees(o.dlon, o.dlat, o.dalt, C.Ellipsoid.WGS84, this._scratch);
    }
  }

  remove(key) {
    const o = this.map.get(key);
    if (!o) return;
    this.bbs.remove(o.bb);
    this.map.delete(key);
  }
  /** Drop contacts not heard from since `cutoff` (ms epoch). keep(o) can veto. */
  prune(cutoff, keep) {
    for (const o of this.map.values()) if (o.seen < cutoff && !(keep && keep(o))) this.remove(o.key);
  }
  get(key) { return this.map.get(key); }
  get size() { return this.map.size; }
  values() { return this.map.values(); }
  destroy() {
    this._tick();
    scene.primitives.remove(this.bbs);
    this.map.clear();
  }
}
