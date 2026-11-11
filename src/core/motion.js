// Continuous camera verbs: spin the globe, orbit a point. Any pointer or wheel input stops them.
import { C, scene, camera, camInfo, viewer, groundNow } from './viewer.js';
import { emit } from './bus.js';

let off = null, kind = null;
export function stopMotion() {
  if (!off) return false;
  off(); off = null;
  if (kind === 'orbit') camera.lookAtTransform(C.Matrix4.IDENTITY);
  kind = null;
  scene.canvas.removeEventListener('pointerdown', stopMotion);
  scene.canvas.removeEventListener('wheel', stopMotion);
  emit('motion', null);
  return true;
}
function begin(k, fn) {
  stopMotion();
  kind = k;
  let last = performance.now();
  off = scene.preUpdate.addEventListener(() => { const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now; fn(dt); });
  scene.canvas.addEventListener('pointerdown', stopMotion);
  scene.canvas.addEventListener('wheel', stopMotion, { passive: true });
  emit('motion', k);
}
/** Spin Earth under the camera. dir: +1 east-to-west drift (globe turns right), -1 the other way. degPerSec at the equator. */
export function spin(dir = 1, degPerSec = 4) {
  if (camInfo().height < 1.5e6) return false;
  viewer.trackedEntity = undefined;
  begin('spin', (dt) => camera.rotate(C.Cartesian3.UNIT_Z, -dir * C.Math.toRadians(degPerSec) * dt));
  return true;
}
/** Orbit the point at the centre of the view. */
export function orbit(degPerSec = 6) {
  const c = camInfo();
  if (!c.onGlobe) return false;
  viewer.trackedEntity = undefined;
  const target = C.Cartesian3.fromDegrees(c.clon, c.clat, groundNow(c.clat, c.clon));
  let h = camera.heading;
  const pitch = Math.min(camera.pitch, C.Math.toRadians(-12)), range = Math.max(200, c.range);
  begin('orbit', (dt) => { h += C.Math.toRadians(degPerSec) * dt; camera.lookAt(target, new C.HeadingPitchRange(h, pitch, range)); });
  return true;
}
export const motionKind = () => kind;
