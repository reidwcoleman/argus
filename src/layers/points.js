// Renderer for fixed-position features: either cheap GPU points or glyph billboards.
import { C, scene } from '../core/viewer.js';
import { glyph } from './glyphs.js';

export class PointSet {
  constructor(layerId, { near = 5e4, nearScale = 1.15, far = 2e7, farScale = 0.45 } = {}) {
    this.layerId = layerId;
    this.items = new Map();
    this.points = scene.primitives.add(new C.PointPrimitiveCollection());
    this.bbs = scene.primitives.add(new C.BillboardCollection({ scene }));
    this.scale = new C.NearFarScalar(near, nearScale, far, farScale);
  }
  /** items: [{ key, lat, lon, alt? }], style(item) -> { shape?, color, size, alpha?, rot? }. Without a shape the feature is a GPU point. */
  set(items, style) {
    this.points.removeAll();
    this.bbs.removeAll();
    this.items.clear();
    for (const it of items) this.add(it, style);
  }
  add(it, style) {
    const st = style(it);
    const position = C.Cartesian3.fromDegrees(it.lon, it.lat, it.alt || 0);
    const id = { L: this.layerId, k: it.key };
    it._p = position;
    if (st.shape) {
      it._g = this.bbs.add({ position, image: glyph(st.shape, st.color, st.size), width: st.size, height: st.size, id, scaleByDistance: st.fixed ? undefined : this.scale, rotation: st.rot ? -st.rot * Math.PI / 180 : 0, alignedAxis: st.rot != null ? C.Cartesian3.UNIT_Z : C.Cartesian3.ZERO, color: C.Color.WHITE.withAlpha(st.alpha ?? 1) });
    } else {
      it._g = this.points.add({ position, pixelSize: st.size, color: C.Color.fromCssColorString(st.color).withAlpha(st.alpha ?? 0.92), outlineColor: C.Color.BLACK.withAlpha(0.55), outlineWidth: st.outline ?? 1, id, scaleByDistance: st.fixed ? undefined : this.scale });
    }
    this.items.set(it.key, it);
  }
  get(key) { return this.items.get(key); }
  get size() { return this.items.size; }
  values() { return this.items.values(); }
  position(key, result) { const it = this.items.get(key); return it ? C.Cartesian3.clone(it._p, result) : null; }
  set show(v) { this.points.show = v; this.bbs.show = v; }
  destroy() { scene.primitives.remove(this.points); scene.primitives.remove(this.bbs); this.items.clear(); }
}
