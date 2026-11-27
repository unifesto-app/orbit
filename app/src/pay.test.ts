import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readdirSync } from 'node:fs';

import { checkoutCancelled, cleanVpa, directFinal, directOf, upiOnPhone, handleHints, vpaApp, isVpa, orderNext, PAY_SAYS, paidNext, payKey, payLabel, payName, payReady, prefillOf, refundSays, refundWord, UPI_APPS, verifyUpiId, WALLETS } from './pay.ts';

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

test('a typed UPI ID keeps only what UPI allows', () => {
  assert.equal(cleanVpa('Ravi.K_1-x@OkHdfcBank'), 'ravi.k_1-x@okhdfcbank');
  assert.equal(cleanVpa('ra😀vi @ybl🎉'), 'ravi@ybl');
  assert.equal(cleanVpa('ravi@ok.hdfc-bank'), 'ravi@okhdfcbank'); // the handle is letters and digits
  assert.equal(cleanVpa('ravi@@ybl@x'), 'ravi@yblx'); // one @
  assert.equal(cleanVpa('ravi'), 'ravi');
});

test('handle hints complete a typed name', () => {
  assert.deepEqual(handleHints(''), []);
  assert.deepEqual(handleHints('@'), []);
  assert.equal(handleHints('ravi')[0], 'ravi@ybl');
  assert.deepEqual(handleHints('ravi@ok'), ['ravi@okhdfcbank', 'ravi@oksbi', 'ravi@okicici', 'ravi@okaxis']);
  assert.deepEqual(handleHints('ravi@ybl'), []); // typed in full
});

test('a UPI ID shows the app its handle belongs to', () => {
  assert.equal(vpaApp('ravi@ybl'), 'phonepe');
  assert.equal(vpaApp('ravi@OkHdfcBank'), 'gpay');
  assert.equal(vpaApp('ravi@ptyes'), 'paytm');
  assert.equal(vpaApp('ravi@apl'), 'amazonpay');
  assert.equal(vpaApp('ravi@slc'), 'slice');
  assert.equal(vpaApp('ravi@wahdfcbank'), 'whatsapp');
  assert.equal(vpaApp('ravi@sbi'), undefined); // a bank's own: the @
  assert.equal(vpaApp('ravi'), undefined);
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

test('paying: what the sheet does with each answer', () => {
  const order = { orderId: 'order_1', amountPaise: 123600, keyId: 'rzp_test_x', already: false, breakdown: { pricePaise: 120000, feePaise: 3600, feeIncluded: false, amountPaise: 123600 } };
  const no = (status: number, error: string, message = 'No.') => ({ ok: false as const, status, error: { error, message } });
  // The order: opened; "already" said once for one this sheet didn't make, silent for its own; off; changed; down.
  assert.deepEqual(orderNext({ ok: true, data: order }, new Set()), { next: 'open', order });
  const again = { ...order, already: true };
  assert.deepEqual(orderNext({ ok: true, data: again }, new Set()), { next: 'already', order: again, say: PAY_SAYS.already });
  assert.deepEqual(orderNext({ ok: true, data: again }, new Set(['order_1'])), { next: 'open', order: again });
  assert.deepEqual(orderNext(no(503, 'paymentsOff'), new Set()), { next: 'again', say: PAY_SAYS.off });
  assert.deepEqual(orderNext(no(409, 'fewLeft', 'Sold out'), new Set()), { next: 'reread', say: 'Sold out' });
  assert.deepEqual(orderNext(no(0, 'offline', 'Can’t reach Orbit.'), new Set()), { next: 'again', say: 'Can’t reach Orbit.' });

  // Verify after Razorpay took it.
  const v = (status: string, bookingId: string | null = null, reason?: string) => ({ ok: true as const, data: { status, bookingId, reason } as never });
  assert.deepEqual(paidNext(v('paid', 'b1')), { next: 'ticket', bookingId: 'b1' });
  assert.deepEqual(paidNext(v('confirming')), { next: 'confirming', say: PAY_SAYS.confirming });
  assert.deepEqual(paidNext(v('refundPending', null, 'fewLeft')), { next: 'refunded', say: PAY_SAYS.refunded });
  assert.deepEqual(paidNext(v('refundPending', null, 'cancelled')), { next: 'refunded', say: 'This event was cancelled. We’ve refunded you in full.' });
  assert.deepEqual(paidNext(v('refunded', null, 'booked')), { next: 'refunded', say: 'You already have this ticket. We’ve refunded this payment in full.' });
  assert.deepEqual(paidNext(no(400, 'badSignature', 'If money left your account, we’ll confirm or refund it on our own.')), {
    next: 'again',
    say: 'If money left your account, we’ll confirm or refund it on our own.',
  });
  assert.deepEqual(paidNext(no(404, 'notFound')), { next: 'confirming', say: PAY_SAYS.confirming }); // any other 4xx
  assert.deepEqual(paidNext(no(0, 'offline')), { next: 'confirming', say: PAY_SAYS.confirming });
  assert.deepEqual(paidNext(no(502, 'server')), { next: 'confirming', say: PAY_SAYS.confirming });

  // The order's status after checkout closed: only an untaken order lets Pay go again.
  assert.deepEqual(paidNext(v('created'), 'dismissed'), { next: 'again', say: PAY_SAYS.dismissed });
  assert.deepEqual(paidNext(v('failed'), 'failed'), { next: 'again', say: PAY_SAYS.failed });
  assert.deepEqual(paidNext(v('paid', 'b2'), 'dismissed'), { next: 'ticket', bookingId: 'b2' });
  assert.deepEqual(paidNext(v('confirming'), 'dismissed'), { next: 'confirming', say: PAY_SAYS.confirming });
  // Still open at Razorpay: pending; no status at all (offline, 5xx, 429): unknown. Pay stays on the same order.
  assert.deepEqual(paidNext(v('pending'), 'dismissed'), { next: 'again', say: PAY_SAYS.pending });
  assert.deepEqual(paidNext(no(0, 'offline'), 'dismissed'), { next: 'again', say: PAY_SAYS.unknown });
  assert.deepEqual(paidNext(no(502, 'paymentsDown'), 'failed'), { next: 'again', say: PAY_SAYS.unknown });
  assert.deepEqual(paidNext(no(429, 'tooMany'), 'dismissed'), { next: 'again', say: PAY_SAYS.unknown });
  assert.equal(refundSays(undefined), 'We couldn’t give you this ticket, so we’ve refunded you in full.');
});

test('every UPI app has its own Android package and iOS shortcode', () => {
  assert.equal(new Set(UPI_APPS.map((a) => a.android)).size, UPI_APPS.length);
  assert.equal(new Set(UPI_APPS.flatMap((a) => a.ios)).size, UPI_APPS.flatMap((a) => a.ios).length);
});

test('the phone’s UPI apps map to ours, in our order', () => {
  const android = [{ appName: 'PhonePe', packageName: 'com.phonepe.app' }, { appName: 'Slice', packageName: 'indwin.c3.shareapp' }, { appName: 'GPay', packageName: 'com.google.android.apps.nbu.paisa.user' }];
  assert.deepEqual(upiOnPhone(android, 'android'), [
    { id: 'gpay', app: 'com.google.android.apps.nbu.paisa.user' },
    { id: 'phonepe', app: 'com.phonepe.app' },
  ]);
  // iOS: the SDK's { appName, shortcode }, or a bare name.
  const ios = [{ appName: { appName: 'PhonePe', shortcode: 'phonepe' } }, { appName: 'Google Pay' }, { appName: 'super.money' }];
  assert.deepEqual(upiOnPhone(ios, 'ios'), [
    { id: 'gpay', app: 'google_pay' },
    { id: 'phonepe', app: 'phonepe' },
    { id: 'supermoney', app: 'super' },
  ]);
  assert.deepEqual(upiOnPhone([], 'ios'), []);
});

test('a picked UPI app on this phone pays without the sheet', () => {
  const onPhone = [{ id: 'phonepe', app: 'com.phonepe.app' }];
  const o = { key: 'rzp_k', order_id: 'order_1', amount: 49900, description: 'Gig', email: 'a@b.in', contact: '+919999999999' };
  assert.deepEqual(directOf({ kind: 'upiApp', id: 'phonepe' }, onPhone, o), {
    key_id: 'rzp_k', order_id: 'order_1', amount: '49900', currency: 'INR', description: 'Gig', email: 'a@b.in', contact: '+919999999999',
    method: 'upi', '_[flow]': 'intent', upi_app_package_name: 'com.phonepe.app',
  });
  // The sheet: not a UPI app, not on the phone, can't tell, or no email / phone.
  assert.equal(directOf({ kind: 'card' }, onPhone, o), null);
  assert.equal(directOf({ kind: 'vpa', vpa: 'ravi@ybl' }, onPhone, o), null);
  assert.equal(directOf({ kind: 'upiApp', id: 'gpay' }, onPhone, o), null);
  assert.equal(directOf({ kind: 'upiApp', id: 'upi' }, onPhone, o), null);
  assert.equal(directOf({ kind: 'upiApp', id: 'phonepe' }, null, o), null);
  assert.equal(directOf(undefined, onPhone, o), null);
  assert.equal(directOf({ kind: 'upiApp', id: 'phonepe' }, onPhone, { ...o, email: '' }), null);
  assert.equal(directOf({ kind: 'upiApp', id: 'phonepe' }, onPhone, { ...o, contact: undefined }), null);
});

test('once the UPI app may have opened, the sheet never opens too', () => {
  assert.equal(directFinal({ description: 'anything' }, true, 'ios'), true);
  assert.equal(directFinal({ description: 'User Cancelled Payment' }, false, 'ios'), true);
  assert.equal(directFinal({ description: 'User pressed back button' }, false, 'ios'), true);
  assert.equal(directFinal({ code: 1, description: 'Something went wrong' }, false, 'ios'), false);
  assert.equal(directFinal(undefined, false, 'ios'), false);
  // Android: only Custom UI's pre-submit errors let the sheet retry; anything else is final.
  assert.equal(directFinal({ description: 'Failed to submit.' }, true, 'android'), false);
  assert.equal(directFinal({ description: 'Unable to start the payment.' }, true, 'android'), false);
  assert.equal(directFinal({ description: 'Payment failed' }, false, 'android'), true);
  assert.equal(directFinal(undefined, false, 'android'), true);
  assert.equal(checkoutCancelled({ code: 5, description: 'User pressed back button' }, 'android'), true);
});
