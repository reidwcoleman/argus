// Data layers panel: one hero row per layer, grouped.
import { el, icon } from './dom.js';
import { registerPanel } from './shell.js';
import { registry, GROUPS, setLayer, enabledIds, trustLabel } from '../layers/base.js';
import { on } from '../core/bus.js';
import { esc } from '../core/geo.js';

function meta(L) {
  if (!L.enabled) return [L.blurb, ''];
  if (L.status === 'loading') return [L.note || 'Connecting to ' + L.source.split(' · ')[0], ''];
  if (L.status === 'error') return [L.note || 'Could not load', 'err'];
  if (L.status === 'stale') return ['Showing last good data · ' + (L.note || 'retrying'), ''];
  if (L.status === 'zoom') return [L.note || 'Zoom in to load this area', ''];
  if (L.status === 'empty') return [L.note || 'Nothing here right now', ''];
  return [L.note || L.source, ''];
}
function rowHtml(L) {
  const [m, cls] = meta(L);
  const trust = L.trust === 'live' ? 'live' : L.trust === 'sim' ? 'sim' : L.trust === 'est' ? 'est' : '';
  const right = L.enabled && L.status === 'loading' ? '<span class="spinner"></span>' : L.enabled && L.count ? `<span class="count">${L.count.toLocaleString()}</span>` : '';
  let subs = '';
  if (L.subs && L.enabled) subs = `<div class="subrows">${L.subs().map((s) => `<button class="chip" data-sub="${L.id}:${s.id}" aria-pressed="${s.on}" style="--c:${s.color || L.color}"><i class="dot"></i>${esc(s.name)}${s.count != null ? `<span class="n">${s.count.toLocaleString()}</span>` : ''}</button>`).join('')}</div>`;
  return `<button class="row ${L.enabled ? 'on' : ''}" role="switch" aria-checked="${L.enabled}" data-layer="${L.id}" style="--c:${L.color}">
    <span class="glyph">${icon(L.icon, 17)}</span>
    <span><span class="name">${esc(L.name)}${L.trust !== 'static' ? `<span class="tag ${trust}">${trustLabel(L.trust)}</span>` : ''}</span><span class="meta ${cls}">${esc(m)}</span></span>
    <span class="right">${right}<span class="switch"></span></span></button>${subs}`;
}

registerPanel({
  id: 'layers', title: 'Data layers', icon: 'layers', key: 'L',
  badge: () => enabledIds().length || '',
  render(body, { sub, head }) {
    const clear = el(`<button class="btn ghost sm" style="margin-right:2px">Clear all</button>`);
    head.insertBefore(clear, head.lastElementChild);
    clear.onclick = () => { for (const id of enabledIds()) setLayer(id, false); };
    let raf = 0;
    const draw = () => {
      raf = 0;
      const top = body.scrollTop;
      const n = enabledIds().length;
      sub.textContent = n ? `${n} on` : '';
      clear.hidden = !n;
      body.innerHTML = GROUPS.map((g) => {
        const ls = [...registry.values()].filter((l) => l.group === g);
        if (!ls.length) return '';
        return `<section class="group"><div class="group-head"><span class="eyebrow">${g}</span></div>${ls.map(rowHtml).join('')}</section>`;
      }).join('') + '<p class="note" style="margin-top:14px">Every layer says how fresh it is. <b>Live</b> is a real feed, <b>Delayed</b> is hours old, <b>Simulated</b> and <b>Estimated</b> are models.</p>';
      body.scrollTop = top;
    };
    const queue = () => { if (!raf) raf = requestAnimationFrame(draw); };
    body.addEventListener('click', (e) => {
      const s = e.target.closest('[data-sub]');
      if (s) { const [lid, sid] = s.dataset.sub.split(':'); registry.get(lid).setSub(sid, s.getAttribute('aria-pressed') !== 'true'); return; }
      const r = e.target.closest('[data-layer]');
      if (r) setLayer(r.dataset.layer, !registry.get(r.dataset.layer).enabled);
    });
    const offs = [on('layers', queue), on('layers:toggle', queue)];
    draw();
    return () => offs.forEach((f) => f());
  },
});
