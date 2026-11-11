// Share links: camera, optic, layers, basemap and one tracked target, all in the URL hash.
import { C, camera, camInfo, setBasemap } from './viewer.js';
import { state, set, on, emit } from './bus.js';
import { enabledIds, setLayer, registry } from '../layers/base.js';
import { current, select } from './select.js';

export function buildLink() {
  const c = camInfo(), p = new URLSearchParams();
  p.set('c', [c.lon.toFixed(5), c.lat.toFixed(5), Math.round(c.height), c.heading.toFixed(1), c.pitch.toFixed(1)].join(','));
  if (state.style !== 'normal') p.set('o', state.style);
  const ids = enabledIds();
  if (ids.length) p.set('l', ids.join('.'));
  if (state.basemap !== 'satellite') p.set('b', state.basemap);
  if (state.hud) p.set('hud', '1');
  if (state.detect) p.set('det', '1');
  const sel = current();
  if (sel) p.set('t', `${sel.L.id}:${sel.key}${state.tracking ? ':track' : ''}`);
  return `${location.origin}${location.pathname}#${p.toString().replace(/%2C/g, ',').replace(/%3A/g, ':')}`;
}
/** Applies a share link if one is present. Returns true when it handled the initial view. */
export function applyLink() {
  const h = location.hash.slice(1);
  if (!h || !h.includes('c=')) return false;
  const p = new URLSearchParams(h);
  const c = (p.get('c') || '').split(',').map(Number);
  if (c.length >= 3 && c.every(Number.isFinite)) camera.setView({ destination: C.Cartesian3.fromDegrees(c[0], c[1], c[2]), orientation: { heading: C.Math.toRadians(c[3] || 0), pitch: C.Math.toRadians(c[4] ?? -90), roll: 0 } });
  if (p.get('o')) set('style', p.get('o'));
  if (p.get('b')) setBasemap(p.get('b'), true);
  if (p.get('hud')) set('hud', true);
  if (p.get('det')) set('detect', true);
  for (const id of (p.get('l') || '').split('.').filter(Boolean)) if (registry.has(id)) setLayer(id, true, { persist: false });
  const t = p.get('t');
  if (t) {
    // A live target is a handoff, not a bookmark: wait for the feed to carry it, then lock on.
    const [layer, ...rest] = t.split(':');
    const track = rest[rest.length - 1] === 'track';
    const key = (track ? rest.slice(0, -1) : rest).join(':');
    let tries = 0;
    const iv = setInterval(() => {
      if (registry.get(layer)?.info?.(key)) { clearInterval(iv); select(layer, key, { track, fly: !track }); }
      else if (++tries > 40) { clearInterval(iv); emit('toast', { text: 'The shared target is no longer in the live feed. The view and layers were restored.' }); }
    }, 750);
  }
  return true;
}
on('share', async () => {
  const url = buildLink();
  history.replaceState(null, '', url);
  try { await navigator.clipboard.writeText(url); emit('toast', { text: current() ? 'Link copied. It carries this view, your layers and the tracked target.' : 'Link copied. It carries this exact view and your layers.' }); }
  catch { emit('toast', { text: 'The link is in the address bar. Copy it from there.' }); }
});
