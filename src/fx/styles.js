// Optics: GLSL sensor looks applied over the whole live globe.
import { C, scene } from '../core/viewer.js';
import { state, on, set, store } from '../core/bus.js';

export const STYLES = [
  { id: 'normal', name: 'Normal', tip: 'Natural colour', swatch: 'linear-gradient(135deg,#3f7fb5,#2f6b3d 60%,#c9b27a)' },
  { id: 'crt', name: 'CRT', tip: 'Scanline monitor', swatch: 'repeating-linear-gradient(#7ad9c2 0 2px,#0b2b2a 2px 4px)' },
  { id: 'nvg', name: 'NVG', tip: 'Night vision', swatch: 'radial-gradient(circle at 40% 40%,#b9ff9c,#1f7a22 60%,#04200a)' },
  { id: 'flir', name: 'FLIR', tip: 'Thermal, ironbow palette', swatch: 'linear-gradient(135deg,#150a3a,#a3206b 40%,#ff8a1e 70%,#fff6c9)' },
  { id: 'noir', name: 'Noir', tip: 'High-contrast monochrome', swatch: 'linear-gradient(135deg,#f2f2f2,#6b6b6b 50%,#0b0b0b)' },
  { id: 'cel', name: 'Cel', tip: 'Inked, posterised', swatch: 'linear-gradient(135deg,#ffd166 0 33%,#ef476f 33% 66%,#26547c 66%)' },
];
export const HUD_TINT = { normal: '#d9f7c4', crt: '#9dffe6', nvg: '#c6ffb0', flir: '#ffe9c2', noir: '#f2f2f2', cel: '#fff3d6' };

const COMMON = `
uniform sampler2D colorTexture;
in vec2 v_textureCoordinates;
uniform float u_time;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec2 px() { return 1.0 / czm_viewport.zw; }
float sobel(vec2 uv) {
  vec2 p = px();
  float tl = luma(texture(colorTexture, uv + p * vec2(-1.0, 1.0)).rgb), t = luma(texture(colorTexture, uv + p * vec2(0.0, 1.0)).rgb), tr = luma(texture(colorTexture, uv + p * vec2(1.0, 1.0)).rgb);
  float l = luma(texture(colorTexture, uv + p * vec2(-1.0, 0.0)).rgb), r = luma(texture(colorTexture, uv + p * vec2(1.0, 0.0)).rgb);
  float bl = luma(texture(colorTexture, uv + p * vec2(-1.0, -1.0)).rgb), b = luma(texture(colorTexture, uv + p * vec2(0.0, -1.0)).rgb), br = luma(texture(colorTexture, uv + p * vec2(1.0, -1.0)).rgb);
  float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
  float gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
  return sqrt(gx * gx + gy * gy);
}
`;
const SHADERS = {
  crt: `${COMMON}
void main() {
  vec2 uv = v_textureCoordinates;
  vec2 cc = uv - 0.5;
  float d = dot(cc, cc);
  uv = uv + cc * d * 0.055;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { out_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float ab = 0.0016 + d * 0.004;
  vec3 c = vec3(texture(colorTexture, uv + vec2(ab, 0.0)).r, texture(colorTexture, uv).g, texture(colorTexture, uv - vec2(ab, 0.0)).b);
  c = mix(c, vec3(luma(c)) * vec3(0.72, 1.06, 0.98), 0.42);
  c = pow(c, vec3(0.92)) * 1.16;
  float lines = 0.84 + 0.16 * sin(uv.y * czm_viewport.w * 1.35);
  float mask = 0.94 + 0.06 * sin(uv.x * czm_viewport.z * 2.1);
  float roll = 0.985 + 0.015 * sin(uv.y * 9.0 - u_time * 2.4);
  c *= lines * mask * roll;
  c += (hash(uv * czm_viewport.zw + u_time) - 0.5) * 0.03;
  c *= smoothstep(0.86, 0.22, length(cc) * 1.08);
  out_FragColor = vec4(c, 1.0);
}`,
  nvg: `${COMMON}
void main() {
  vec2 uv = v_textureCoordinates;
  vec3 src = texture(colorTexture, uv).rgb;
  float l = luma(src);
  vec2 p = px() * 2.0;
  float glow = (luma(texture(colorTexture, uv + vec2(p.x, 0.0)).rgb) + luma(texture(colorTexture, uv - vec2(p.x, 0.0)).rgb) + luma(texture(colorTexture, uv + vec2(0.0, p.y)).rgb) + luma(texture(colorTexture, uv - vec2(0.0, p.y)).rgb)) * 0.25;
  l = pow(clamp(l * 1.9 + glow * 0.5, 0.0, 1.0), 0.74);
  float n = hash(floor(uv * czm_viewport.zw / 1.5) + floor(u_time * 24.0));
  l += (n - 0.5) * 0.11;
  vec3 c = vec3(0.10, 1.0, 0.24) * l + vec3(0.55, 0.9, 0.5) * pow(l, 5.0) * 0.5;
  vec2 cc = (uv - 0.5) * vec2(czm_viewport.z / czm_viewport.w, 1.0);
  c *= smoothstep(0.92, 0.48, length(cc));
  c *= 0.93 + 0.07 * sin(uv.y * czm_viewport.w * 0.9);
  out_FragColor = vec4(c, 1.0);
}`,
  flir: `${COMMON}
vec3 ironbow(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 a = vec3(0.02, 0.01, 0.10), b = vec3(0.42, 0.04, 0.50), c = vec3(0.90, 0.24, 0.26), d = vec3(1.0, 0.64, 0.10), e = vec3(1.0, 0.98, 0.84);
  if (t < 0.25) return mix(a, b, t / 0.25);
  if (t < 0.5) return mix(b, c, (t - 0.25) / 0.25);
  if (t < 0.78) return mix(c, d, (t - 0.5) / 0.28);
  return mix(d, e, (t - 0.78) / 0.22);
}
void main() {
  vec2 uv = v_textureCoordinates;
  vec3 src = texture(colorTexture, uv).rgb;
  // Warm things read hot: weight red, discount blue (water and sky run cold).
  float heat = dot(src, vec3(0.56, 0.42, 0.02)) + max(0.0, src.r - src.b) * 0.5;
  heat = smoothstep(0.03, 0.92, heat);
  heat += sobel(uv) * 0.16;
  heat += (hash(uv * czm_viewport.zw + floor(u_time * 30.0)) - 0.5) * 0.035;
  vec3 c = ironbow(heat);
  vec2 cc = uv - 0.5;
  c *= smoothstep(0.95, 0.35, length(cc));
  out_FragColor = vec4(c, 1.0);
}`,
  noir: `${COMMON}
void main() {
  vec2 uv = v_textureCoordinates;
  vec3 src = texture(colorTexture, uv).rgb;
  float l = luma(src);
  l = smoothstep(0.04, 0.82, l);
  l = mix(l, l * l * (3.0 - 2.0 * l), 0.75);
  l += (hash(uv * czm_viewport.zw + floor(u_time * 24.0)) - 0.5) * 0.085;
  vec2 cc = uv - 0.5;
  l *= smoothstep(1.0, 0.25, length(cc) * 1.15);
  out_FragColor = vec4(vec3(l) * vec3(1.0, 0.985, 0.96), 1.0);
}`,
  cel: `${COMMON}
void main() {
  vec2 uv = v_textureCoordinates;
  vec3 src = texture(colorTexture, uv).rgb;
  float l = luma(src);
  vec3 sat = mix(vec3(l), src, 1.75);
  vec3 q = floor(pow(clamp(sat, 0.0, 1.0), vec3(0.8)) * 5.0 + 0.5) / 5.0;
  float e = smoothstep(0.22, 0.6, sobel(uv));
  vec3 c = mix(q, vec3(0.04, 0.03, 0.08), e);
  out_FragColor = vec4(c, 1.0);
}`,
};
const SHARPEN = `${COMMON}
uniform float u_amount;
void main() {
  vec2 uv = v_textureCoordinates; vec2 p = px();
  vec3 c = texture(colorTexture, uv).rgb;
  vec3 n = texture(colorTexture, uv + vec2(0.0, p.y)).rgb + texture(colorTexture, uv - vec2(0.0, p.y)).rgb + texture(colorTexture, uv + vec2(p.x, 0.0)).rgb + texture(colorTexture, uv - vec2(p.x, 0.0)).rgb;
  out_FragColor = vec4(clamp(c + (c * 4.0 - n) * u_amount, 0.0, 1.0), 1.0);
}`;

let stage = null, sharp = null;
const t0 = performance.now();
const time = () => ((performance.now() - t0) / 1000) % 600;

function apply() {
  if (stage) { scene.postProcessStages.remove(stage); stage = null; }
  const src = SHADERS[state.style];
  if (src) stage = scene.postProcessStages.add(new C.PostProcessStage({ name: 'argus_' + state.style + '_' + Date.now(), fragmentShader: src, uniforms: { u_time: time } }));
  document.documentElement.style.setProperty('--hud', HUD_TINT[state.style] || HUD_TINT.normal);
  document.getElementById('vignette').style.opacity = state.style === 'normal' ? 0.55 : 0;
  store.set('style', state.style);
}
function applySharpen() {
  if (sharp) { scene.postProcessStages.remove(sharp); sharp = null; }
  if (state.sharpen > 0.01) {
    sharp = new C.PostProcessStage({ name: 'argus_sharpen_' + Date.now(), fragmentShader: SHARPEN, uniforms: { u_time: time, u_amount: () => state.sharpen } });
    scene.postProcessStages.add(sharp);
    // Keep the sensor look on top of the sharpened image.
    if (stage) apply();
  }
  store.set('sharpen', state.sharpen);
}
export function initStyles() {
  on('state:style', apply);
  on('state:sharpen', applySharpen);
  const saved = store.get('sharpen', 0);
  if (saved) set('sharpen', saved);
  if (state.style !== 'normal') apply(); else document.documentElement.style.setProperty('--hud', HUD_TINT.normal);
}
export function setBloom(v) {
  const b = scene.postProcessStages.bloom;
  b.enabled = !!v;
  if (v) { b.uniforms.contrast = 119; b.uniforms.brightness = -0.28; b.uniforms.delta = 1; b.uniforms.sigma = 2.6; b.uniforms.stepSize = 1.1; b.uniforms.glowOnly = false; }
  store.set('bloom', !!v);
}
export function styleByName(text) {
  const t = text.toLowerCase();
  if (/night vision|nvg|night-vision/.test(t)) return 'nvg';
  if (/flir|thermal|infrared|ironbow|heat/.test(t)) return 'flir';
  if (/crt|scanline|retro|monitor/.test(t)) return 'crt';
  if (/noir|black and white|monochrome/.test(t)) return 'noir';
  if (/cel|anime|cartoon|toon|inked/.test(t)) return 'cel';
  if (/normal|natural|default|regular|clear/.test(t)) return 'normal';
  return null;
}
