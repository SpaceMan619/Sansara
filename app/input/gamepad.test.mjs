/* Deadzone and brand-detection maths. Run with: node app/input/gamepad.test.mjs */
import { __test } from './gamepad.js';
const { readStick, detectBrand, DEAD } = __test;
let fail = 0;
const ok = (c, m) => { console.log(`${c ? '  ok  ' : '  FAIL'} ${m}`); if (!c) fail++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

const [cx, cy, cm] = readStick(0, 0);
ok(cx === 0 && cy === 0 && cm === 0, 'centred stick reads exactly zero');

const [, , jm] = readStick(DEAD * 0.99, 0);
ok(jm === 0, 'just inside deadzone reads zero');

const [, , fm] = readStick(1, 0);
ok(near(fm, 1), `full push on an axis reads 1.0 (got ${fm.toFixed(6)})`);

const d = Math.SQRT1_2;
const [dx, dy, dm] = readStick(d, d);
ok(near(dm, 1), `full push on the diagonal also reads 1.0 (got ${dm.toFixed(6)})`);
ok(near(Math.hypot(dx, dy), 1), 'diagonal output stays on the unit circle');

const [ox] = readStick(1.4, 1.4);   // real sticks overshoot the unit circle
ok(ox <= 1 + 1e-9, 'overshooting hardware is clamped, never exceeds 1');

const [, , half] = readStick(0.5 + DEAD * 0.5, 0);
ok(half > 0 && half < 1, 'partial tilt lands strictly between 0 and 1');

let rose = false, lastM = -1;
for (let i = 0; i <= 20; i++) {
  const [, , m] = readStick(i / 20, 0);
  if (m < lastM) rose = true;
  lastM = m;
}
ok(!rose, 'response curve is monotonic across the whole range');

ok(detectBrand('Xbox Wireless Controller') === 'xbox', 'xbox pad detected');
ok(detectBrand('Wireless Controller (STANDARD GAMEPAD Vendor: 054c)') === 'playstation', 'dualshock detected');
ok(detectBrand('Some Unknown Pad') === 'playstation', 'unknown pad falls back to playstation');

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
