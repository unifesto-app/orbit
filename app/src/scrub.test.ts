// Run with `pnpm --filter @orbit/app test`. Pins that no URL keeps its query string on its way to Sentry.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { scrubBreadcrumb, scrubEvent, scrubSpan, scrubTransaction } from './scrub.ts';

const URL = 'https://api.heyorbit.in/public/discover?lat=17.44&lng=78.35&city=Hyderabad';
const BARE = 'https://api.heyorbit.in/public/discover';

test('fetch breadcrumbs lose the query', () => {
  const b = scrubBreadcrumb({ category: 'fetch', data: { url: URL, method: 'GET', status_code: 200 } });
  assert.deepEqual(b.data, { url: BARE, method: 'GET', status_code: 200 });
});

test('an error event\'s breadcrumbs are scrubbed too', () => {
  const e = scrubEvent({ message: 'x', breadcrumbs: [{ message: `GET ${URL}`, data: { url: URL } }, { data: undefined }] });
  assert.equal(e.breadcrumbs![0]!.message, `GET ${BARE}`);
  assert.deepEqual(e.breadcrumbs![0]!.data, { url: BARE });
  assert.equal(scrubEvent({ message: 'y' }).message, 'y');
});

test('http spans lose the query in the description and the data', () => {
  const s = scrubSpan({ description: `GET ${URL}`, data: { 'http.url': URL, 'http.query': '?lat=17.44', 'url.full': URL, 'http.method': 'GET' } });
  assert.equal(s.description, `GET ${BARE}`);
  assert.deepEqual(s.data, { 'http.url': BARE, 'url.full': BARE, 'http.method': 'GET' });
});

test('transactions lose it too, in their spans and request', () => {
  const e = scrubTransaction({ transaction: `GET ${URL}`, spans: [{ description: `GET ${URL}`, data: { url: URL } }], request: { url: URL, query_string: 'lat=17.44' } });
  assert.equal(e.transaction, `GET ${BARE}`);
  assert.equal(e.spans![0]!.description, `GET ${BARE}`);
  assert.equal(e.spans![0]!.data.url, BARE);
  assert.equal(e.request!.url, BARE);
  assert.equal(e.request!.query_string, undefined);
});
