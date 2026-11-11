// Layer registry. Every data layer is one module that registers itself here.
import { emit, store } from '../core/bus.js';
import { explain } from '../core/net.js';

export const registry = new Map();
export const GROUPS = ['Movement', 'Space', 'Cameras', 'Infrastructure', 'Events', 'Weather', 'Audio'];
const TRUST = { live: 'Live', delayed: 'Delayed', sim: 'Simulated', est: 'Estimated', static: 'Reference' };
export const trustLabel = (t) => TRUST[t] || '';

/**
 * def: { id, name, group, color, icon, blurb, source, trust, viewBound?, minZoomKm?,
 *        enable(L), disable(L), contacts?(), info?(key), position?(key), trail?(key), subs?, setSub?, onView? }
 */
export function defineLayer(def) {
  const L = {
    enabled: false, status: 'off', note: '', count: 0, updatedAt: 0, timers: [],
    setStatus(status, note = '') { L.status = status; L.note = note; if (status === 'live') L.updatedAt = Date.now(); emit('layers', L.id); },
    setCount(n) { if (L.count !== n) { L.count = n; emit('layers', L.id); } },
    /** Run fn now and every `ms` while the layer is on. Errors become a visible status, and polling continues. */
    poll(fn, ms) {
      let busy = false;
      const run = async () => {
        if (!L.enabled || busy) return;
        busy = true;
        try { await fn(); if (L.enabled && L.status !== 'zoom' && L.status !== 'empty') L.setStatus('live', L.note); }
        catch (e) { if (L.enabled) { console.warn(`[${L.id}]`, e); L.setStatus(L.count ? 'stale' : 'error', explain(e)); } }
        finally { busy = false; }
      };
      const t = setInterval(run, ms);
      L.timers.push(t);
      run();
      return run;
    },
    ...def,
  };
  registry.set(L.id, L);
  return L;
}

export async function setLayer(id, on, { persist = true } = {}) {
  const L = registry.get(id);
  if (!L || L.enabled === on) return L;
  L.enabled = on;
  if (on) {
    L.setStatus('loading');
    try { await L.enable(L); if (L.status === 'loading') L.setStatus('live', L.note); }
    catch (e) { console.warn(`[${id}] enable failed`, e); L.setStatus('error', explain(e)); }
  } else {
    for (const t of L.timers) clearInterval(t);
    L.timers = [];
    try { L.disable?.(L); } catch (e) { console.warn(e); }
    L.count = 0;
    L.setStatus('off');
  }
  if (persist) store.set('layers', enabledIds());
  emit('layers:toggle', { id, on });
  return L;
}
export const toggleLayer = (id) => setLayer(id, !registry.get(id)?.enabled);
export const enabledIds = () => [...registry.values()].filter((l) => l.enabled).map((l) => l.id);
export const enabledLayers = () => [...registry.values()].filter((l) => l.enabled);
export async function setOnly(ids) {
  for (const L of registry.values()) if (L.enabled && !ids.includes(L.id)) await setLayer(L.id, false);
  await Promise.all(ids.map((id) => setLayer(id, true)));
}
export function findLayer(text) {
  const t = text.toLowerCase().trim();
  let best = null;
  for (const L of registry.values()) {
    const names = [L.id, L.name.toLowerCase(), ...(L.aliases || [])];
    for (const n of names) if (t.includes(n) && (!best || n.length > best.n.length)) best = { L, n };
  }
  return best?.L || null;
}
