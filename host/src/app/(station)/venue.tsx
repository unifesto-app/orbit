import { OrbitSays } from '@orbit/mobile/orbitSays';
import { color } from '@orbit/mobile/theme';
import { ScrollView } from 'react-native';

import { useStation } from '../../station/state';
import { Head } from '../../station/ui';

// Venue, Admins only: its take comes after Money's (one take at a time).
export default function VenueTab() {
  const { venue } = useStation();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: color.ground }}>
      <Head venue={venue} title="Venue" line={venue.area} />
      <OrbitSays text="Venue comes after Money: what you rent out, prices and hours, your Desk staff, and events that ask to be at your venue." />
    </ScrollView>
  );
}
