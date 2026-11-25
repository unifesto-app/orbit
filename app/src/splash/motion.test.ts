import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  BODIES,
  EXIT_END,
  INTRO_END,
  LAP,
  LOGO,
  POINTS,
  along,
  bodyFrame,
  glowOpacity,
  groundOpacity,
  letterFrame,
  logoOpacity,
  ringDrawn,
  ringsOpacity,
  scene,
  travelled,
} from './motion.ts';

const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} ≉ ${b}`);
const PHONES = [
  [320, 568],
  [375, 812],
  [430, 932],
];
const S = scene(375, 812);
const speed = (k: number, t: number, h = 1e-4) => (travelled(S, k, t + h) - travelled(S, k, t - h)) / (2 * h);

test('the word sits centred and inside the screen, its letters left to right', () => {
  for (const [w, h] of PHONES) {
    const s = scene(w, h);
    near(s.word.left + s.word.width / 2, w / 2);
    assert.ok(s.word.left >= 20 && s.word.left + s.word.width <= w - 20);
    for (let i = 1; i < s.letters.length; i++) assert.ok(s.letters[i].cx > s.letters[i - 1].cx);
    // The O's counter is inside the O's canvas, the zoom's pivot.
    assert.ok(s.o.originX > 0 && s.o.originX < s.letters[0].width && s.o.originY > 0 && s.o.originY < s.letters[0].height);
  }
});

test('each ring is one closed loop, drawn as a closed path, nearest at depth 1 and furthest at 0', () => {
  for (const g of S.rings) {
    assert.equal(g.x[0], g.x[POINTS]); // the last point is the first: no seam
    assert.equal(g.y[0], g.y[POINTS]);
    assert.ok(g.d.endsWith('Z'));
    assert.ok(g.length > 600);
    near(Math.max(...g.depth), 1, 1e-3);
    near(Math.min(...g.depth), 0, 1e-3);
  }
});

test('each ring closes exactly on its own start, as its body glides back through it', () => {
  for (let r = 0; r < S.rings.length; r++) {
    const k = BODIES.findIndex((b) => b.ring === r);
    const b = BODIES[k];
    const L = S.rings[r].length;
    const end = b.at + b.for;
    near(travelled(S, k, end), L, 1e-6); // a whole lap, no more, no less
    near(ringDrawn(S, r, end), L, 1e-6);
    assert.ok(ringDrawn(S, r, end - 0.05) < L); // not closed early
    const p = along(S, r, travelled(S, k, end));
    near(p[0], S.rings[r].x[0], 1e-6); // the body is at the ring's start
    near(p[1], S.rings[r].y[0], 1e-6);
    near(speed(k, end), L / LAP, 1e-2); // gliding through at cruising speed, not stopped
    assert.ok(end <= INTRO_END); // every ring closed by the end of the intro
  }
});

test('smooth: a body never stops, and its speed never jumps', () => {
  for (let k = 0; k < BODIES.length; k++) {
    const b = BODIES[k];
    const L = S.rings[b.ring].length;
    const cruise = L / LAP;
    const swell = (2 * (b.lap * L - cruise * b.for)) / b.for;
    const most = (swell * Math.PI) / b.for; // the swell's steepest change of speed, pt/s²
    near(speed(k, b.at + 1e-3), cruise, 0.5); // sets off at cruising speed, from where it is shown
    near(speed(k, b.at + b.for + 1e-3), cruise, 0.5); // and is back to it as the sweep ends
    let last = speed(k, b.at + 1e-3);
    for (let t = b.at + 0.01; t < b.at + b.for + 2; t += 0.01) {
      const v = speed(k, t);
      assert.ok(v >= cruise - 1e-6, 'slowed below cruising');
      assert.ok(Math.abs(v - last) <= most * 0.01 * 1.05 + 1e-3, `speed jumped at ${t.toFixed(2)}`);
      last = v;
    }
  }
});

test('the heart follows the spark round its drawn ring and ends opposite it', () => {
  const spark = BODIES.findIndex((b) => b.art === 'spark');
  const heart = BODIES.findIndex((b) => b.art === 'heartSmall');
  assert.equal(BODIES[heart].ring, BODIES[spark].ring);
  for (let t = BODIES[heart].at; t < INTRO_END + 4; t += 0.02) assert.ok(travelled(S, heart, t) <= ringDrawn(S, BODIES[spark].ring, t) + 1e-6);
  const L = S.rings[BODIES[spark].ring].length;
  near(travelled(S, spark, INTRO_END + 2) - travelled(S, heart, INTRO_END + 2), L / 2, 1e-6);
});

test('nothing shows before it arrives', () => {
  for (let k = 0; k < BODIES.length; k++) near(bodyFrame(S, k, 0, 0)[3], 0);
  for (let r = 0; r < S.rings.length; r++) near(ringDrawn(S, r, 0), 0);
  for (let i = 0; i < 5; i++) near(letterFrame(S, i, 0, 0)[3], 0);
  near(glowOpacity(0, 0), 0);
});

test('by the end of the intro the word has landed, every ring is drawn and no body rests on a letter', () => {
  for (const [w, h] of PHONES) {
    const s = scene(w, h);
    for (let i = 0; i < 5; i++) {
      const [x, y, sc, a] = letterFrame(s, i, INTRO_END, 0);
      near(x, 0);
      near(y, 0);
      near(sc, 1);
      near(a, 1);
    }
    for (let r = 0; r < s.rings.length; r++) near(ringDrawn(s, r, INTRO_END), s.rings[r].length);
    const word = s.word;
    for (let k = 0; k < BODIES.length; k++) {
      const [x, y, , a] = bodyFrame(s, k, INTRO_END, 0);
      assert.ok(a > 0.5, `${BODIES[k].art} not shown`);
      const r = BODIES[k].size * 20; // the symbol inside its padded canvas
      const onWord = x + r > word.left && x - r < word.left + word.width && y + r > word.top && y - r < word.top + word.height;
      assert.ok(!onWord, `${BODIES[k].art} rests on the word at ${w}`);
    }
  }
});

test('while loading the bodies keep riding their rings', () => {
  for (let k = 0; k < BODIES.length; k++) {
    const a = bodyFrame(S, k, INTRO_END, 0);
    const b = bodyFrame(S, k, INTRO_END + 4, 0);
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) > 20, `${BODIES[k].art} stayed put`);
  }
});

test('the exit: everything into the O, which comes to rest at the centre, then zooms out through its counter', () => {
  const run = INTRO_END + 3;
  for (let k = 0; k < BODIES.length; k++) {
    const f = bodyFrame(S, k, run, EXIT_END);
    near(f[0], S.o.x);
    near(f[1], S.o.y);
    near(f[3], 0);
    assert.equal(bodyFrame(S, k, run, 0.2)[4], 1); // pulled in behind the letters
  }
  for (let i = 1; i < 5; i++) near(letterFrame(S, i, run, 1)[3], 0);
  const o = letterFrame(S, 0, run, 1.2);
  near(S.o.x + o[0], 375 / 2); // the O's counter at the screen's centre
  near(S.o.y + o[1], 812 / 2);
  near(o[2], 1.6);
  near(o[4], 1); // the shadowless O has taken over
  // The zoom sets off from rest: barely grown just after it starts.
  assert.ok(letterFrame(S, 0, run, 1.25)[2] - 1.6 < 0.01);
  const end = letterFrame(S, 0, run, EXIT_END);
  assert.ok(end[2] > 40);
  near(end[3], 0);
  near(glowOpacity(run, EXIT_END), 0);
  near(groundOpacity(EXIT_END), 0);
});

test('the rings are gone before the ground starts to lift', () => {
  let lift = 0;
  while (groundOpacity(lift) === 1) lift += 0.01;
  near(ringsOpacity(lift - 0.01), 0);
});

test('the Unusual Studios wordmark is in by the end of the intro and gone before the ground starts to lift', () => {
  near(logoOpacity(0, 0), 0);
  near(logoOpacity(INTRO_END, 0), LOGO.opacity); // fully in while the intro's clock still runs, so it never stops part-way
  let lift = 0;
  while (groundOpacity(lift) === 1) lift += 0.01;
  near(logoOpacity(INTRO_END, lift - 0.01), 0); // never over Home
});

test('every constant comes before the worklets, which copy constants to the UI thread where they are defined', () => {
  const src = readFileSync(new URL('./motion.ts', import.meta.url), 'utf8');
  const first = src.indexOf("'worklet'");
  assert.ok(src.lastIndexOf('\nexport const ') < first, 'an exported constant is declared below a worklet');
  assert.ok(src.lastIndexOf('\nconst ') < first, 'a constant is declared below a worklet');
});
