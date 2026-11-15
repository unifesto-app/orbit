// Run with `pnpm --filter @orbit/app test`. Keeps the splash's motion from drifting: rest states,
// the loader's rules, a few of GSAP's own values, and where each physics throw lands.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  BOX,
  EXIT_END,
  FPS,
  I,
  INTRO_END,
  INTRO_PROPS,
  LETTERS,
  MARK_H,
  MARK_W,
  SWAP_LEN,
  footerOpacity,
  groundOpacity,
  introPropFrame,
  letterFrame,
  nextSwap,
  O_ZOOM_TO,
  physics,
  splashLayout,
  swapPropFrame,
  WALLPAPER_DIM,
  wallpaperFrame,
} from './motion.ts';

const REST = [0, 0, 1, 1, 0, 1];
const IDLE = -1;
const near = (a: number, b: number, d: number, what: string) => assert.ok(Math.abs(a - b) <= d, `${what}: ${a} not within ${d} of ${b}`);
const rest = (v: number[], what: string) => v.forEach((x, k) => near(x, REST[k], 0.01, `${what}[${k}]`));
const shows = (v: number[]) => v[2] * v[5]; // scale × opacity

test('frame one is the bare ground: no letter, prop or footer shows', () => {
  LETTERS.forEach((_, i) => assert.equal(letterFrame(i, 0, IDLE, 0)[5], 0));
  INTRO_PROPS.forEach((_, k) => assert.equal(shows(introPropFrame(k, 0)), 0));
  assert.equal(footerOpacity(0, 0), 0);
});

test('every letter is at rest and every prop gone when the intro ends', () => {
  LETTERS.forEach((l, i) => rest(letterFrame(i, INTRO_END, IDLE, 0), l));
  INTRO_PROPS.forEach((p, k) => near(shows(introPropFrame(k, INTRO_END)), 0, 0.001, p.art));
});

test('letters match GSAP at sampled moments (same tracks as Unifesto)', () => {
  near(letterFrame(0, 0.95, IDLE, 0)[1], 1.968, 0.01, 'O (u), power3.out'); // Unifesto's spec value
  near(letterFrame(1, 0.95, IDLE, 0)[3], 1.138, 0.01, 'R (n), back.out(2.2)');
  near(footerOpacity(1.7, 0), 0.609, 0.01, 'footer');
});

test('physics follows GSAP: exact without friction, stepped and settling with it', () => {
  near(physics(1, 100, 0, 0), 100, 1e-9, 'constant velocity');
  near(physics(0.5, 0, 400, 0), 50, 1e-9, 'gravity: ½gt²');
  // With friction a throw slows to a stop at velocity/FPS × keep/friction (GSAP steps 30 a second).
  assert.equal(FPS, 30);
  near(physics(5, 600, 0, 0.1), (600 / FPS) * (0.9 / 0.1), 1e-3, 'friction settles');
  assert.ok(physics(0.25, 600, 0, 0.1) < 600 * 0.25, 'friction slows it');
});

test('a friction throw never jumps back between steps', () => {
  // At 1ms samples a forward throw only ever moves forward, by less than its launch speed allows.
  for (const [velocity, acceleration] of [[374.35, 0], [600, 400], [-201.18, 0]]) {
    const dir = Math.sign(velocity);
    let prev = 0;
    for (let ms = 1; ms <= 1500; ms++) {
      const x = physics(ms / 1000, velocity, acceleration, 0.15);
      const step = (x - prev) * dir;
      assert.ok(step >= -1e-9, `backwards at ${ms}ms: ${step}`);
      assert.ok(step <= (Math.abs(velocity) + Math.abs(acceleration)) / 1000 + 1e-9, `jumps at ${ms}ms: ${step}`);
      prev = x;
    }
  }
});

test('each throw lands where its comment says', () => {
  const flower = introPropFrame(0, 0.55); // its peak, 0.3s after launch
  near(flower[0], 0, 0.5, 'flower x at peak');
  near(flower[1], 0, 0.5, 'flower y at peak');
  const bolt = introPropFrame(4, 1.55); // settled, just before it shrinks away
  near(bolt[0], 0, 1.5, 'bolt x');
  near(bolt[1], 0, 1.5, 'bolt y');
  near(bolt[4], 0, 1, 'bolt spin');
  INTRO_PROPS.slice(1, 4).forEach((p, k) => assert.ok(introPropFrame(k + 1, p.at + 0.15)[1] < -10, `reel ${k} hops up`));
});

test('the loader: a random letter each time, never the I, never the one that just went', () => {
  let last = -1;
  for (let n = 0; n < 500; n++) {
    const next = nextSwap(last);
    assert.notEqual(next, I);
    assert.notEqual(next, last);
    assert.ok(next >= 0 && next < LETTERS.length);
    last = next;
  }
  assert.ok(letterFrame(1, INTRO_END, 0.1, 0)[5] < 1, 'lifting out');
  assert.equal(letterFrame(1, INTRO_END, 0.4, 0)[5], 0, 'out, its prop in its place');
  rest(letterFrame(1, INTRO_END, SWAP_LEN, 0), 'a finished clock is idle');
  assert.equal(swapPropFrame(0.1)[0], 0);
  near(swapPropFrame(0.5)[0], 1, 0.01, 'prop shows while its letter is out');
  near(swapPropFrame(0.8)[0], 0, 0.001, 'prop gone as its letter drops back');
  assert.equal(swapPropFrame(IDLE)[0], 0);
  assert.equal(swapPropFrame(SWAP_LEN)[0], 0);
});

test('a letter still landing from a swap settles before the collapse', () => {
  near(letterFrame(2, INTRO_END, 0.4, 0.12)[5], 1, 0.01, 'B back in view');
});

test('the word collapses into a centred O, which zooms out past the screen over Home', () => {
  // [x, y, scale, scaleY, rotate, opacity]
  const o = letterFrame(0, INTRO_END, IDLE, 0.8);
  near(o[0], MARK_W / 2 - (BOX[0].x + 0.494 * BOX[0].w), 0.1, "O's counter to the mark's centre");
  near(o[1], MARK_H / 2 - (BOX[0].y + 0.499 * BOX[0].h), 0.1, "O's counter level with the mark's centre");
  LETTERS.forEach((l, i) => i && assert.equal(letterFrame(i, INTRO_END, IDLE, 0.66)[5], 0, `${l} gone by the collapse's end`));
  let prev = 0;
  for (let out = 0.8; out <= EXIT_END; out += 0.01) {
    const scale = letterFrame(0, INTRO_END, IDLE, out)[2];
    assert.ok(scale >= prev - 1e-9, `the O only grows: shrank at ${out.toFixed(2)}`);
    prev = scale;
  }
  assert.equal(letterFrame(0, INTRO_END, IDLE, 1.1)[5], 1, 'the O shows while it zooms');
  const end = letterFrame(0, INTRO_END, IDLE, EXIT_END);
  near(end[2], O_ZOOM_TO, 0.01, 'zoomed out past the screen');
  near(end[5], 0, 1e-6, 'the O is gone at the end');
  // Its counter (from assets/splash/letter-o.svg: 364 of the O's 1149 units across) is wider than the widest phone.
  assert.ok((364 / 1149) * BOX[0].w * O_ZOOM_TO > 440, "the counter clears a phone's width");
  assert.equal(groundOpacity(EXIT_END), 0);
  near(wallpaperFrame(INTRO_END, EXIT_END)[1], 1.6, 0.01, 'wallpaper rushes past with the O');
});

test('the wallpaper settles in during the intro', () => {
  assert.equal(wallpaperFrame(0, 0)[0], 0);
  near(wallpaperFrame(1.5, 0)[0], WALLPAPER_DIM, 0.01, 'dimmed over the ground');
  near(wallpaperFrame(1.5, 0)[1], 1, 0.01, 'settled from 1.04');
});

test('splash SVGs use only elements react-native-svg draws', () => {
  const dir = new URL('../../assets/splash/', import.meta.url);
  const allowed = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'polygon', 'polyline', 'line', 'defs', 'clipPath', 'linearGradient', 'radialGradient', 'stop', 'use', 'symbol']);
  const files = readdirSync(dir).filter((f) => f.endsWith('.svg'));
  assert.ok(files.length >= 12, 'letters, props and footer are all there');
  for (const f of files) {
    const tags = [...readFileSync(new URL(f, dir), 'utf8').matchAll(/<([a-zA-Z][\w:-]*)/g)].map((m) => m[1]);
    const bad = tags.filter((t) => !allowed.has(t));
    assert.deepEqual(bad, [], `${f} has ${bad.join(', ')}`);
  }
});

test('the wallpaper covers the screen and the footer stays clear of the artist credit', () => {
  // [width, height, bottom inset] in pt
  const screens: Record<string, [number, number, number]> = {
    'iPhone SE': [375, 667, 0],
    'iPhone 15': [393, 852, 34],
    'iPad mini': [744, 1133, 20],
    'iPad 10.2': [810, 1080, 0],
    'iPad 13': [1032, 1376, 20],
    'iPad 13 landscape': [1376, 1032, 20],
  };
  for (const [name, [w, h, inset]] of Object.entries(screens)) {
    const { wallpaper, creditTop, footerBottom } = splashLayout(w, h, inset);
    assert.ok(wallpaper.width >= w - 0.01 && wallpaper.height >= h - 0.01, `${name}: wallpaper covers the screen`);
    near(wallpaper.left + wallpaper.width / 2, w / 2, 0.01, `${name}: wallpaper centred`);
    assert.ok(footerBottom > creditTop, `${name}: footer (${footerBottom}) above the credit (${creditTop})`);
    assert.ok(footerBottom >= inset + 30, `${name}: footer above the home indicator`);
  }
});
