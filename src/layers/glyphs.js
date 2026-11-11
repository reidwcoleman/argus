// Canvas-drawn map glyphs, cached per (shape, color, size). All shapes point north.
const SHAPES = {
  plane: 'M16 2C17.200 2 18 4 18 7L18 12L29 19L29 21.500L18 18L18 25L21.500 27.800L21.500 29.500L16 28L10.500 29.500L10.500 27.800L14 25L14 18L3 21.500L3 19L14 12L14 7C14 4 14.800 2 16 2Z',
  heavy: 'M16 1C17.600 1 18.600 3.500 18.600 7L18.600 11.500L31 20L31 23L18.600 19L18.600 25L22.500 28L22.500 30.500L16 29L9.500 30.500L9.500 28L13.400 25L13.400 19L1 23L1 20L13.400 11.500L13.400 7C13.400 3.500 14.400 1 16 1Z',
  light: 'M16 3C17 3 17.500 4.500 17.500 6.500L17.500 11L29 11.500L29 15L17.500 16L17 24L21 26L21 28L16 27.200L11 28L11 26L15 24L14.500 16L3 15L3 11.500L14.500 11L14.500 6.500C14.500 4.500 15 3 16 3Z',
  mil: 'M16 2L18 10L28 22L28 24.500L19 22.500L19.500 27L22 29L22 30L16 29L10 30L10 29L12.500 27L13 22.500L4 24.500L4 22L14 10Z',
  heli: 'M16 7C18.500 7 19.500 10 19.500 13.500C19.500 17 18 19 17 20L17 26.500L20 26.500L20 28.500L12 28.500L12 26.500L15 26.500L15 20C14 19 12.500 17 12.500 13.500C12.500 10 13.500 7 16 7Z',
  ship: 'M16 2C19 6 21 10 21 15L21 28C21 29 20 30 19 30L13 30C12 30 11 29 11 28L11 15C11 10 13 6 16 2Z',
  sat: 'M12.500 12.500H19.500V19.500H12.500ZM2 13.500H10.500V18.500H2ZM21.500 13.500H30V18.500H21.500Z',
  station: 'M14 6H18V26H14ZM3 9H12V13H3ZM20 9H29V13H20ZM3 19H12V23H3ZM20 19H29V23H20Z',
  tri: 'M16 5L27 25H5Z',
  diamond: 'M16 3L29 16L16 29L3 16Z',
  square: 'M6 6H26V26H6Z',
  rocket: 'M16 2C20 6 21 11 21 17L24 22L24 26L20 24L19 27L13 27L12 24L8 26L8 22L11 17C11 11 12 6 16 2Z',
  camera: 'M5 10H19L22 7H27V25H5Z',
  bus: 'M9 3H23C24.500 3 25 4 25 5.500V26.500C25 28 24.500 29 23 29H9C7.500 29 7 28 7 26.500V5.500C7 4 7.500 3 9 3Z',
  car: 'M11 5H21C22.500 5 23 6 23 7.500V24.500C23 26 22.500 27 21 27H11C9.500 27 9 26 9 24.500V7.500C9 6 9.500 5 11 5Z',
  flame: 'M16 3C17.500 9 24 12 24 19.500A8 8 0 0 1 8 19.500C8 16.500 9.500 14.500 11 13C11.500 15.500 13 16.500 14 17C13 12 14 7 16 3Z',
  pin: 'M16 30C16 30 26 20.500 26 13A10 10 0 0 0 6 13C6 20.500 16 30 16 30Z',
  tower: 'M14 12H18L21 30H11ZM16 3A5 5 0 1 1 15.990 3Z',
  hex: 'M16 3L27.300 9.500V22.500L16 29L4.700 22.500V9.500Z',
  paw: 'M16 28C11 28 8 25.500 8 22.500C8 19.500 12 15.500 16 15.500C20 15.500 24 19.500 24 22.500C24 25.500 21 28 16 28ZM7 13A2.500 3.200 0 1 1 6.990 13ZM13 8A2.500 3.200 0 1 1 12.990 8ZM19 8A2.500 3.200 0 1 1 18.990 8ZM25 13A2.500 3.200 0 1 1 24.990 13Z',
  bolt: 'M18 2L7 18H15L13 30L25 13H17Z',
  cyclone: 'M16 10A6 6 0 1 1 15.990 10ZM16 4C23 4 28 9 28 14L24 14C24 11 20.500 7.500 16 7.500ZM16 28C9 28 4 23 4 18L8 18C8 21 11.500 24.500 16 24.500Z',
};
const cache = new Map();
export function glyph(shape, color, size = 32, opts = {}) {
  const key = `${shape}|${color}|${size}|${opts.ring || ''}|${opts.fill ?? 1}`;
  if (cache.has(key)) return cache.get(key);
  const px = size * 2; // 2x for crisp downscale
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d');
  const s = px / 32;
  g.scale(s, s);
  g.lineJoin = 'round';
  if (shape === 'dot') {
    g.beginPath(); g.arc(16, 16, 9, 0, Math.PI * 2);
    g.fillStyle = color; g.fill();
    g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.75)'; g.stroke();
  } else if (shape === 'ring') {
    g.beginPath(); g.arc(16, 16, 12, 0, Math.PI * 2);
    g.lineWidth = 5; g.strokeStyle = 'rgba(0,0,0,0.55)'; g.stroke();
    g.lineWidth = 2.6; g.strokeStyle = color; g.stroke();
    g.beginPath(); g.arc(16, 16, 3.5, 0, Math.PI * 2); g.fillStyle = color; g.fill();
  } else if (shape === 'pulse') {
    const grad = g.createRadialGradient(16, 16, 2, 16, 16, 15);
    grad.addColorStop(0, color); grad.addColorStop(0.35, color); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = 0.9; g.fillStyle = grad; g.beginPath(); g.arc(16, 16, 15, 0, Math.PI * 2); g.fill();
  } else if (shape === 'reticle') {
    g.strokeStyle = color; g.lineWidth = 1.6; g.lineCap = 'round';
    for (const [a, b] of [[4, 4], [28, 4], [28, 28], [4, 28]]) {
      const dx = a < 16 ? 1 : -1, dy = b < 16 ? 1 : -1;
      g.beginPath(); g.moveTo(a, b + dy * 7); g.lineTo(a, b); g.lineTo(a + dx * 7, b); g.stroke();
    }
  } else {
    const p = new Path2D(SHAPES[shape] || SHAPES.diamond);
    g.lineWidth = 3.4; g.strokeStyle = 'rgba(0,0,0,0.8)'; g.stroke(p);
    g.fillStyle = color; g.fill(p);
    if (shape === 'heli') {
      g.strokeStyle = color; g.lineWidth = 1.6; g.lineCap = 'round';
      g.beginPath(); g.moveTo(4, 5); g.lineTo(28, 22); g.moveTo(28, 5); g.lineTo(4, 22); g.stroke();
    }
    if (shape === 'camera' || shape === 'pin') {
      g.fillStyle = 'rgba(0,0,0,0.7)'; g.beginPath(); g.arc(shape === 'pin' ? 16 : 13, shape === 'pin' ? 13 : 17.500, 4, 0, Math.PI * 2); g.fill();
    }
  }
  cache.set(key, c);
  return c;
}
