/* Control hints that follow whichever device is actually being used.

   Apps declare their controls once, as a binding table:

     [{ label: 'jump', key: 'space', pad: 'cross' }, ...]

   Both the hint bar and the input reading come from that table, so the HUD
   cannot end up advertising a button that was renamed months ago. */

/* Tinted so the face buttons read at a glance. Xbox pads get lettered pills
   rather than shapes, since its glyphs are letters on the hardware too. */
const GLYPHS = {
  playstation: {
    cross:    ['✕', 'ps-cross'],
    circle:   ['○', 'ps-circle'],
    square:   ['□', 'ps-square'],
    triangle: ['△', 'ps-triangle'],
    l1: ['L1'], r1: ['R1'], l2: ['L2'], r2: ['R2'],
    l3: ['L₃'], r3: ['R₃'],
    options: ['options'],
  },
  xbox: {
    cross:    ['A', 'xb-a'],
    circle:   ['B', 'xb-b'],
    square:   ['X', 'xb-x'],
    triangle: ['Y', 'xb-y'],
    l1: ['LB'], r1: ['RB'], l2: ['LT'], r2: ['RT'],
    l3: ['L₃'], r3: ['R₃'],
    options: ['menu'],
  },
};

/* Brand-independent. */
const SHARED = {
  lstick: ['◁▷'],
  rstick: ['R₃'],
  dpad:   ['←→'],
};

let device = 'keyboard';           // 'keyboard' | 'pad'
let brand = 'playstation';
const listeners = new Set();

function setDevice(next, nextBrand) {
  if (nextBrand) brand = nextBrand;
  if (next === device) return;
  device = next;
  for (const fn of listeners) fn(device, brand);
}

/* Connection state is the wrong signal: a pad can sit plugged in while you
   reach for the keyboard. Track what was last actually used. Chrome also
   withholds `gamepadconnected` until a button is pressed, so the first press
   is the real signal either way. */
addEventListener('keydown', () => setDevice('keyboard'));
addEventListener('gamepaddisconnected', () => setDevice('keyboard'));

export function notePadActivity(padBrand) { setDevice('pad', padBrand); }
export function activeDevice() { return device; }
export function activeBrand() { return brand; }
export function onDeviceChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function glyphFor(token) {
  const [text, cls] = SHARED[token] || GLYPHS[brand][token] || [token];
  return cls ? `<b class="glyph ${cls}">${text}</b>` : `<b class="glyph">${text}</b>`;
}

/* Renders a binding table for the active device. Bindings with no `pad` entry
   are keyboard-only and drop out of the pad hint bar rather than showing a
   control that does nothing. */
export function renderHints(bindings, sep = '<i class="sep"></i>') {
  const onPad = device === 'pad';
  return bindings
    .filter((b) => (onPad ? b.pad : b.key))
    .map((b) => `<span>${onPad ? glyphFor(b.pad) : `<b>${b.key}</b>`} ${b.label}</span>`)
    .join(sep);
}

/* Styling ships with the module so every world picks up the same glyph
   treatment without copying CSS around. */
export const HINT_CSS = `
.glyph{ font-weight:600; letter-spacing:.02em; }
.glyph.ps-cross{ color:#8ab4f8; }
.glyph.ps-circle{ color:#f28b82; }
.glyph.ps-square{ color:#f6a8d8; }
.glyph.ps-triangle{ color:#84d7a8; }
.glyph.xb-a{ color:#84d7a8; } .glyph.xb-b{ color:#f28b82; }
.glyph.xb-x{ color:#8ab4f8; } .glyph.xb-y{ color:#f7d774; }
`;

export function installHintCss(doc = document) {
  if (doc.getElementById('sansara-hint-css')) return;
  const el = doc.createElement('style');
  el.id = 'sansara-hint-css';
  el.textContent = HINT_CSS;
  doc.head.appendChild(el);
}
