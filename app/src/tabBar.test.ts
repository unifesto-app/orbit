import assert from 'node:assert/strict';
import { test } from 'node:test';

import { barAfterScroll, orbCentre, orbNudge } from './tabBar.ts';

test('the orb bubble fits its tab, the hour and the day, and varies with the roll', () => {
  const tuesdayNoon = new Date(2026, 10, 17, 13, 0); // a Tuesday afternoon: only the tab's own lines
  assert.equal(orbNudge('search', tuesdayNoon, 0), 'Can’t find it? Just ask me.');
  assert.equal(orbNudge('index', tuesdayNoon, 0.99), 'Not sure what to do? Ask me.');
  assert.notEqual(orbNudge('index', tuesdayNoon, 0), orbNudge('index', tuesdayNoon, 0.5));
  const saturdayNight = new Date(2026, 10, 21, 22, 30); // late, on a weekend: both extra lines join
  assert.equal(orbNudge('index', saturdayNight, 0.99), 'Weekend plans? I can help.');
  assert.equal(orbNudge('index', saturdayNight, 0.75), 'Still up? Ask me what’s on late.');
  assert.equal(orbNudge('index', new Date(2026, 10, 17, 9, 0), 0.99), 'Morning! Anything you’d like to do today?');
});

test('the chat orb sits at the far right of the bar, where the chat spreads from', () => {
  // iPhone 16: 402 x 874, a 34pt home indicator, so the bar is 22pt up; Android with 48pt of navigation, 60pt up.
  assert.deepEqual(orbCentre(402, 874, 34, true), { x: 360, y: 826 });
  assert.deepEqual(orbCentre(412, 915, 48, false), { x: 370, y: 829 });
});

test('the tab bar shrinks scrolling down, opens scrolling up or at the top, and ignores jitter', () => {
  assert.equal(barAfterScroll(300, 12), true);
  assert.equal(barAfterScroll(300, -12), false);
  assert.equal(barAfterScroll(20, 12), false); // near the top it stays open
  assert.equal(barAfterScroll(300, 2), null);
  assert.equal(barAfterScroll(-30, -5), false); // the bounce past the top
});
