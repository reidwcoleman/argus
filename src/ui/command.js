// Command bar: keyless search, a command palette, and a natural-language operator you can type or speak to.
// The interpreter is local and deterministic: it only confirms actions that actually ran.
import { C, camInfo, flyTo, lookAt, setBasemap, northUp, setTilt, camera } from '../core/viewer.js';
import { state, set, on, emit, store } from '../core/bus.js';
import { el, $, ui, icon, toast } from './dom.js';
import { registry, setLayer, findLayer, enabledLayers } from '../layers/base.js';
import { searchPlaces, parseCoords } from '../data/places.js';
import { geocode, remoteSearch, boundary } from '../core/geocode.js';
import { select, current, currentInfo, startTracking, stopTracking, deselect } from '../core/select.js';
import { aircraftNear } from '../layers/flights.js';
import { passes, findSatellite } from '../layers/satellites.js';
import { radioNear, tune, stopRadio } from '../layers/radio.js';
import { STYLES, styleByName } from '../fx/styles.js';
import { inView } from '../fx/detect.js';
import { regionName } from '../fx/hud.js';
import { spin, orbit, stopMotion } from '../core/motion.js';
import { addShape, addBoundary, clearShapes, solveRoute, flyRoute, routeState } from './tools.js';
import { playScene, sceneNames } from './director.js';
import { setContext, runLaunch, runMission, showLauncher } from './missions.js';
import { jump } from './cockpit.js';
import { getJSON } from '../core/net.js';
import { distM, fmtDist, fmtAlt, compass, esc, bearing } from '../core/geo.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* ------------------------------------------------------------ number words */
const W = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
export function number(text) {
  const d = text.match(/(\d[\d,]*(?:\.\d+)?)\s*(k|thousand)?/i);
  if (d) return parseFloat(d[1].replace(/,/g, '')) * (d[2] ? 1000 : 1);
  let total = 0, cur = 0, hit = false;
  for (const w of text.toLowerCase().replace(/-/g, ' ').split(/\s+/)) {
    if (w in W) { cur += W[w]; hit = true; } else if (w === 'hundred') { cur = (cur || 1) * 100; hit = true; } else if (w === 'thousand') { total += (cur || 1) * 1000; cur = 0; hit = true; } else if (w === 'half') { cur = 50; hit = true; } else if (hit && w !== 'and') break;
  }
  return hit ? total + cur : null;
}
const KIND = [
  [/\b(military|mil)\b/, ['military'], 'military aircraft'], [/\b(flights?|planes?|aircraft|airplanes?|jets?|helicopters?|anything flying)\b/, ['flights', 'military'], 'aircraft'], [/\b(ships?|vessels?|boats?|tankers?)\b/, ['vessels'], 'vessels'],
  [/\b(satellites?|sats)\b/, ['satellites'], 'satellites'], [/\b(fires?|wildfires?|hotspots?)\b/, ['fires'], 'fire detections'], [/\b(earthquakes?|quakes?)\b/, ['earthquakes'], 'earthquakes'],
  [/\b(data ?cent(er|re)s?)\b/, ['datacenters'], 'datacenters'], [/\b(dams?)\b/, ['dams'], 'dams'], [/\b(cameras?|cctv)\b/, ['cameras'], 'cameras'], [/\b(launch(es)?|rockets?)\b/, ['launches'], 'launches'],
  [/\b(radio stations?|stations)\b/, ['radio'], 'radio stations'], [/\b(buses|trains|transit)\b/, ['transit'], 'transit vehicles'],
];
async function ensure(ids) {
  let waited = false;
  for (const id of ids) { const L = registry.get(id); if (L && !L.enabled) { await setLayer(id, true); waited = true; } }
  if (waited) for (let i = 0; i < 30 && ids.every((id) => !registry.get(id).count); i++) await sleep(400);
}
const contacts = (ids) => ids.flatMap((id) => (registry.get(id)?.enabled ? registry.get(id).contacts?.() || [] : []));
function inPoly(lat, lon, gj) {
  const polys = gj.type === 'Polygon' ? [gj.coordinates] : gj.type === 'MultiPolygon' ? gj.coordinates : null;
  if (!polys) return true;
  for (const p of polys) { const r = p[0]; let inside = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside; } if (inside) return true; }
  return false;
}

/* ------------------------------------------------------------ interpreter */
const SPLIT = /\s*(?:,?\s+and then\s+|,?\s+then\s+|,?\s+and\s+|;\s*)(?=(?:turn|switch|enable|disable|show|hide|select|track|enter|exit|play|orbit|rotate|zoom|fly|take|go|set|clear|draw|outline|stop|tune|open)\b)/i;
export async function interpret(input) {
  const parts = input.trim().replace(/[.!]+$/, '').split(SPLIT).filter(Boolean);
  const replies = [];
  for (const p of parts) { try { replies.push(await one(p.trim())); } catch (e) { console.warn(e); replies.push('That needed a feed that did not answer.'); } }
  return replies.filter(Boolean).join(' ');
}
async function one(raw) {
  const t = raw.toLowerCase().replace(/^(hey |ok |okay )?(argus|please)[, ]+/, '').replace(/\bplease\b/g, '').replace(/[?]+$/, '').trim();
  let m;
  if (!t) return '';
  if (/^(help|what can you do|what can i say)/.test(t)) return 'Try: take me to Tokyo. Turn on flights. Track the nearest plane. Switch to night vision. How many ships are in view. Outline Texas. How far is LAX from DFW.';

  /* map housekeeping */
  if (/^clear (the )?(map|annotations|drawings|whiteboard)/.test(t)) { clearShapes(); return 'Map cleared.'; }
  if (/^(stop|halt|freeze)( (rotating|orbiting|the rotation|spinning|moving))?$/.test(t)) { const a = stopMotion(); if (state.tracking) stopTracking(); return a ? 'Stopped.' : 'Nothing was moving.'; }
  if (/(zoom out to (a |the )?(globe|world|earth)|globe view|whole (earth|planet|world)|reset( the)? (globe|view|camera)|^reset$|go home)/.test(t)) { emit('reset'); return 'Back to the full Earth.'; }
  if (/^what('s| is) (turned )?on|which layers/.test(t)) { const on2 = enabledLayers(); return on2.length ? `On now: ${on2.map((l) => l.name).join(', ')}. Optic: ${state.style}.` : 'No layers are on.'; }

  /* camera verbs */
  if ((m = t.match(/^(rotate|spin)( the)? (globe|earth|planet|world)(.*)$/))) { const left = /left|west|counter/.test(m[4]), sp = /slow/.test(m[4]) ? 1.5 : /fast|quick/.test(m[4]) ? 12 : 4; return spin(left ? -1 : 1, sp) ? `Rotating the globe ${left ? 'left' : 'right'}. Any click stops it.` : 'Zoom out further first: rotation works from above 1,500 km. Say "zoom out to a globe view".'; }
  if (/^orbit/.test(t)) return orbit(/slow/.test(t) ? 2.5 : /fast/.test(t) ? 14 : 6) ? 'Orbiting this point. Any click stops it.' : 'Point the camera at the ground first.';
  if (/^zoom (in|closer)|^closer$/.test(t)) { const c = camInfo(); if (c.onGlobe) lookAt({ lat: c.clat, lon: c.clon, range: Math.max(300, c.range * 0.4), heading: c.heading, pitch: c.pitch, duration: 1.2 }); return 'Closer.'; }
  if (/^zoom out|^(pull|back) (back|out)/.test(t)) { const c = camInfo(); if (c.onGlobe) lookAt({ lat: c.clat, lon: c.clon, range: Math.min(2.5e7, c.range * 2.6), heading: c.heading, pitch: c.pitch, duration: 1.2 }); return 'Pulled back.'; }
  if (/north up|face north/.test(t)) { northUp(); return 'North is up.'; }
  if (/(straight down|top.?down|look down)/.test(t)) { setTilt(false); return 'Looking straight down.'; }
  if (/^tilt|oblique/.test(t)) { setTilt(true); return 'Tilted to a 35 degree oblique.'; }

  /* optics, display */
  if ((m = t.match(/^(switch|change|go|set)( the)?( view| optic| style| mode)? to (.+)$/)) || (m = t.match(/^(use|enable|turn on) (night vision|nvg|thermal|flir|infrared|crt|noir|cel shading|normal view)()()$/))) {
    const what = m[4] || m[2];
    const st = styleByName(what);
    if (st) { set('style', st); return `Optic: ${STYLES.find((s) => s.id === st).name}.`; }
    if (/tactical|hud/.test(what)) { set('hud', true); return 'Tactical layout on.'; }
    const base = /osm|street/.test(what) ? 'osm' : /dark/.test(what) ? 'dark' : /satellite|imagery|esri/.test(what) ? 'satellite' : /city lights|night lights|black marble/.test(what) ? 'night' : /3d|photoreal|google/.test(what) ? 'google3d' : null;
    if (base) { await setBasemap(base); return state.basemap === base ? `Map: ${base}.` : 'That map needs a key. I opened Power Up.'; }
  }
  if (/sharpen/.test(t)) { set('sharpen', Math.min(1, state.sharpen + (/lot|more|much/.test(t) ? 0.4 : 0.2))); return `Sharpening at ${Math.round(state.sharpen * 100)} percent.`; }
  if ((m = t.match(/detection density (?:to )?(.+)/))) { const n = number(m[1]); if (n != null) { set('density', Math.max(0, Math.min(1, n / 100))); set('detect', true); return `Detection density ${Math.round(state.density * 100)} percent.`; } }
  if ((m = t.match(/^(turn on|turn off|enable|disable|show|hide|toggle)( the)? (hud|heads.?up display|tactical hud|detection( overlay| mesh)?|detect|viewsheds?|camera viewsheds?)/))) {
    const on2 = /turn on|enable|show/.test(m[1]) ? true : /toggle/.test(m[1]) ? null : false;
    if (/viewshed/.test(m[3])) { await setLayer('cameras', true); registry.get('cameras').setSub('viewshed', on2 ?? state.coverage !== 'viewshed'); return 'Camera viewsheds ' + (state.coverage === 'viewshed' ? 'on. They appear below 60 km.' : 'off.'); }
    const key = /hud|heads/.test(m[3]) ? 'hud' : 'detect';
    set(key, on2 ?? !state[key]); return `${key === 'hud' ? 'HUD' : 'Detection'} ${state[key] ? 'on' : 'off'}.`;
  }

  /* staged pictures, scenes, missions */
  if (/global (infrastructure|context)|whole picture|situational picture/.test(t)) { await setContext(true, /infrastructure/.test(t) ? ['cables', 'datacenters', 'dams', 'satellites'] : undefined); return 'Staged the global picture. Say "leave global context" for your view back.'; }
  if (/(leave|exit|close) global context/.test(t)) { await setContext(false); return 'Your view is back.'; }
  if ((m = t.match(/^play (.+)$/)) && !/radio|station|music|fm/.test(t)) { const name = sceneNames().find((n) => m[1].includes(n.toLowerCase())); if (name) { playScene(name); return ''; } const ms = runMission(m[1]); if (ms) return `Running ${ms}.`; }
  if (/show me (the )?space missions|space mission/.test(t)) { runLaunch('space'); return 'Space missions staged.'; }
  if (/^(run|start) (.+)/.test(t)) { const ms = runMission(t); if (ms) return `Running ${ms}.`; }

  /* layers */
  if ((m = t.match(/^(turn on|enable|show|activate|turn off|disable|hide|deactivate|toggle)( me)?( the| all)? (.+?)( layers?| feed)?$/))) {
    const off = /off|disable|hide|deactivate/.test(m[1]);
    const names = m[4].split(/\s*(?:,| and )\s*/);
    const done = [];
    for (const n of names) { const L = findLayer(n); if (L) { await setLayer(L.id, m[1] === 'toggle' ? !L.enabled : !off); done.push(L.name); } }
    if (done.length) return `${done.join(' and ')} ${off ? 'off' : 'on'}.`;
    if (off) return `I do not have a layer called ${m[4]}.`;
  }

  /* cockpit and contacts */
  if (/^(enter|open|go to)( the)? cockpit|^cockpit$|ride (it|along)/.test(t)) { if (!currentInfo()?.cockpit) return 'Track an aircraft first, then say "enter cockpit".'; emit('cockpit:enter'); return 'In the cockpit. Drag to look around.'; }
  if (/^(exit|leave)( the)? cockpit/.test(t)) { emit('cockpit:exit'); return 'Out of the cockpit.'; }
  if ((m = t.match(/^next (contact|aircraft|plane)(.*)$/))) { const f = /heli/.test(m[2]) ? 'helis' : /mil/.test(m[2]) ? 'mil' : /jet/.test(m[2]) ? 'jets' : 'all'; const c = jump(1, f); return c ? `Now on ${c.label}, ${fmtDist(c.d)} away.` : ''; }
  if ((m = t.match(/^(track|select|follow|lock onto?|pick)( the| that| a| an)? (.+)$/))) {
    const what = m[3];
    if (/^(it|this|that|that one)$/.test(what) || /^that (plane|aircraft|ship|one)/.test(what)) { if (!current()) return 'Nothing is selected. Click a contact, or say "track the nearest plane".'; startTracking(); return `Tracking ${currentInfo().title}.`; }
    if (/iss|space station|satellite/.test(what)) { await ensure(['satellites']); const s = findSatellite(what.replace(/satellite/, '').trim() || 'iss'); if (!s) return 'I could not find that satellite in the loaded classes.'; select('satellites', s.id, { track: true }); return `Tracking ${s.name}.`; }
    if (/(nearest|closest)/.test(what) || /(plane|aircraft|flight|helicopter|jet)/.test(what)) {
      await ensure(/mil/.test(what) ? ['military'] : ['flights']);
      const c = camInfo(), heli = /heli/.test(what), air = /airborne|flying/.test(what), mil = /mil/.test(what);
      let pick = null;
      for (let i = 0; i < 20 && !pick; i++) { pick = aircraftNear(c.clat, c.clon, 400, (o, k) => (!heli || k === 'heli') && (!air || !o.gnd) && (!mil || o.flags & 1))[0]; if (!pick) await sleep(500); }
      if (!pick) return `No ${heli ? 'helicopter' : 'aircraft'} is reporting within 400 km of this view.`;
      select(pick.L, pick.key, { track: true });
      return `Tracking ${pick.label}, ${pick.type || 'aircraft'}, ${pick.ground ? 'on the ground' : 'at ' + fmtAlt(pick.alt).join(' ')}.`;
    }
    if (/(ship|vessel|boat)/.test(what)) { await ensure(['vessels']); const c = camInfo(); const v = contacts(['vessels']).sort((a, b) => distM(c.clat, c.clon, a.lat, a.lon) - distM(c.clat, c.clon, b.lat, b.lon))[0]; if (!v) return 'No vessel is reporting here. The keyless feed covers the Baltic.'; select('vessels', v.key, { track: true }); return `Tracking ${v.label}.`; }
    // a callsign or name
    await ensure(['flights']);
    const q = what.replace(/\s+/g, '').toUpperCase();
    const hit = contacts(['flights', 'military', 'vessels']).find((x) => x.label.replace(/\s+/g, '').toUpperCase() === q) || contacts(['flights', 'military', 'vessels']).find((x) => x.label.toUpperCase().includes(what.toUpperCase()));
    if (hit) { select(hit.L, hit.key, { track: true }); return `Tracking ${hit.label}.`; }
    return `I cannot see "${what}" in the live feeds.`;
  }
  if (/^(deselect|release|stop tracking|unlock)/.test(t)) { deselect(); return 'Released.'; }

  /* whiteboard */
  if ((m = t.match(/^(how far|what(?:'s| is) the distance|distance)(?: is| between)? (?:it )?(?:from )?(.+?) (?:from|to|and) (.+)$/))) {
    const [a, b] = await Promise.all([geocode(m[2]), geocode(m[3])]);
    if (!a || !b) return `I could not place ${!a ? m[2] : m[3]}.`;
    const d = distM(a.lat, a.lon, b.lat, b.lon);
    addShape({ type: 'measure', name: `${a.name.split(' ')[0]} to ${b.name.split(' ')[0]}`, pts: [[a.lat, a.lon], [b.lat, b.lon]] });
    lookAt({ lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2, range: Math.max(3000, d * 2.2), pitch: -80, duration: 2 });
    return `${a.name} to ${b.name} is ${fmtDist(d)} in a straight line, bearing ${Math.round(bearing(a.lat, a.lon, b.lat, b.lon))} degrees.`;
  }
  if ((m = t.match(/^(outline|annotate|highlight|mark|circle)( the)?( state of| country of| city of)? (.+?)( and its grounds)?$/))) {
    const b = await boundary(m[4]).catch(() => null);
    if (!b) return `I could not find ${m[4]}.`;
    const s = b.geojson && /Polygon/.test(b.geojson.type) ? addBoundary(b.name, b.geojson) : addShape({ type: 'pin', name: b.name, pts: [[b.lat, b.lon]] });
    const span = Math.max(b.bbox.n - b.bbox.s, (b.bbox.e - b.bbox.w) * Math.cos(b.lat * Math.PI / 180)) * 111000;
    lookAt({ lat: (b.bbox.n + b.bbox.s) / 2, lon: (b.bbox.e + b.bbox.w) / 2, range: Math.max(700, span * 1.7), pitch: -75, duration: 2.2 });
    return s?.type === 'area' ? `Outlined ${b.name} along its real boundary.` : `${b.name} has no mapped boundary, so I pinned it.`;
  }
  if ((m = t.match(/(walking|driving|cycling|biking|bike|walk|drive)? ?route from (.+?) to (.+)$/)) || (m = t.match(/^directions? (?:from )?()(.+?) to (.+)$/))) {
    const mode = /walk/.test(m[1] || '') ? 'foot' : /cycl|bik/.test(m[1] || '') ? 'bike' : 'car';
    const [a, b] = await Promise.all([geocode(m[2]), geocode(m[3])]);
    if (!a || !b) return `I could not place ${!a ? m[2] : m[3]}.`;
    set('panel', 'tools');
    const r = await solveRoute({ lat: a.lat, lon: a.lon, name: a.name }, { lat: b.lat, lon: b.lon, name: b.name }, mode);
    return r ? `${mode === 'foot' ? 'Walking' : mode === 'bike' ? 'Cycling' : 'Driving'} route drawn: ${fmtDist(r.dist)}, about ${Math.round(r.dur / 60)} minutes. Say "fly the route".` : routeState().error || 'No route came back.';
  }
  if (/fly (the|that|this) (route|path)|^fly it$/.test(t)) return flyRoute() ? 'Flying the route. Click to take the camera back.' : 'Draw a route first: "draw the walking route from A to B".';

  /* radio */
  if (/(stop|pause|mute|turn off)( the)? (radio|music)/.test(t)) { stopRadio(); return 'Radio off.'; }
  if ((m = t.match(/(?:play|tune|put on|find)(?: me)?(?: in)?(?: to)?(?: a| an| some)? ?(.*?)(?:radio|station|fm)s?(?: station)?(?: near| in| from| around)? ?(.*)$/)) && /radio|station|fm/.test(t)) {
    const tag = (m[1] || '').replace(/\b(the|a|an|some|local|live)\b/g, '').trim();
    const where = m[2] ? await geocode(m[2]) : null;
    const c = camInfo(), lat = where?.lat ?? c.clat, lon = where?.lon ?? c.clon;
    const st = (await radioNear(lat, lon, tag).catch(() => []))[0];
    if (!st) return 'The station directory is not answering.';
    await setLayer('radio', true);
    tune(st);
    return `Tuning ${st.name}, ${st.country}, ${fmtDist(distM(lat, lon, st.lat, st.lon))} from ${where ? where.name : 'this view'}.`;
  }

  /* analyst questions */
  if (/^(what|which) (city|place|country|town) is (this|that)|^where (am i|is this|are we)/.test(t)) {
    const c = camInfo();
    if (!c.onGlobe) return 'The camera is looking at space.';
    try { const r = await getJSON(`https://nominatim.openstreetmap.org/reverse?lat=${c.clat}&lon=${c.clon}&format=jsonv2&zoom=${c.range < 3000 ? 17 : c.range < 60000 ? 12 : 8}`, { timeout: 9000 }); if (r.display_name) return `The view is centred on ${r.display_name.split(',').slice(0, 4).join(',')}, from ${fmtDist(c.range)} away.`; } catch { /* fall back to the bundled gazetteer */ }
    return `The view is centred near ${regionName(c.clat, c.clon)}.`;
  }
  if (/^what('s| is) (this|that|it)$|^(tell me about|describe) (this|that|it)$|^what am i looking at/.test(t)) {
    const i = currentInfo();
    if (!i) return `Nothing is selected. ${(await one('what city is this')).replace('The view', 'The view')}`;
    return `${i.title}: ${i.kind}${i.sub ? ', ' + i.sub : ''}. ${(i.stats || []).filter((s) => s[2]).map((s) => `${s[2]} ${s[0]}${s[1] ? ' ' + s[1] : ''}`).join(', ')}.`;
  }
  if ((m = t.match(/when (?:does|will|is) (?:the )?(.+?) (?:next )?(?:pass|fly|go|come|rise)(?:ing)? ?(?:over|overhead|by)?/))) {
    await ensure(['satellites']);
    const s = findSatellite(m[1]);
    if (!s) return `I could not find ${m[1]} among the loaded satellites.`;
    const c = camInfo(), ps = passes(s.id, c.clat, c.clon, 2);
    if (!ps.length) return `${s.name} does not rise above 10 degrees over ${regionName(c.clat, c.clon)} in the next 24 hours.`;
    const p = ps[0], f = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${s.name} next passes over ${regionName(c.clat, c.clon)} at ${f(p.rise)}: peak ${Math.round(p.maxEl)} degrees at ${f(p.peak)}, setting ${f(p.set)}. ${p.visible ? 'It should be visible to the naked eye.' : 'It will not be visible: the sky is too bright or it is in shadow.'} Times are for the centre of the view.`;
  }
  if ((m = t.match(/(?:biggest|largest|strongest|most intense) (fire|earthquake|quake)(?: near| in| around)? ?(.*)$/))) {
    const fire = m[1] === 'fire', id = fire ? 'fires' : 'earthquakes';
    await ensure([id]);
    const where = m[2] ? await geocode(m[2].replace(/\b(right now|today|now)\b/g, '').trim()) : null;
    let list = fire ? registry.get('fires').all() : contacts(['earthquakes']);
    if (where) list = list.filter((x) => distM(where.lat, where.lon, x.lat, x.lon) < 400000);
    if (!list.length) return `No ${fire ? 'fire detections' : 'earthquakes'} ${where ? 'within 400 km of ' + where.name : 'loaded'}.`;
    const top = list.reduce((a, b) => ((fire ? b.frp > a.frp : b.mag > a.mag) ? b : a));
    select(id, top.key);
    return fire ? `The most intense detection ${where ? 'near ' + where.name : 'on Earth'} is ${Math.round(top.frp).toLocaleString()} megawatts, ${where ? fmtDist(distM(where.lat, where.lon, top.lat, top.lon)) + ' away' : 'in the ' + regionName(top.lat, top.lon) + ' area'}.` : `The strongest in the last day is magnitude ${top.mag.toFixed(1)}, ${top.place}.`;
  }
  if ((m = t.match(/which (ships?|vessels?)(?: are)? (?:headed|heading|going|bound|sailing) (?:to|for) (.+)$/))) {
    await ensure(['vessels']);
    const q = m[2].replace(/right now|now/, '').trim().toUpperCase();
    const hits = contacts(['vessels']).filter((v) => (v.dest || '').toUpperCase().includes(q));
    if (!hits.length) return `No vessel in the feed lists ${m[2]} as its destination. The keyless feed covers the Baltic.`;
    select('vessels', hits[0].key);
    return `${hits.length} ${hits.length === 1 ? 'vessel lists' : 'vessels list'} ${m[2]}: ${hits.slice(0, 4).map((v) => v.label).join(', ')}${hits.length > 4 ? ' and more' : ''}.`;
  }
  if ((m = t.match(/(?:anything|any ?one|aircraft|planes?|flights?)?.*(?:flying|fly|flights?) (above|over|below|under) (.+?) ?(feet|ft|meters|metres|m|km)?$/)) && number(m[2]) != null && /feet|ft|met|thousand|\d/.test(t)) {
    await ensure(['flights']);
    const n = number(m[2]), metres = /^m|met/.test(m[3] || '') ? n : /km/.test(m[3] || '') ? n * 1000 : n * 0.3048, above = /above|over/.test(m[1]);
    const hits = contacts(['flights', 'military']).filter((a) => !a.ground && (above ? a.alt > metres : a.alt < metres));
    if (!hits.length) return `Nothing is flying ${m[1]} ${n.toLocaleString()} ${m[3] || 'feet'} right now.`;
    const top = hits.reduce((a, b) => (above ? (b.alt > a.alt ? b : a) : b.alt < a.alt ? b : a));
    select(top.L, top.key, { fly: false });
    return `Yes: ${hits.length.toLocaleString()} aircraft are ${m[1]} ${n.toLocaleString()} ${m[3] || 'feet'}. The ${above ? 'highest' : 'lowest'} is ${top.label} at ${fmtAlt(top.alt).join(' ')}.`;
  }
  if ((m = t.match(/^how many (.+?)(?: are| is)?(?: there)?(?: currently| right now)? ?(in view|on screen|visible|over|above|in|near|around|within)? ?(.*)$/))) {
    const kind = KIND.find((k) => k[0].test(m[1]));
    if (kind) {
      await ensure(kind[1]);
      const area = (m[3] || '').replace(/\b(right now|now|currently|today|are there|the view|view)\b/g, '').trim();
      const fresh = kind[1].map((id) => registry.get(id)).filter((L) => L.status === 'stale').length ? ' That feed is on its last good data.' : '';
      if (!area || /in view|on screen|visible/.test(m[2] || '')) { const n = kind[1].reduce((a, id) => a + inView(id).length, 0), all = kind[1].reduce((a, id) => a + (registry.get(id).count || 0), 0); return `${n.toLocaleString()} ${kind[2]} in view, of ${all.toLocaleString()} loaded.${fresh}`; }
      if (/near|around|within/.test(m[2] || '')) { const g = await geocode(area); if (!g) return `I could not place ${area}.`; const n = contacts(kind[1]).filter((x) => distM(g.lat, g.lon, x.lat, x.lon) < 250000).length; return `${n.toLocaleString()} ${kind[2]} within 250 km of ${g.name}.${fresh}`; }
      const b = await boundary(area).catch(() => null);
      if (!b) return `I could not find an area called ${area}.`;
      const n = contacts(kind[1]).filter((x) => x.lat >= b.bbox.s && x.lat <= b.bbox.n && x.lon >= b.bbox.w && x.lon <= b.bbox.e && (!b.geojson || inPoly(x.lat, x.lon, b.geojson))).length;
      return `${n.toLocaleString()} ${kind[2]} over ${b.name} right now.${fresh}`;
    }
  }

  /* navigation: the most permissive rule, so it goes last */
  if ((m = t.match(/^(?:take me to|fly (?:me )?to|go to|navigate to|show me|zoom (?:in )?to|jump to|look at|find|search for|where is|where's)\s+(.+)$/)) || (m = [null, t])) {
    const q = m[1].replace(/^the planes overhead$/, '').trim();
    if (/planes? overhead|traffic overhead/.test(m[1])) { await setLayer('flights', true); const c = camInfo(); await lookAt({ lat: c.clat, lon: c.clon, range: 380000, pitch: -32, heading: c.heading, duration: 2 }); return 'Framed the traffic overhead.'; }
    const L = findLayer(q);
    if (L && q.split(' ').length <= 3 && !parseCoords(q) && !searchPlaces(q, 1).some((p) => p.score >= 100)) { await setLayer(L.id, true); return `${L.name} on.`; }
    const g = q ? await geocode(q) : null;
    if (g) { await lookAt({ lat: g.lat, lon: g.lon, range: g.range || 30000, pitch: g.range > 1e6 ? -85 : -45, duration: 2.4 }); return `${g.name}${g.where ? ', ' + g.where : ''}.`; }
    return m[0] === null ? `I did not find a command or a place in "${raw}". Try "take me to Tokyo" or "turn on flights".` : `I could not find ${q}. Try a fuller name or coordinates.`;
  }
  return '';
}

/* ---------------------------------------------------------------- palette */
const SENTENCE = /^(take|fly|go|show|turn|switch|enable|disable|hide|track|select|follow|enter|exit|leave|play|stop|orbit|rotate|spin|zoom|how|what|which|when|where|is|are|outline|annotate|draw|clear|set|measure|tune|next|reset|sharpen|north|tilt|help|run|directions|use|lock)\b/i;
function commands() {
  const list = [];
  for (const L of registry.values()) list.push({ icon: L.icon, t: `${L.enabled ? 'Turn off' : 'Turn on'} ${L.name}`, d: L.blurb, k: L.enabled ? 'on' : '', run: () => setLayer(L.id, !L.enabled) });
  STYLES.forEach((s, i) => list.push({ icon: 'eye', t: `Optic: ${s.name}`, d: s.tip, k: String(i + 1), run: () => set('style', s.id) }));
  list.push(
    { icon: 'home', t: 'Reset globe', d: 'Back to the full Earth', k: 'R', run: () => emit('reset') },
    { icon: 'globe', t: 'Global context', d: 'Stage the whole picture, then get your view back', k: 'G', run: () => emit('context:toggle') },
    { icon: 'crosshair', t: 'Toggle tactical HUD', d: 'Reticle, grid reference, scene read', k: 'H', run: () => set('hud', !state.hud) },
    { icon: 'scan', t: 'Toggle detection overlay', d: 'Brackets and IDs on contacts in view', k: 'D', run: () => set('detect', !state.detect) },
    { icon: 'share', t: 'Copy share link', d: 'Camera, layers and tracked target in one URL', k: 'S', run: () => emit('share') },
    { icon: 'pen', t: 'Draw on the map', d: 'Areas, lines, pins, measurements', run: () => set('panel', 'tools') },
    { icon: 'trash', t: 'Clear the map', d: 'Remove every annotation and route', run: () => clearShapes() },
    { icon: 'film', t: 'Scene director', d: 'Capture and play camera tours', run: () => set('panel', 'director') },
    { icon: 'target', t: 'Missions', d: 'Guided things to try', k: 'M', run: () => set('panel', 'missions') },
    { icon: 'cloud', t: 'Weather', d: 'Wind, radar, clouds, cyclones, air quality', k: 'W', run: () => set('panel', 'weather') },
    { icon: 'radio', t: 'Radio tuner', d: 'Sweep 750 stations across the planet', run: () => set('panel', 'radio') },
    { icon: 'news', t: 'News', d: 'Conflict and protest reports, mapped', run: () => set('panel', 'news') },
    { icon: 'sliders', t: 'Settings and Power up', d: 'Map, display, optional free keys', run: () => set('panel', 'settings') },
    { icon: 'sparkle', t: 'Show the start screen', d: 'Pick a first mission again', run: () => showLauncher() },
    { icon: 'cctv', t: 'Nearest public camera', d: 'To the selection, or the centre of the view', run: () => emit('camera:nearest', currentInfo()) },
  );
  for (const n of sceneNames()) list.push({ icon: 'play', t: `Play scene: ${n}`, d: 'Cinematic camera tour', run: () => playScene(n) });
  return list;
}

let input, pop = null, rows = [], idx = 0, seq = 0, mic, rec = null, listening = false, capEl = null, capTimer = null;
function caption(who, text, hold = 6500) {
  clearTimeout(capTimer);
  capEl?.remove();
  if (!text) return;
  capEl = el(`<div class="caption surface" role="status"><span class="who">${who}</span><span class="txt"></span></div>`);
  capEl.querySelector('.txt').textContent = text;
  ui().appendChild(capEl);
  capTimer = setTimeout(() => { capEl?.remove(); capEl = null; }, hold);
}
export async function ask(text, { spoken = false } = {}) {
  caption('YOU', text, 30000);
  const reply = await interpret(text);
  caption('ARGUS', reply || 'Done.', Math.max(5000, (reply || '').length * 70));
  if (spoken && reply && store.get('speak', true) && 'speechSynthesis' in window) { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(reply); u.rate = 1.06; u.pitch = 0.95; speechSynthesis.speak(u); }
  return reply;
}
function closePop() { pop?.remove(); pop = null; rows = []; }
function render() {
  if (!rows.length) return closePop();
  if (!pop) { pop = el('<div class="cmd-pop surface" role="listbox"></div>'); $('#cmd').appendChild(pop); pop.addEventListener('mousedown', (e) => { const r = e.target.closest('[data-i]'); if (r) { e.preventDefault(); exec(+r.dataset.i); } }); }
  let html = '', sec = '';
  rows.forEach((r, i) => { if (r.sec !== sec) { sec = r.sec; html += `<div class="cmd-sec eyebrow">${sec}</div>`; } html += `<button class="cmd-row" role="option" data-i="${i}" aria-selected="${i === idx}">${icon(r.icon, 17)}<span style="min-width:0"><div class="t">${esc(r.t)}</div><div class="d">${esc(r.d || '')}</div></span><span class="k">${esc(r.k || '')}</span></button>`; });
  pop.innerHTML = html;
  pop.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
}
function build(q) {
  const out = [], n = q.trim().toLowerCase();
  if (!n) {
    out.push(...[['Take me to Tokyo', 'pin'], ['Track the nearest plane', 'plane'], ['Switch to night vision', 'eye'], ['How many flights are in view', 'sparkle'], ['When does the ISS pass over next', 'sat'], ['Outline Texas', 'area']].map(([t, ic]) => ({ sec: 'Try saying', icon: ic, t, d: 'Run this', run: () => ask(t) })));
    out.push(...commands().filter((c) => /Reset|Global context|Missions|Copy share/.test(c.t)).map((c) => ({ ...c, sec: 'Commands' })));
    return out;
  }
  const c = parseCoords(q);
  if (c) out.push({ sec: 'Go to', icon: 'crosshair', t: `${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}`, d: 'Coordinates', run: () => lookAt({ lat: c.lat, lon: c.lon, range: 20000, pitch: -50 }) });
  const sentence = SENTENCE.test(n) && n.includes(' ');
  if (sentence) out.push({ sec: 'Ask Argus', icon: 'sparkle', t: q.trim(), d: 'Run as a command or question', k: '↵', run: () => ask(q.trim()) });
  for (const p of searchPlaces(q, sentence ? 2 : 5)) out.push({ sec: 'Go to', icon: p.kind === 'Airport' ? 'plane' : 'pin', t: p.name, d: `${p.kind} · ${p.where}`, run: () => lookAt({ lat: p.lat, lon: p.lon, range: p.range, pitch: -45 }) });
  const words = n.split(/\s+/);
  out.push(...commands().filter((x) => words.every((w) => (x.t + ' ' + (x.d || '')).toLowerCase().includes(w))).slice(0, 7).map((x) => ({ ...x, sec: 'Commands' })));
  if (!sentence && n.length > 2) out.push({ sec: 'Ask Argus', icon: 'sparkle', t: q.trim(), d: 'Run as a command or question', run: () => ask(q.trim()) });
  return out;
}
function refresh() {
  const q = input.value, my = ++seq;
  rows = build(q); idx = 0; render();
  if (q.trim().length > 2 && !parseCoords(q) && !(SENTENCE.test(q.trim()) && q.includes(' '))) {
    setTimeout(async () => {
      if (my !== seq) return;
      const r = await remoteSearch(q.trim(), 5);
      if (my !== seq || !pop) return;
      const have = new Set(rows.map((x) => x.t.toLowerCase()));
      const add = r.filter((p) => !have.has(p.name.toLowerCase())).map((p) => ({ sec: 'Places', icon: 'pin', t: p.name, d: `${p.kind}${p.where ? ' · ' + p.where : ''}`, run: () => lookAt({ lat: p.lat, lon: p.lon, range: p.range, pitch: p.range > 1e6 ? -85 : -45 }) }));
      if (add.length) { const at = rows.findIndex((x) => x.sec === 'Commands' || x.sec === 'Ask Argus'); rows.splice(at < 0 ? rows.length : at, 0, ...add); render(); }
    }, 280);
  }
}
function exec(i) {
  const r = rows[i];
  if (!r) return;
  input.value = ''; closePop(); input.blur();
  Promise.resolve(r.run()).catch((e) => { console.warn(e); toast('That did not work: a feed did not answer.', 'err'); });
}

/* ------------------------------------------------------------------ voice */
function startMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return toast('This browser has no speech recognition. Type the same sentence into the bar instead.', 'err');
  if (listening) return;
  rec = new SR();
  rec.lang = navigator.language || 'en-US'; rec.interimResults = true; rec.continuous = false;
  let finalText = '';
  rec.onresult = (e) => { let s = ''; for (const r of e.results) { s += r[0].transcript; if (r.isFinal) finalText = s; } caption('YOU', s, 20000); };
  rec.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Microphone access is blocked. Allow it in the address bar, or type instead.', 'err'); };
  rec.onend = () => { listening = false; mic.classList.remove('live'); if (finalText.trim()) ask(finalText.trim(), { spoken: true }); else if (capEl?.querySelector('.who')?.textContent === 'YOU') caption('', ''); };
  try { rec.start(); listening = true; mic.classList.add('live'); caption('YOU', 'Listening…', 15000); } catch { /* already started */ }
}
function stopMic() { try { rec?.stop(); } catch { /* not running */ } }

export function initCommand() {
  const box = $('#cmd');
  box.innerHTML = `${icon('search', 17)}<input type="text" aria-label="Search or command" placeholder="Search a place, or tell Argus what to do" autocomplete="off" spellcheck="false"><span class="kbd">⌘K</span><button class="mic" aria-label="Talk to Argus" data-tip="Talk to Argus" data-key="Space">${icon('mic', 17)}</button>`;
  input = $('input', box); mic = $('.mic', box);
  input.addEventListener('input', refresh);
  input.addEventListener('focus', refresh);
  input.addEventListener('blur', () => setTimeout(closePop, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(rows.length - 1, idx + 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, idx - 1); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (rows.length) exec(idx); else if (input.value.trim()) { const q = input.value.trim(); input.value = ''; input.blur(); ask(q); } }
    else if (e.key === 'Escape') { input.value = ''; closePop(); input.blur(); }
  });
  mic.onclick = () => (listening ? stopMic() : startMic());
  addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.focus(); input.select(); }
    const typing = ['INPUT', 'TEXTAREA'].includes(e.target.tagName);
    if (e.code === 'Space' && !typing && !e.repeat && !state.cockpit) { e.preventDefault(); startMic(); }
    if (e.key === '/' && !typing) { e.preventDefault(); input.focus(); }
  });
  addEventListener('keyup', (e) => { if (e.code === 'Space' && listening && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) setTimeout(stopMic, 250); });
  on('director:shot', (x) => { if (x) caption(x.scene.name.toUpperCase(), x.s.name, (x.s.dur + (x.s.hold || 0)) * 1000); else caption('', ''); });
  on('sat:passes', (info) => { if (info?.title) ask(`when does ${info.title} pass over next`); });
}
void C; void camera; void flyTo; void compass;
