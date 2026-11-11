// News: reports of physical conflict and protest from GDELT's 15-minute event files, placed on the globe.
import { defineLayer, setLayer, registry } from './base.js';
import { PointSet } from './points.js';
import { getJSON } from '../core/net.js';
import { on, emit, store } from '../core/bus.js';
import { ago, latlon, esc, distM } from '../core/geo.js';
import { select } from '../core/select.js';
import { camInfo } from '../core/viewer.js';
import { registerPanel } from '../ui/shell.js';
import { icon } from '../ui/dom.js';

const KIND = { 'Protest': '#ffd65a', 'Assault': '#ff9c3f', 'Armed clash': '#ff5d52', 'Mass violence': '#ff4dae' };
let set = null, items = [], groups = new Map(), hours = store.get('newsHours', 24), kinds = new Set(Object.keys(KIND));

function rebuild(L) {
  const cut = Date.now() - hours * 3600000;
  groups = new Map();
  for (const it of items) {
    if (it.t < cut || !kinds.has(it.kind)) continue;
    const k = `${it.lat.toFixed(1)},${it.lon.toFixed(1)}`;
    if (!groups.has(k)) groups.set(k, { key: k, lat: it.lat, lon: it.lon, place: it.place, list: [] });
    groups.get(k).list.push(it);
  }
  for (const g of groups.values()) { g.list.sort((a, b) => b.root - a.root || b.mentions - a.mentions); g.top = g.list[0]; }
  if (set) set.set([...groups.values()], (g) => ({ shape: 'diamond', color: KIND[g.top.kind], size: Math.min(26, 13 + Math.sqrt(g.list.length) * 3) }));
  L.setCount([...groups.values()].reduce((a, g) => a + g.list.length, 0));
  emit('news');
}
const L = defineLayer({
  id: 'news', name: 'Conflict reports', group: 'Events', color: '#ff5d52', icon: 'news', trust: 'live',
  blurb: 'Reports of violence and protest, mapped', source: 'GDELT 2.0', aliases: ['news', 'conflicts', 'conflict', 'protests', 'headlines'],
  enable(L) {
    set = new PointSet('news', { near: 2e5, nearScale: 1.3, far: 2.5e7, farScale: 0.75 });
    L.poll(async () => { const d = await getJSON('/api/news', { timeout: 60000 }); items = d.items; rebuild(L); }, 10 * 60000);
  },
  disable() { set?.destroy(); set = null; },
  contacts: () => [...groups.values()].map((g) => ({ key: g.key, L: 'news', label: g.top.kind.toUpperCase(), lat: g.lat, lon: g.lon, alt: 0, color: KIND[g.top.kind] })),
  position: (k, r) => set?.position(k, r) || null,
  info(k, brief) {
    const g = groups.get(k);
    if (!g) return null;
    const place = (g.place || '').split(',').slice(0, 2).join(',') || latlon(g.lat, g.lon);
    if (brief) return { title: g.top.title.slice(0, 60), kind: g.top.kind, sub: place };
    return {
      title: place, kind: `${g.list.length} ${g.list.length === 1 ? 'report' : 'reports'} · ${g.top.kind}`, sub: `Latest ${ago(Math.max(...g.list.map((x) => x.t)))}`, color: KIND[g.top.kind], range: 400000, pitch: -60, lat: g.lat, lon: g.lon,
      rows: g.list.slice(0, 6).map((x) => [esc(x.kind), `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title.slice(0, 70))}</a>`]),
      note: 'Machine-read from news text. Places and categories can be wrong: the marker is where the story was filed against, not a verified location.',
    };
  },
});
export const newsItems = () => items;
export function headlinesNear(lat, lon, km = 600, max = 3) {
  return items.filter((x) => distM(lat, lon, x.lat, x.lon) < km * 1000).sort((a, b) => b.mentions - a.mentions).slice(0, max);
}

registerPanel({
  id: 'news', title: 'News', icon: 'news',
  render(body, { sub }) {
    if (!L.enabled) setLayer('news', true);
    let local = false;
    const draw = () => {
      const top = body.scrollTop;
      const cut = Date.now() - hours * 3600000, c = camInfo();
      let list = items.filter((x) => x.t >= cut && kinds.has(x.kind));
      if (local) list = list.filter((x) => distM(c.clat, c.clon, x.lat, x.lon) < 1.5e6).sort((a, b) => distM(c.clat, c.clon, a.lat, a.lon) - distM(c.clat, c.clon, b.lat, b.lon));
      sub.textContent = list.length ? `${list.length.toLocaleString()} reports` : '';
      const head = `<div style="display:flex;justify-content:space-between;gap:8px;padding:2px 8px 10px;flex-wrap:wrap">
          <div class="seg">${[24, 6, 3, 1].map((h) => `<button data-h="${h}" aria-pressed="${h === hours}">${h} h</button>`).join('')}</div>
          <div class="seg"><button data-l="0" aria-pressed="${!local}">World</button><button data-l="1" aria-pressed="${local}">Near view</button></div></div>
        <div class="chips" style="padding:0 8px 10px">${Object.entries(KIND).map(([k, col]) => `<button class="chip" data-k="${k}" aria-pressed="${kinds.has(k)}" style="--c:${col}"><i class="dot"></i>${k}</button>`).join('')}</div>`;
      let bodyHtml;
      if (L.status === 'loading' && !items.length) bodyHtml = '<div class="skel"></div><div class="skel"></div><div class="skel"></div><div class="skel"></div>';
      else if (L.status === 'error' && !items.length) bodyHtml = `<div class="empty">${icon('alert', 26)}<b>The event files did not load</b>GDELT publishes every 15 minutes. It will retry on its own.</div>`;
      else if (!list.length) bodyHtml = `<div class="empty">${icon('news', 26)}<b>No reports match</b>${local ? 'Nothing within 1,500 km of this view in the last ' + hours + ' h.' : 'Widen the time window or turn a category back on.'}<button class="btn sm" data-reset>Show everything</button></div>`;
      else bodyHtml = list.slice(0, 120).map((x) => `<button class="item" data-n="${x.lat.toFixed(1)},${x.lon.toFixed(1)}" style="--c:${KIND[x.kind]}"><span class="t">${esc(x.title)}</span><span class="r">${ago(x.t).replace(' ago', '')}</span><span class="d"><span class="k">${x.kind}</span>${esc((x.place || '').split(',')[0])} · ${esc(x.host)}</span></button>`).join('') + '<p class="note" style="margin-top:10px">Headlines are rebuilt from article addresses, so wording is approximate. Open the source for the real story.</p>';
      body.innerHTML = head + bodyHtml;
      body.scrollTop = top;
    };
    body.addEventListener('click', (e) => {
      const h = e.target.closest('[data-h]'); if (h) { hours = +h.dataset.h; store.set('newsHours', hours); return rebuild(L); }
      const l = e.target.closest('[data-l]'); if (l) { local = l.dataset.l === '1'; return draw(); }
      const k = e.target.closest('[data-k]'); if (k) { const id = k.dataset.k; if (kinds.has(id)) kinds.delete(id); else kinds.add(id); return rebuild(L); }
      if (e.target.closest('[data-reset]')) { hours = 24; kinds = new Set(Object.keys(KIND)); local = false; return rebuild(L); }
      const n = e.target.closest('[data-n]'); if (n) select('news', n.dataset.n);
    });
    const offs = [on('news', draw), on('layers', (id) => { if (id === 'news') draw(); })];
    draw();
    return () => offs.forEach((f) => f());
  },
});
void registry;
