import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mediaRatio, type TeamEvent } from '@orbit/contract';

import { bodyOf, centreCrop, detailsOf, detailsProblem, fixesOf, formOf, lastsLabel, paiseOf, placeHalf, priceLabel, saveable } from './editor.ts';

// A 90-minute event at a place found by search, with coordinates the form can't show.
const e = {
  title: 'Open Mic',
  category: 'comedy',
  startsAt: '2026-12-12T14:00:00.000Z',
  endsAt: '2026-12-12T15:30:00.000Z',
  place: { venue: 'Hall', address: 'Road 1', area: 'Jubilee Hills', city: 'Hyderabad', lat: 17.43, lng: 78.41, placeId: 'abc' },
  about: null,
} as unknown as TeamEvent;
const was = formOf(e);

test('untouched, nothing is sent; a title edit sends only the title', () => {
  assert.deepEqual(bodyOf(was, was), {});
  assert.ok(!saveable(was, was));
  assert.equal(was.minutes, 90);
  assert.deepEqual(bodyOf({ ...was, title: ' Open Mic Night ' }, was), { title: 'Open Mic Night' });
  assert.ok(saveable({ ...was, title: 'Open Mic Night' }, was));
});

test('a new start keeps the 90 minutes; a new length moves only the end', () => {
  assert.deepEqual(bodyOf({ ...was, startsAt: '2026-12-13T19:30:00+05:30' }, was), { startsAt: '2026-12-13T19:30:00+05:30', endsAt: '2026-12-13T15:30:00.000Z' });
  assert.deepEqual(bodyOf({ ...was, minutes: 120 }, was), { endsAt: '2026-12-12T16:00:00.000Z' });
  assert.equal(lastsLabel(90), '1 hr 30 min');
});

test('a retyped place goes whole, without coordinates; half of one is held back; blank about stays unsent', () => {
  assert.deepEqual(bodyOf({ ...was, venue: 'Big Hall' }, was), { place: { venue: 'Big Hall', address: 'Road 1', area: 'Jubilee Hills', city: 'Hyderabad' } });
  assert.ok(placeHalf({ ...was, area: ' ' }));
  assert.ok(!saveable({ ...was, area: '' }, was));
  const none = { ...was, venue: '', address: '', area: '' };
  assert.deepEqual(bodyOf(none, was), { place: null });
  assert.ok(saveable(none, was));
  assert.deepEqual(bodyOf({ ...was, about: '  ' }, was), {});
  assert.ok(!saveable({ ...was, title: '  ' }, was));
});

test('prices in whole rupees', () => {
  assert.equal(paiseOf(''), 0);
  assert.equal(paiseOf('0'), 0);
  assert.equal(paiseOf('499'), 49_900);
  assert.equal(paiseOf('1,000'), 100_000);
  assert.equal(paiseOf('10,00,000'), 100_000_000);
  assert.equal(paiseOf('1000001'), null);
  assert.equal(paiseOf('49.50'), null);
  assert.equal(paiseOf('-5'), null);
  assert.equal(priceLabel(0), 'Free');
  assert.equal(priceLabel(149_900), '₹1,499');
});

test('publish refusals as fixes', () => {
  assert.deepEqual(fixesOf(['poster', 'tickets']), ['Add a 3:4 poster.', 'Add at least one ticket type.']);
  assert.deepEqual(fixesOf(['later']), ['Something else is missing.']);
});

test('centreCrop cuts the biggest centred 3:4 or 4:3 box, and leaves a right shape alone', () => {
  assert.deepEqual(centreCrop(1200, 1200, 'poster'), { originX: 150, originY: 0, width: 900, height: 1200 });
  assert.deepEqual(centreCrop(1200, 1200, 'wide'), { originX: 0, originY: 150, width: 1200, height: 900 });
  assert.equal(centreCrop(900, 1200, 'poster'), null);
  assert.equal(centreCrop(1201, 900, 'wide'), null);
  const c = centreCrop(1080, 1920, 'wide')!;
  assert.equal(mediaRatio(c.width, c.height), '4:3');
});

// Comedy, with a hackathon key kept from before a category switch.
const d = { ...e, details: { language: 'Hindi', seating: 'Floor', teamMin: 2 }, inRoom: false, minAge: 18 } as unknown as TeamEvent;
const dw = formOf(d);

test('details: unchanged sends nothing; a comedy edit sends the comedy keys only; a cleared field drops its key', () => {
  assert.deepEqual(bodyOf(dw, dw), {});
  assert.equal(detailsProblem(dw), null);
  assert.deepEqual(bodyOf({ ...dw, language: ' English ' }, dw), { details: { language: 'English', seating: 'Floor' } });
  assert.deepEqual(bodyOf({ ...dw, seating: '  ' }, dw), { details: { language: 'Hindi' } });
  assert.ok(saveable({ ...dw, seating: '' }, dw));
});

test('details: a category switch alone sends no details; the kept key shows for its own category', () => {
  assert.deepEqual(bodyOf({ ...dw, category: 'hackathons' }, dw), { category: 'hackathons' });
  assert.deepEqual(detailsOf({ ...dw, category: 'hackathons' }), { teamMin: 2 });
  assert.deepEqual(detailsOf({ ...dw, category: null }), {});
});

test('details: hackathon lines parse; weights not adding to 100, or min over max, are refused in words', () => {
  const h = { ...dw, category: 'hackathons', teamMax: '4', tracks: 'AI | Build with models\n\n Web | Sites ', criteria: 'Idea | 40\nBuild | 60' };
  assert.deepEqual(detailsOf(h), {
    teamMin: 2,
    teamMax: 4,
    tracks: [{ name: 'AI', brief: 'Build with models' }, { name: 'Web', brief: 'Sites' }],
    criteria: [{ name: 'Idea', weight: 40 }, { name: 'Build', weight: 60 }],
  });
  assert.ok(saveable(h, dw));
  const off = { ...h, criteria: 'Idea | 40\nBuild | 50' };
  assert.ok(!saveable(off, dw));
  assert.equal(detailsProblem(off), 'The weights must add up to 100');
  assert.ok(!saveable({ ...h, criteria: 'Idea | lots' }, dw));
  assert.ok(!saveable({ ...h, teamMin: 'two' }, dw));
  const big = { ...h, teamMin: '5' };
  assert.ok(!saveable(big, dw));
  assert.equal(detailsProblem(big), "The smallest team can't be bigger than the biggest");
});

test('details: fests take a type and highlights, one per line', () => {
  const f = { ...dw, category: 'fests', festType: 'Music festival' as const, highlights: ' Main stage \n\nFood court' };
  assert.deepEqual(detailsOf(f), { festType: 'Music festival', highlights: ['Main stage', 'Food court'] });
});

test('inRoom goes only for meetups; minAge 18 to none is sent', () => {
  assert.deepEqual(bodyOf({ ...dw, inRoom: true }, dw), {});
  assert.deepEqual(bodyOf({ ...dw, category: 'meetups', inRoom: true }, dw), { category: 'meetups', inRoom: true });
  assert.deepEqual(bodyOf({ ...dw, minAge: null }, dw), { minAge: null });
  assert.ok(saveable({ ...dw, minAge: 21 }, dw));
});
