// Run with `pnpm --filter @orbit/app test`. The snapshot was checked module for module against toqr (an independent
// encoder, under @expo/cli) at level M with the same mask; versions 1, 3, 4 and 6 and UTF-8 text matched too.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { qr } from './qr.ts';

const TICKET = 'q7Hc2LmX9pRt4WzK8vNb3YsD6fJg1AeU'; // a ticket's 32-character QR code
const draw = (m: boolean[][]) => m.map((row) => row.map((d) => (d ? '#' : '.')).join(''));

test('a ticket code is a version 3 QR, matching the reference module for module', () => {
  assert.deepEqual(draw(qr(TICKET, 6)), [
    '#######.#..##..###....#######',
    '#.....#.#..#....####..#.....#',
    '#.###.#.##.#...##..#..#.###.#',
    '#.###.#..##.#...#..#..#.###.#',
    '#.###.#.###.#.#####...#.###.#',
    '#.....#..#.#...###..#.#.....#',
    '#######.#.#.#.#.#.#.#.#######',
    '.........##.##.##.#.#........',
    '#..#######.###...#####..#.###',
    '.##.##.#.#..##..#..###..#.#..',
    '...#######...#.##...#..###...',
    '...#.#.##.#..#..####..#.#...#',
    '##..#.#.#.#.##.##..##.#....#.',
    '..#.##.#####.##.#.#..#.####..',
    '..##.######..#..##.#..#..##.#',
    '#......#####...#..##.#..####.',
    '..#.#.#.##.##.#..#.##...#.#..',
    '##.###...#.####.#.#.##..####.',
    '##.####..#..#..#..####.######',
    '####.#..##....#.#.#...#.#.##.',
    '##.#..#..#.#.###.#.##########',
    '........#.###.#...###...##.#.',
    '#######.##.#..###..##.#.###..',
    '#.....#.#.#.#.#..#.##...##..#',
    '#.###.#.#.##.####.#######.###',
    '#.###.#.###..#.##..###.#.#..#',
    '#.###.#.....##.#..########.##',
    '#.....#....###..#..#...##.#.#',
    '#######.#..#...#.#..#.##.#...',
  ]);
});

test('picks a mask itself, grows with the text, and refuses what it can’t hold', () => {
  assert.equal(qr(TICKET).length, 29);
  assert.equal(qr('x').length, 21);
  assert.equal(qr('x'.repeat(106)).length, 41);
  assert.throws(() => qr('x'.repeat(107)), /at most 106/);
});
