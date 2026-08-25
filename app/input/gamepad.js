/* Gamepad reader shared by every Sansara world.

   Deliberately free of Three and Babylon imports so both engines can use the
   same file — the Vite experiments reach it by relative path and bundle it
   like any other module.

   Returns a snapshot rather than writing into a key map, because a key map
   throws away stick magnitude and analog movement is the whole point. */

const DEAD = 0.18;   // radial, see readStick
const CURVE = 1.6;   // >1 puts finer control near centre
const TRIGGER_DEAD = 0.06;

/* Standard Gamepad mapping. Face buttons are named PlayStation-side; the glyph
   layer in hints.js is what relabels them for other brands. */
const BUTTON = {
  cross: 0, circle: 1, square: 2, triangle: 3,
  l1: 4, r1: 5, l2: 6, r2: 7,
  share: 8, options: 9, l3: 10, r3: 11,
  up: 12, down: 13, left: 14, right: 15,
};

export const BUTTON_NAMES = Object.keys(BUTTON);

function detectBrand(id = '') {
  if (/xbox|xinput|045e/i.test(id)) return 'xbox';
  // Unrecognised pads fall back to PlayStation labels rather than showing
  // nothing, since a wrong-but-present hint still beats a blank one.
  return 'playstation';
}

/* Radial deadzone. A per-axis deadzone would let a stick pushed diagonally
   register as pure-axis movement near the threshold, which reads as the
   character refusing to walk diagonally at low tilt. */
function readStick(x, y) {
  const mag = Math.hypot(x, y);
  if (mag < DEAD) return [0, 0, 0];
  // Rescale so the deadzone edge is 0 and a full push is 1, then curve it.
  const t = Math.min(1, (mag - DEAD) / (1 - DEAD));
  const out = Math.pow(t, CURVE);
  return [(x / mag) * out, (y / mag) * out, out];
}

let prevButtons = [];
let frameSnapshot = null;
let warned = false;

/* pollPad() computes rising edges by diffing against the previous frame, so a
   second call in the same frame would swallow presses the first call already
   reported. Rather than throw — the worlds stop their render loop on any
   exception, which is a brutal punishment for a wiring mistake — the repeat
   call is served the snapshot already computed this frame and complains once. */
function reuseThisFrame() {
  if (frameSnapshot === null) return false;
  if (!warned) {
    warned = true;
    console.error('[sansara] pollPad() called more than once in a frame. Poll once per frame and share the snapshot; the extra calls are being served a cached read.');
  }
  return true;
}

function firstPad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const pad of pads) if (pad && pad.connected) return pad;
  return null;
}

export function pollPad() {
  if (reuseThisFrame()) return frameSnapshot;
  requestAnimationFrame(() => { frameSnapshot = null; });

  const pad = firstPad();
  if (!pad) { prevButtons = []; frameSnapshot = null; return null; }

  const held = pad.buttons.map((b) => b.pressed || b.value > 0.5);
  const was = prevButtons;
  prevButtons = held;

  const [moveX, moveY, moveMag] = readStick(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
  const [lookX, lookY] = readStick(pad.axes[2] ?? 0, pad.axes[3] ?? 0);
  const trigger = (i) => {
    const v = pad.buttons[i]?.value ?? 0;
    return v < TRIGGER_DEAD ? 0 : (v - TRIGGER_DEAD) / (1 - TRIGGER_DEAD);
  };

  frameSnapshot = {
    brand: detectBrand(pad.id),
    id: pad.id,
    moveX, moveY, moveMag,
    lookX, lookY,
    l2: trigger(BUTTON.l2),
    r2: trigger(BUTTON.r2),
    down: (name) => !!held[BUTTON[name]],
    pressed: (name) => !!held[BUTTON[name]] && !was[BUTTON[name]],
    anyPressed: () => held.some((h, i) => h && !was[i]),
  };
  return frameSnapshot;
}

/* Test seam: lets the deadzone maths be exercised without hardware. */
export const __test = { readStick, detectBrand, DEAD, CURVE };
