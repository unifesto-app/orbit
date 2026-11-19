import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isVpa, payKey, payLabel, payName, payReady, UPI_APPS } from './pay.ts';

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
  assert.equal(payLabel({ kind: 'netbanking', bank: 'HDFC' }), 'Pay with HDFC Bank');
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
  assert.equal(payName({ kind: 'netbanking', bank: 'SBIN' }), 'State Bank of India');
  assert.equal(payName({ kind: 'wallet', code: 'payzapp' }), 'PayZapp wallet');
});
