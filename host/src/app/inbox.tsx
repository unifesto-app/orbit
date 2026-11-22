import { OrbitSays } from '@orbit/mobile/orbitSays';
import { color } from '@orbit/mobile/theme';
import { ScrollView } from 'react-native';

// Orbit Launch's Inbox, opened from the round button beside the tabs. Its own take comes later.
export default function Inbox() {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: color.ground }}>
      <OrbitSays text="Your Inbox comes soon: new bookings, refund requests, payouts ready, invites accepted and asks from performers and venues, each opening what it’s about." />
    </ScrollView>
  );
}
