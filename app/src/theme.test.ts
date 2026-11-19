import assert from 'node:assert/strict';
import { test } from 'node:test';

import { darkInkOn } from './theme.ts';

test("Home's location: Charcoal over a light poster's edge, Stone over a dark one, the wash included", () => {
  assert.equal(darkInkOn('#F7F3E8', 0.4), true); // cream
  assert.equal(darkInkOn('#FFD60A', 0.4), true); // yellow
  assert.equal(darkInkOn('#C6F432', 0.4), true); // lime
  assert.equal(darkInkOn('#12002B', 0.4), false); // deep violet
  assert.equal(darkInkOn('#F25C2A', 0.4), false); // orange: under the wash Stone still reads better
  assert.equal(darkInkOn('#F7F3E8', 1), false); // all wash is the ground itself
  assert.equal(darkInkOn('rgb(1, 2, 3)'), false); // not #rrggbb: Stone
});
