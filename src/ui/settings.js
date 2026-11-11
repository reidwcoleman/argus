// Settings: map and display options, optional free keys ("Power up"), shortcuts and data credits.
import { registerPanel } from './shell.js';
import { icon, toast, setRange } from './dom.js';
import { state, set, on, emit, store } from '../core/bus.js';
import { BASEMAPS, setBasemap, setLabels, setLighting, keys } from '../core/viewer.js';
import { setBloom } from '../fx/styles.js';
import { registry, setLayer } from '../layers/base.js';
import { esc } from '../core/geo.js';
import { cameraNetworks } from '../layers/cameras.js';

const KEYS = [
  { id: 'ion', name: 'Cesium ion token', unlocks: 'Google Photorealistic 3D cities and world terrain', cost: 'Free for personal use', url: 'https://ion.cesium.com/tokens', ph: 'eyJhbGciOi…' },
  { id: 'aisstream', name: 'AISStream key', unlocks: 'Ships worldwide instead of the Baltic only', cost: 'Free signup', url: 'https://aisstream.io', ph: 'your AISStream API key', server: true },
];
const SHORTCUTS = [['⌘K', 'Search or give a command'], ['1 to 6', 'Optics'], ['H', 'Tactical HUD'], ['D', 'Detection overlay'], ['G', 'Global context'], ['T', 'Tilt'], ['N', 'North up'], ['R', 'Reset globe'], ['S', 'Copy share link'], ['L W U M', 'Layers, Weather, Utilities, Missions'], ['Space', 'Hold to talk'], ['Esc', 'Step back out']];

registerPanel({
  id: 'settings', title: 'Settings', icon: 'sliders', bottom: true,
  render(body) {
    const sw = (id, label, note, v) => `<button class="row ${v ? 'on' : ''}" role="switch" aria-checked="${v}" data-sw="${id}" style="grid-template-columns:1fr auto"><span><span class="name">${label}</span><span class="meta">${note}</span></span><span class="right"><span class="switch"></span></span></button>`;
    let keyed = [];
    const loadKeyed = async () => { try { keyed = await (await fetch('/api/cameras/keyed')).json(); draw(); } catch { /* static hosting: no key store */ } };
    const saveCams = async (cams) => {
      const res = await fetch('/api/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cams }) });
      if (!res.ok) throw new Error('save failed');
      await loadKeyed();
      // Reload the camera layer so the change shows up straight away.
      if (registry.get('cameras').enabled) { await setLayer('cameras', false, { persist: false }); setLayer('cameras', true, { persist: false }); }
    };
    const draw = () => {
      const top = body.scrollTop, k = keys();
      body.innerHTML = `
        <section class="group"><div class="group-head"><span class="eyebrow">Map</span></div>
          <div class="chips" style="padding:0 8px 8px">${BASEMAPS.map((b) => `<button class="chip" data-base="${b.id}" aria-pressed="${state.basemap === b.id}" data-tip="${b.desc}">${b.name}${b.key && !k.ion && !k.google ? `<span class="n">key</span>` : ''}</button>`).join('')}</div>
          ${sw('labels', 'Place labels', 'Borders and names over satellite imagery', state.labels)}
          ${sw('lighting', 'Day and night', 'Real sun position, city lights on the dark side', state.lighting)}</section>
        <section class="group"><div class="group-head"><span class="eyebrow">Display</span></div>
          ${sw('threeD', '3D aircraft', 'Glyphs become real airframes up close', state.threeD)}
          ${sw('bloom', 'Bloom', 'Soft glow on bright contacts', !!store.get('bloom', false))}
          ${sw('speak', 'Spoken replies', 'Argus answers voice commands out loud', store.get('speak', true))}
          <div class="field"><label>Sharpen <span>${Math.round(state.sharpen * 100)}%</span></label><input type="range" min="0" max="1" step="0.05" value="${state.sharpen}" data-r="sharpen"></div>
          <div class="field"><label>Detection density <span>${Math.round(state.density * 100)}%</span></label><input type="range" min="0" max="1" step="0.05" value="${state.density}" data-r="density"></div>
          <div class="field"><label>Units</label><div class="seg">${[['aviation', 'Aviation'], ['metric', 'Metric'], ['imperial', 'Imperial']].map(([id, n]) => `<button data-units="${id}" aria-pressed="${state.units === id}">${n}</button>`).join('')}</div></div></section>
        <section class="group" id="power-sec"><div class="group-head"><span class="eyebrow">Power up</span><span class="eyebrow">optional</span></div>
          <p class="note" style="padding-bottom:8px">Argus runs with no keys. These two free ones add more. They stay on this machine: the ion token in this browser, the AIS key in a local file.</p>
          ${KEYS.map((x) => `<div class="field"><label>${x.name} <span>${k[x.id] ? 'saved' : x.cost}</span></label><div style="display:flex;gap:6px"><input class="input mono" type="password" autocomplete="off" spellcheck="false" data-key="${x.id}" placeholder="${x.ph}" value="${esc(k[x.id] || '')}"><a class="btn" href="${x.url}" target="_blank" rel="noopener" data-tip="Get one">${icon('external', 15)}</a></div><span class="note" style="padding:0">${x.unlocks}</span></div>`).join('')}
          <div style="padding:8px"><button class="btn primary wide" data-a="save">${icon('bolt', 15)}Save keys</button></div></section>
        <section class="group"><div class="group-head"><span class="eyebrow">More camera networks</span><span class="eyebrow">${keyed.filter((x) => x.saved).length} of ${keyed.length} added</span></div>
          <p class="note" style="padding-bottom:8px">These road agencies publish their cameras free, but each asks you to register on its site and request a developer key. Paste a key here and that network joins the camera layer. Keys are stored in a local file on this machine only.</p>
          ${keyed.length ? keyed.map((x) => `<div class="field"><label>${esc(x.name)} <span>${x.saved ? 'added' : esc(x.region)}</span></label><div style="display:flex;gap:6px"><input class="input mono" type="password" autocomplete="off" spellcheck="false" data-cam="${x.code}" placeholder="${x.saved ? 'Key saved. Paste a new one to replace it' : 'Paste developer key'}"><a class="btn" href="${esc(x.signup)}" target="_blank" rel="noopener" data-tip="Get a key">${icon('external', 15)}</a>${x.saved ? `<button class="icon-btn" data-camdel="${x.code}" data-tip="Remove key" style="height:36px">${icon('trash', 15)}</button>` : ''}</div></div>`).join('') : '<p class="note">Start Argus with npm start to manage camera keys.</p>'}
          ${keyed.length ? `<div style="padding:8px"><button class="btn primary wide" data-a="savecams">${icon('cctv', 15)}Save camera keys</button></div>` : ''}</section>
        <section class="group"><div class="group-head"><span class="eyebrow">Keyboard</span></div><dl class="kv" style="padding:4px 8px">${SHORTCUTS.map(([a, b]) => `<dt><span class="kbd">${a}</span></dt><dd>${b}</dd>`).join('')}</dl></section>
        <section class="group"><div class="group-head"><span class="eyebrow">Data and credits</span></div>
          <dl class="kv" style="padding:4px 8px">${[...registry.values()].map((l) => `<dt>${esc(l.name)}</dt><dd>${esc(l.source)}</dd>`).join('')}${cameraNetworks().length ? `<dt>Camera networks</dt><dd>${esc(cameraNetworks().join(' · '))}</dd>` : ''}<dt>Terrain</dt><dd>Re:Earth Terrain (Mapterhorn)</dd><dt>Aircraft models</dt><dd><a href="/models/ATTRIBUTION.md" target="_blank">CC BY 4.0 creators</a></dd><dt>Globe engine</dt><dd>CesiumJS</dd></dl>
          <p class="note">Inspired by the open-source God's Eye View project. Argus is an independent interface over the same kind of public feeds. It is a viewer, not a surveillance tool: nothing here is classified, and some layers are simulated or estimated and say so.</p></section>`;
      body.querySelectorAll('input[type=range]').forEach(setRange);
      body.scrollTop = top;
    };
    body.addEventListener('click', async (e) => {
      const t = (s) => e.target.closest(s);
      let b;
      if ((b = t('[data-base]'))) { await setBasemap(b.dataset.base); return draw(); }
      if ((b = t('[data-units]'))) { set('units', b.dataset.units); store.set('units', state.units); return draw(); }
      if ((b = t('[data-sw]'))) {
        const id = b.dataset.sw;
        if (id === 'labels') setLabels(!state.labels);
        if (id === 'lighting') setLighting(!state.lighting);
        if (id === 'threeD') { set('threeD', !state.threeD); store.set('threeD', state.threeD); }
        if (id === 'bloom') setBloom(!store.get('bloom', false));
        if (id === 'speak') store.set('speak', !store.get('speak', true));
        return draw();
      }
      if ((b = t('[data-camdel]'))) { try { await saveCams({ [b.dataset.camdel]: '' }); toast('Key removed.'); } catch { toast('Could not remove the key. Is the Argus server running?', 'err'); } return; }
      if (t('[data-a="savecams"]')) {
        const cams = {};
        body.querySelectorAll('[data-cam]').forEach((i) => { if (i.value.trim()) cams[i.dataset.cam] = i.value.trim(); });
        if (!Object.keys(cams).length) return toast('Paste at least one key first.');
        try { await saveCams(cams); toast(`${Object.keys(cams).length === 1 ? 'Key' : 'Keys'} saved. The camera layer is reloading with the new network.`); } catch { toast('Could not save. Is the Argus server running?', 'err'); }
        return;
      }
      if (t('[data-a="save"]')) {
        const k = keys(), prevIon = k.ion;
        body.querySelectorAll('[data-key]').forEach((i) => { const v = i.value.trim(); if (v) k[i.dataset.key] = v; else delete k[i.dataset.key]; });
        store.set('keys', k);
        try { await fetch('/api/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aisstream: k.aisstream || '' }) }); } catch { /* static hosting: the AIS key simply has no effect */ }
        emit('keys');
        if (k.ion && k.ion !== prevIon) { toast('Token saved. Switching to Photoreal 3D.'); await setBasemap('google3d'); }
        else toast('Keys saved on this machine.');
        draw();
      }
    });
    body.addEventListener('input', (e) => {
      const r = e.target.closest('[data-r]');
      if (!r) return;
      setRange(r);
      set(r.dataset.r, +r.value);
      if (r.dataset.r === 'density') store.set('density', +r.value);
      r.closest('.field').querySelector('label span').textContent = Math.round(r.value * 100) + '%';
    });
    const offs = [on('state:basemap', draw), on('state:labels', draw), on('state:lighting', draw)];
    draw(); loadKeyed();
    return () => offs.forEach((f) => f());
  },
});
on('open:settings', () => { set('panel', 'settings'); setTimeout(() => document.getElementById('power-sec')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 320); });
