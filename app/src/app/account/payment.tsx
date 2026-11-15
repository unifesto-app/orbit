// Payment methods. No flow stores a buyer's card or UPI ID: every payment goes through Razorpay at checkout, UPI apps
// opening straight from Orbit (Booking doc, Paying), and bank accounts belong to hosts (Money doc). So this lists the
// ways to pay, and keeps nothing. Titles only, no descriptions (owner, 15 Nov 2026).
import { Platform } from 'react-native';

import { Group, Page, Row } from '../../account/kit';

export default function PaymentMethods() {
  return (
    <Page title="Payment methods">
      <Group title="How you can pay">
        <Row label="UPI apps" />
        <Row label="Card, netbanking and more" />
        {Platform.OS === 'ios' && <Row label="Apple Pay" value="Coming soon" />}
      </Group>
    </Page>
  );
}
