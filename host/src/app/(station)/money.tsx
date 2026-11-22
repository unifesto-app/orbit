import { OrbitSays } from '@orbit/mobile/orbitSays';
import { color } from '@orbit/mobile/theme';
import { ScrollView } from 'react-native';

import { useStation } from '../../station/state';
import { Head } from '../../station/ui';

// Money, Admins only: its take comes after Today's (one take at a time).
export default function Money() {
  const { venue } = useStation();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: color.ground }}>
      <Head venue={venue} title="Money" line={venue.area} />
      <OrbitSays text="Money comes next: the seven numbers by day, from ticket sales to what’s available, asking for a payout once a week, and your bank account." />
    </ScrollView>
  );
}
