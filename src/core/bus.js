// Tiny event bus and shared app state.
const subs = new Map();
export function on(evt, fn) {
  if (!subs.has(evt)) subs.set(evt, new Set());
  subs.get(evt).add(fn);
  return () => subs.get(evt)?.delete(fn);
}
export function emit(evt, data) {
  const set = subs.get(evt);
  if (set) for (const fn of [...set]) { try { fn(data); } catch (e) { console.error(`[bus:${evt}]`, e); } }
}
export const state = {
  style: 'normal', hud: false, detect: false, density: 0.5, panel: 'layers', selected: null, tracking: false,
  cockpit: false, basemap: 'satellite', labels: true, lighting: false, units: 'aviation', context: false, sharpen: 0,
  coverage: 'off', threeD: true,
};
export function set(key, value) {
  if (state[key] === value) return;
  state[key] = value;
  emit('state:' + key, value);
  emit('state', key);
}
const LS = 'argus:';
export const store = {
  get(k, fallback = null) { try { const v = localStorage.getItem(LS + k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(LS + k); } catch { /* ignore */ } },
};
