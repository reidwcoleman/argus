// Argus boot.
import { initViewer, resetGlobe, setTilt, northUp, camInfo, viewer, lookAt } from './core/viewer.js';
import { state, set, on, emit, store } from './core/bus.js';
import { initSelect, deselect, current, select, currentInfo } from './core/select.js';
import { stopMotion } from './core/motion.js';
import { applyLink } from './core/share.js';
import { initStyles, STYLES, setBloom } from './fx/styles.js';
import { initDetect } from './fx/detect.js';
import { initHud } from './fx/hud.js';
import { setLayer, registry, enabledLayers } from './layers/base.js';
// Layers register themselves in panel order.
import './layers/flights.js';
import './layers/movement.js';
import './layers/satellites.js';
import './layers/launches.js';
import './layers/cameras.js';
import './layers/infra.js';
import './layers/events.js';
import './layers/news.js';
import './layers/weather.js';
import './layers/radio.js';
import './layers/ground.js';
// Panels register themselves in rail order.
import './ui/panel-layers.js';
import { showLauncher } from './ui/missions.js';
import { initShell } from './ui/shell.js';
import { initCard } from './ui/card.js';
import { initTools } from './ui/tools.js';
import './ui/director.js';
import './ui/settings.js';
import { initCockpit } from './ui/cockpit.js';
import { initCommand, ask } from './ui/command.js';

const line = (t) => { const b = document.getElementById('boot-line'); if (b) b.textContent = t; };

async function boot() {
  line('Waking the globe');
  await initViewer();
  state.style = store.get('style', 'normal');
  state.panel = store.get('panel', 'layers');
  state.units = store.get('units', 'aviation');
  state.density = store.get('density', 0.5);
  state.threeD = store.get('threeD', true);
  initStyles();
  if (store.get('bloom', false)) setBloom(true);
  initSelect();
  initShell();
  initCard();
  initCommand();
  initDetect();
  initHud();
  initCockpit();
  initTools();
  keyboard();
  on('reset', () => { stopMotion(); deselect(); resetGlobe(); });
  on('camera:end', () => { for (const L of enabledLayers()) L.onView?.(); });
  line('Tuning feeds');
  const linked = applyLink();
  if (!linked) for (const id of store.get('layers', [])) if (registry.has(id)) setLayer(id, true, { persist: false });
  requestAnimationFrame(() => document.getElementById('boot').classList.add('done'));
  if (!linked && !store.get('seen', false)) setTimeout(showLauncher, 700);
  window.argus = { state, set, emit, registry, setLayer, camInfo, select, ask, current, currentInfo, lookAt, get viewer() { return viewer; } };
}

function keyboard() {
  const panelKeys = { l: 'layers', w: 'weather', u: 'tools', m: 'missions' };
  addEventListener('keydown', (e) => {
    const t = e.target;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') {
      if (document.querySelector('.scrim')) return;
      if (state.cockpit) return emit('cockpit:exit');
      if (state.tool) return emit('tool:cancel');
      if (stopMotion()) return;
      if (current()) return deselect();
      if (state.panel) return set('panel', null);
      return;
    }
    if (state.cockpit && !/^[1-6]$/.test(k)) return emit('key', { k, e });
    if (k >= '1' && k <= '6') return set('style', STYLES[+k - 1].id);
    if (k === 'h') return set('hud', !state.hud);
    if (k === 'd') return set('detect', !state.detect);
    if (k === 'g') return emit('context:toggle');
    if (k === 't') return void setTilt(camInfo().pitch < -60);
    if (k === 'n') return void northUp();
    if (k === 'r') return emit('reset');
    if (k === 's') return emit('share');
    if (k === 'c') return emit('camera:nearest', null);
    if (panelKeys[k]) return set('panel', state.panel === panelKeys[k] ? null : panelKeys[k]);
    emit('key', { k, e });
  });
}
boot().catch((e) => { console.error(e); line('Could not start: ' + e.message); });
