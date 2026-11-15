// QR codes, made on the phone so a ticket's QR shows with no signal (Booking doc: "It works offline in the app").
// Our own small encoder rather than a package: byte mode, error correction level M, versions 1 to 6 (up to 106
// bytes), which covers a ticket's 32-character code with room to spare. Follows ISO/IEC 18004, laid out as Project
// Nayuki's reference encoder does; checked module for module against toqr (qr.test.ts keeps a snapshot).
// ponytail: versions 7 and up need version-information bits; add them if a QR ever has to carry more than 106 bytes.

// Level M, per version: error correction codewords per block, and each block's data codewords.
const BLOCKS: readonly (readonly [number, readonly number[]])[] = [
  [10, [16]],
  [16, [28]],
  [26, [44]],
  [18, [32, 32]],
  [24, [43, 43]],
  [16, [27, 27, 27, 27]],
];
const ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34]]; // alignment pattern centres, per version

// Arithmetic in GF(256), modulo x^8 + x^4 + x^3 + x^2 + 1.
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a: number, b: number) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

// Reed-Solomon: the `n` error correction codewords for a block.
function correction(data: readonly number[], n: number) {
  let gen = [1]; // the generator polynomial, highest power first: the product of (x - a^i) for i below n
  for (let i = 0; i < n; i++) {
    const next = new Array<number>(gen.length + 1).fill(0);
    gen.forEach((c, j) => {
      next[j] ^= c;
      next[j + 1] ^= mul(c, EXP[i]);
    });
    gen = next;
  }
  const rem = new Array<number>(n).fill(0);
  for (const byte of data) {
    const factor = byte ^ (rem.shift() as number);
    rem.push(0);
    for (let j = 0; j < n; j++) rem[j] ^= mul(gen[j + 1], factor);
  }
  return rem;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

// The QR for `text` as rows of modules, true for dark, without the quiet zone. `mask` forces a mask (tests); otherwise
// the one with the lowest penalty is used.
export function qr(text: string, mask?: number): boolean[][] {
  const bytes = Array.from(new TextEncoder().encode(text));
  const v = BLOCKS.findIndex(([, blocks]) => sum(blocks) * 8 >= 12 + bytes.length * 8) + 1;
  if (!v) throw new Error(`Too long for a QR here: ${bytes.length} bytes, at most 106`);
  const [ec, blocks] = BLOCKS[v - 1];

  // The data: byte mode, the length, the bytes, a terminator, then padding to the version's capacity.
  const capacity = sum(blocks) * 8;
  const bits: number[] = [];
  const put = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, 8);
  bytes.forEach((b) => put(b, 8));
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((byte, bit) => (byte << 1) | bit, 0));

  // Split into blocks, add each block's correction, and interleave (every block is the same length up to version 6).
  const split = blocks.map((n, b) => data.slice(b * blocks[0], b * blocks[0] + n));
  const fixes = split.map((block) => correction(block, ec));
  const words: number[] = [];
  for (let i = 0; i < blocks[0]; i++) split.forEach((block) => words.push(block[i]));
  for (let i = 0; i < ec; i++) fixes.forEach((fix) => words.push(fix[i]));

  // The function patterns: timing lines, three finders, alignment patterns, and room for the format bits.
  const size = 17 + 4 * v;
  const dark = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, on: boolean) => {
    dark[y][x] = on;
    fixed[y][x] = true;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ])
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const [x, y, ring] = [cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy))];
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, ring !== 2 && ring !== 4);
      }
  const centres = ALIGN[v - 1];
  const last = size - 7;
  for (const ax of centres)
    for (const ay of centres) {
      if ((ax === 6 && ay === 6) || (ax === 6 && ay === last) || (ax === last && ay === 6)) continue; // under a finder
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  const format = (m: number) => {
    const info = m; // level M's two format bits are 00, then the mask
    let rem = info;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const word = ((info << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((word >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true); // the dark module
  };
  format(0);

  // The codewords, two columns at a time from the bottom right, zigzagging up and down, around the function patterns.
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip the vertical timing line
    for (let step = 0; step < size; step++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - step : step;
        if (!fixed[y][x] && i < words.length * 8) {
          dark[y][x] = ((words[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
  }

  const flip = (m: number) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fixed[y][x] && MASKS[m](x, y)) dark[y][x] = !dark[y][x];
  };
  let best = mask ?? 0;
  if (mask === undefined) {
    let least = Infinity;
    for (let m = 0; m < 8; m++) {
      flip(m);
      format(m);
      const p = penalty(dark);
      if (p < least) [least, best] = [p, m];
      flip(m);
    }
  }
  flip(best);
  format(best);
  return dark;
}

const sum = (ns: readonly number[]) => ns.reduce((a, b) => a + b, 0);

// The standard's four penalties: long runs, 2x2 blocks, finder-like patterns, and dark-light balance.
function penalty(m: boolean[][]) {
  const n = m.length;
  let score = 0;
  for (const line of [...m, ...m[0].map((_, x) => m.map((row) => row[x]))]) {
    let run = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && line[i] === line[i - 1]) run++;
      else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    const s = `0000${line.map((d) => (d ? '1' : '0')).join('')}0000`;
    for (const pattern of ['10111010000', '00001011101'])
      for (let at = s.indexOf(pattern); at !== -1; at = s.indexOf(pattern, at + 1)) score += 40;
  }
  let darkCount = 0;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      if (m[y][x]) darkCount++;
      if (y < n - 1 && x < n - 1 && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3;
    }
  return score + Math.max(0, Math.ceil(Math.abs(darkCount * 20 - n * n * 10) / (n * n)) - 1) * 10;
}
