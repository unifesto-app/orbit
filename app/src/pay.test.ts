import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readdirSync } from 'node:fs';

import { checkoutCancelled, isVpa, payKey, payLabel, payName, payReady, prefillOf, refundWord, UPI_APPS, verifyUpiId, WALLETS } from './pay.ts';

test('every UPI app and wallet has its logo file in assets/pay', () => {
  const have = new Set(readdirSync(new URL('../assets/pay', import.meta.url)).map((f) => f.replace(/\.\w+$/, '')));
  const ids = [...UPI_APPS.map((a) => a.id), ...WALLETS.map((w) => w.code)];
  assert.deepEqual(ids.filter((id) => !have.has(id)), []);
});

test('a UPI ID is name@bank', () => {
  assert.equal(isVpa('ravi.k@okhdfcbank'), true);
  assert.equal(isVpa(' ravi@ybl '), true); // trimmed
  assert.equal(isVpa('ravi'), false);
  assert.equal(isVpa('r@ybl'), false); // the name needs two characters
  assert.equal(isVpa('ravi@1bank'), false); // the bank starts with a letter
});

test('the pay bar says what was picked, or asks', () => {
  assert.equal(payLabel(), 'Choose how to pay');
  assert.equal(payLabel({ kind: 'upiApp', id: 'gpay' }), 'Pay with Google Pay');
  assert.equal(payLabel({ kind: 'vpa', vpa: 'ravi@ybl' }), 'Pay with ravi@ybl');
  assert.equal(payLabel({ kind: 'vpa', vpa: 'ravi' }), 'Add your UPI ID');
  assert.equal(payLabel({ kind: 'card' }), 'Pay with a card');
  assert.equal(payLabel({ kind: 'wallet', code: 'mobikwik' }), 'Pay with MobiKwik wallet');
});

test('one key per choice; the big three UPI apps lead', () => {
  assert.equal(payKey({ kind: 'vpa', vpa: 'anything' }), 'vpa');
  assert.notEqual(payKey({ kind: 'wallet', code: 'amazonpay' }), payKey({ kind: 'upiApp', id: 'amazonpay' }));
  assert.deepEqual(UPI_APPS.slice(0, 3).map((a) => a.name), ['Google Pay', 'PhonePe', 'Paytm']);
});

test('a pick is ready to pay unless it is a UPI ID that is not one yet', () => {
  assert.equal(payReady(), false);
  assert.equal(payReady({ kind: 'card' }), true);
  assert.equal(payReady({ kind: 'vpa', vpa: 'ravi' }), false);
  assert.equal(payReady({ kind: 'vpa', vpa: 'ravi@ybl' }), true);
  assert.equal(payName({ kind: 'wallet', code: 'payzapp' }), 'PayZapp wallet');
});

test('Razorpay says whose a UPI ID is, that there is none, or nothing', async () => {
  const real = globalThis.fetch;
  const answer = (body: unknown) => (globalThis.fetch = (async () => new Response(JSON.stringify(body))) as typeof fetch);
  try {
    answer({ success: true, customer_name: ' Ravi Kumar ' });
    assert.deepEqual(await verifyUpiId('ravi@ybl', 'rzp_test_x'), { name: 'Ravi Kumar' });
    answer({ success: false });
    assert.equal(await verifyUpiId('nobody@ybl', 'rzp_test_x'), 'invalid');
    answer({ error: { reason: 'invalid_vpa' } });
    assert.equal(await verifyUpiId('ravi@1', 'rzp_test_x'), 'invalid');
    answer({ error: { reason: 'server_error' } });
    assert.equal(await verifyUpiId('ravi@ybl', 'rzp_test_x'), null); // couldn't say, so not "no such ID"
    globalThis.fetch = (async () => { throw new Error('offline'); }) as typeof fetch;
    assert.equal(await verifyUpiId('ravi@ybl', 'rzp_test_x'), null);
    assert.equal(await verifyUpiId('ravi@ybl', ''), null); // no key yet
  } finally {
    globalThis.fetch = real;
  }
});

test('checkout: a closed sheet is not a failure; the pick opens its method; refund words', () => {
  assert.equal(checkoutCancelled({ code: 2, description: 'x' }, 'ios'), true);
  assert.equal(checkoutCancelled({ code: 0, description: 'x' }, 'android'), true);
  assert.equal(checkoutCancelled({ code: 2, description: 'Network error' }, 'android'), false);
  assert.equal(checkoutCancelled({ code: 1, reason: 'payment_cancelled' }, 'ios'), true);
  assert.equal(checkoutCancelled({ code: 1, description: 'Payment failed' }, 'ios'), false);
  assert.deepEqual(prefillOf({ kind: 'vpa', vpa: ' ravi@ybl ' }), { method: 'upi', vpa: 'ravi@ybl' });
  assert.deepEqual(prefillOf({ kind: 'upiApp', id: 'gpay' }), { method: 'upi' });
  assert.deepEqual(prefillOf({ kind: 'applePay' }), {});
  assert.deepEqual([refundWord('processed'), refundWord('failed'), refundWord('sent')], ['Refunded', 'Refund failed, retrying', 'Requested']);
});
