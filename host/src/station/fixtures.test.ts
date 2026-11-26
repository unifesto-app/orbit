import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const src = join(import.meta.dirname, '..');

test('the fixtures stay test-only: no app file imports them', () => {
  const files = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((f) => /\.tsx?$/.test(f) && !/\.test\.ts$/.test(f));
  assert.ok(files.length > 20); // it really read the app
  const importers = files.filter((f) => /from\s+['"][^'"]*fixtures(\.ts)?['"]|import\(\s*['"][^'"]*fixtures/.test(readFileSync(join(src, f), 'utf8')));
  assert.deepEqual(importers, []);
});
