// Money, for Admins: not in 1.0 (ONE_0 hides the tab). Without the flag it's one line.
// ponytail: waits on the Money API (sales, payouts, the bank account). Take 3's design
// (https://claude.ai/artifact/Me5XbAzWHUYi6muYwwSZrP) and the fee maths (src/station/money.ts, src/money.ts) are ready
// for it; git 8499cff has the mock-fed screen and its payout and bank sheets.
import { OrbitSays } from '@orbit/mobile/orbitSays';
import { color } from '@orbit/mobile/theme';
import { ScrollView } from 'react-native';

import { useStation } from '../../station/state';
import { Head } from '../../station/ui';

export default function Money() {
  const { venue, role } = useStation();
  if (role !== 'admin') return null; // Desk never comes here: Station's tab bar sends it to Today
  return (
    <ScrollView style={{ flex: 1, backgroundColor: color.ground }}>
      <Head venue={venue} title="Money" line="" />
      <OrbitSays text="Money comes with payouts." />
    </ScrollView>
  );
}
