// How to pay, at checkout (owner, 19 Nov 2026: "wire it in"; Unifesto's pay-method sheet): opened from "Pay with …" on
// an event's Review and a slot's hold, over the booking sheet. The same choices as Account › Payment methods
// (src/payChoices.tsx); a pick closes it and the booking's Pay button reads "Pay with …" from it.
import { router } from 'expo-router';

import { Page } from '../account/kit';
import { PayChoices } from '../payChoices';

export default function HowToPay() {
  return (
    <Page title="How to pay">
      <PayChoices onPicked={() => router.back()} />
    </Page>
  );
}
