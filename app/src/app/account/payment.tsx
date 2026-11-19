// Account › Payment methods (owner, 19 Nov 2026: "bring the payment methods screen from unifesto but with orbit's ui",
// "even update in account screen"): Unifesto's pay-method sheet as an Account screen, in Orbit's cards (src/payChoices.tsx).
// The way you pick here is the one ready at checkout. Payments go through Razorpay there, and Orbit keeps no card or bank
// detail (Booking doc, Paying).
import { Page, SignInNote } from '../../account/kit';
import { PayChoices } from '../../payChoices';
import { useSignedIn } from '../../session';

export default function PaymentMethods() {
  const signedIn = useSignedIn();
  return (
    <Page title="Payment methods">
      {signedIn ? <PayChoices /> : <SignInNote>Sign in to pick how you pay.</SignInNote>}
    </Page>
  );
}
