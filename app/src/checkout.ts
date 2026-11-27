// Razorpay's checkout, loaded on Pay, never on import: a build from before it (no native module) throws on importing it
// (NativeEventEmitter), which would take the whole sheet down, free Register too. Null there: paying waits for the
// rebuild. The event booking sheet and the Book a slot sheet both open it.
import * as Sentry from '@sentry/react-native';
import { AppState, NativeEventEmitter, NativeModules, Platform, TurboModuleRegistry } from 'react-native';

import { checkoutCancelled, directFinal, directOf, type FoundUpiApp, type OnPhone, type PayWith, upiOnPhone } from './pay';

export type Checkout = typeof import('react-native-razorpay').default;
export function razorpay(): Checkout | null {
  if (!TurboModuleRegistry.get('RNRazorpayCheckout') && !NativeModules.RNRazorpayCheckout) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('react-native-razorpay') as { default: Checkout }).default;
  } catch {
    return null;
  }
}

// Razorpay's Custom UI pays a picked UPI app without the sheet; builds before it have no native side (null). Its
// native module is called directly: the package's open() logs the payload (email, phone) and its answers drop every
// Razorpay::* listener app-wide, so our own subscriptions remove only themselves.
const customUi = () => NativeModules.RazorpayCustomui as { open(o: object): void; getAppsWhichSupportUpi(): void } | undefined;
const customEvents = () => new NativeEventEmitter(NativeModules.RazorpayEventEmitterCustom);
type Paid = { razorpay_payment_id: string; razorpay_order_id?: string; razorpay_signature?: string };

function payDirect(ui: NonNullable<ReturnType<typeof customUi>>, payload: object): Promise<Paid> {
  return new Promise((resolve, reject) => {
    const ev = customEvents();
    const subs: { remove(): void }[] = [];
    const end = () => subs.forEach((x) => x.remove());
    subs.push(
      ev.addListener('Razorpay::PAYMENT_SUCCESS', (d) => {
        end();
        resolve(d as unknown as Paid);
      }),
      ev.addListener('Razorpay::PAYMENT_ERROR', (e) => {
        end();
        reject(e);
      }),
    );
    try {
      ui.open({ ...payload, FRAMEWORK: 'react_native' });
    } catch (e) {
      end();
      reject(e);
    }
  });
}

let asked: Promise<OnPhone[] | null> | null = null;

/** This phone's UPI apps we know, asked once per launch; null = can't tell (older build, no answer in 4s), so every
 * app shows and Pay uses the sheet. Not through the library's getAppsWhichSupportUPI: when it answers it drops every
 * Razorpay::PAYMENT_* listener app-wide, an open sheet's included. Our own subscription removes only itself. */
export function installedUpi(): Promise<OnPhone[] | null> {
  if (!customUi()) return Promise.resolve(null);
  asked ??= new Promise<OnPhone[] | null>((resolve) => {
    const done = (apps: OnPhone[] | null) => {
      clearTimeout(timer);
      sub.remove();
      resolve(apps); // null stays for this launch: Pay mustn't wait 4s on every tap
    };
    const sub = customEvents().addListener('Razorpay::UPI_APPS', (res: { data?: FoundUpiApp[] }) =>
      done(upiOnPhone(res?.data ?? [], Platform.OS)),
    );
    const timer = setTimeout(() => done(null), 4000);
    customUi()!.getAppsWhichSupportUpi();
  }).catch(() => (asked = null)); // threw before asking: ask again next time
  return asked;
}

type Options = { key: string; order_id: string; amount: number; description?: string; prefill?: { name?: string; email?: string; contact?: string } };

/** Pays with Razorpay: the picked UPI app straight away when this phone has it (Custom UI), else the sheet. Resolves
 * with the signed payment; rejects when the payer cancels or the payment fails (the caller asks the API either way). */
export async function openCheckout(rp: Checkout, options: Options & Record<string, unknown>, pay?: PayWith) {
  const ui = pay?.kind === 'upiApp' ? customUi() : null;
  const direct = ui && directOf(pay, await installedUpi(), { ...options, ...options.prefill });
  if (ui && direct) {
    // Left for the UPI app (iOS): what comes back is the payer's answer, and the sheet must not open too.
    let left = false;
    const away = AppState.addEventListener('change', (st) => {
      if (st === 'background') left = true;
    });
    let paid: Paid | undefined;
    try {
      paid = await payDirect(ui, direct);
    } catch (err) {
      const e = (err ?? {}) as { code?: unknown; description?: unknown };
      if (!checkoutCancelled(err, Platform.OS)) Sentry.captureMessage(`Custom UI failed (upi intent): ${String(e.code)} ${String(e.description ?? '')}`, 'warning');
      if (directFinal(err, left, Platform.OS)) throw err;
      // Failed before any app opened: pay the same order in the sheet, below.
    } finally {
      away.remove();
    }
    // Paid but unsigned (iOS hands over the SDK's response as is): reject, so the caller asks the order's status.
    if (paid) {
      if (paid.razorpay_payment_id && paid.razorpay_signature) return paid;
      throw { code: 'unsigned', description: 'Paid without a signature' };
    }
  }
  return rp.open(options);
}
