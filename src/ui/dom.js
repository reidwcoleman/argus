// Small DOM helpers.
import { icon } from './icons.js';
export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const ui = () => document.getElementById('ui');
export { icon };

/* tooltips for anything with data-tip (and optional data-key) */
let tipEl, tipTimer;
export function initTips() {
  tipEl = el('<div class="tip" role="tooltip"></div>');
  document.body.appendChild(tipEl);
  const show = (t) => {
    const r = t.getBoundingClientRect();
    tipEl.innerHTML = t.dataset.tip + (t.dataset.key ? `<span class="kbd">${t.dataset.key}</span>` : '');
    const side = t.dataset.side || (r.left < 80 ? 'right' : r.bottom > innerHeight - 90 ? 'top' : 'bottom');
    tipEl.classList.add('on');
    const w = tipEl.offsetWidth, hh = tipEl.offsetHeight;
    let x = r.left + r.width / 2 - w / 2, y = r.bottom + 8;
    if (side === 'right') { x = r.right + 8; y = r.top + r.height / 2 - hh / 2; }
    if (side === 'top') y = r.top - hh - 8;
    tipEl.style.left = Math.max(6, Math.min(innerWidth - w - 6, x)) + 'px';
    tipEl.style.top = Math.max(6, y) + 'px';
  };
  const hide = () => { clearTimeout(tipTimer); tipEl.classList.remove('on'); };
  document.addEventListener('pointerover', (e) => {
    const t = e.target.closest?.('[data-tip]');
    hide();
    if (t) tipTimer = setTimeout(() => show(t), 350);
  });
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('keydown', hide, true);
}

/* toasts */
let toastBox;
export function toast(text, kind = '') {
  if (!toastBox) { toastBox = el('<div class="toasts" aria-live="polite"></div>'); ui().appendChild(toastBox); }
  const t = el(`<div class="toast surface ${kind}">${icon(kind === 'err' ? 'alert' : kind === 'say' ? 'sparkle' : 'info', 16)}<span></span></div>`);
  t.querySelector('span').textContent = text;
  toastBox.appendChild(t);
  while (toastBox.children.length > 3) toastBox.firstChild.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 220); }, kind === 'err' ? 5200 : 3600);
}
export function setRange(input) {
  const p = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.setProperty('--p', p + '%');
}
