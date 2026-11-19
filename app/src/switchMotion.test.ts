import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { CARDS_AT, CARDS_FOR, EXIT, OPEN_END, ZOOM_TO, backdropOpacity, cardFrame, ringOpacity } from './switchMotion.ts';

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≉ ${b}`);

const OPEN = CARDS_AT + CARDS_FOR;

test('on the orbit: the current card is in front at full size, the others smaller and higher', () => {
  const [x, y, s, o] = cardFrame(0, 0, -1, 0, 100, 80, OPEN, 0);
  near(x, 0);
  near(y, 0);
  near(s, 1);
  near(o, 1);
  const side = cardFrame(1, 0, -1, 0, 100, 80, OPEN, 0);
  assert.ok(side[0] > 0 && side[1] < 0 && side[2] < 1);
});

test('opening: the other cards start behind the current one and come out to their places', () => {
  const first = cardFrame(1, 0, -1, 0, 100, 80, 0, 0);
  near(first[0], 0);
  near(first[1], 0);
  assert.ok(first[4] < cardFrame(0, 0, -1, 0, 100, 80, 0, 0)[4]); // behind it
  const later = cardFrame(1, 0, -1, 0, 100, 80, OPEN, 0);
  assert.ok(later[0] > 50);
});

test('the cards come out over the opening window and settle at its end', () => {
  const settled = (open: number) => cardFrame(1, 0, -1, 0, 100, 80, open, 0);
  // Still moving just before the end, settled at it.
  assert.ok(Math.abs(settled(OPEN_END - 0.05)[0] - settled(OPEN_END)[0]) > 0);
  near(settled(OPEN_END)[0], settled(OPEN_END + 1)[0]);
  // Untouched before the start.
  near(settled(0.1)[0], 0);
});

test('cards move only along the orbit, the short way round', () => {
  const rx = 100, lift = 80;
  for (const open of [0.2, 0.4, 0.6]) {
    for (const i of [1, 2]) {
      const [x, y] = cardFrame(i, 0, -1, 0, rx, lift, open, 0);
      // On the ellipse x = rx sin a, y = -lift (1 - cos a) / 2.
      const cos = 1 + (2 * y) / lift;
      near((x / rx) ** 2 + cos ** 2, 1);
    }
  }
  // The card at the third place (240°) comes out to the left, never round the back.
  assert.ok(cardFrame(2, 0, -1, 0, rx, lift, 0.4, 0)[0] < 0);
});

test('the exit: the picked card zooms out and fades, the others are pulled into it', () => {
  const picked = cardFrame(1, 1, 1, EXIT, 100, 80, OPEN, 0);
  near(picked[2], ZOOM_TO);
  near(picked[3], 0);
  const other = cardFrame(0, 1, 1, EXIT, 100, 80, OPEN, 0);
  near(other[0], 0);
  near(other[3], 0);
  assert.ok(other[4] < picked[4]); // behind the picked card
  near(ringOpacity(EXIT), 0);
  near(backdropOpacity(0), 1);
  near(backdropOpacity(EXIT), 0);
});

test('every constant comes before the worklets, which copy constants to the UI thread where they are defined', () => {
  const src = readFileSync(new URL('./switchMotion.ts', import.meta.url), 'utf8');
  assert.ok(src.lastIndexOf('\nexport const ') < src.indexOf("'worklet'"), 'a constant is declared below a worklet');
});
