// Copies the prebuilt Cesium runtime into public/cesium so it is served as static files.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'node_modules/cesium/Build/Cesium');
const dst = path.join(root, 'public/cesium');
if (!existsSync(src)) { console.warn('[argus] cesium build not found, skipping copy'); process.exit(0); }
rmSync(dst, { recursive: true, force: true });
cpSync(src, dst, { recursive: true });
console.log('[argus] cesium runtime copied to public/cesium');
