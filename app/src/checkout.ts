// Razorpay's checkout, loaded on Pay, never on import: a build from before it (no native module) throws on importing it
// (NativeEventEmitter), which would take the whole sheet down, free Register too. Null there: paying waits for the
// rebuild. The event booking sheet and the Book a slot sheet both open it.
import { NativeModules, TurboModuleRegistry } from 'react-native';

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
