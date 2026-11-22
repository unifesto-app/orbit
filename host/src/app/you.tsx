// You, from the circle in each tab's head. Until sign-in comes to the host apps, it picks which venue and role the
// mock shows (Admin sees Today, Money and Venue; Desk sees Today alone).
import { Text, View } from 'react-native';

import { venues } from '../station/mock';
import { useStation } from '../station/state';
import { Chip, Sheet, styles } from '../station/ui';

export default function You() {
  const { venue, role, setVenue, setRole } = useStation();
  return (
    <Sheet title="You" note="Until sign-in comes, pick what to see">
      <View style={styles.field}>
        <Text style={styles.label}>Venue</Text>
        <View style={styles.chips}>
          {venues.map((v) => (
            <Chip key={v.id} label={v.name} on={venue.id === v.id} onPress={() => setVenue(v.id)} />
          ))}
        </View>
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Signed in as</Text>
        <View style={styles.chips}>
          <Chip label="Admin" on={role === 'admin'} onPress={() => setRole('admin')} />
          <Chip label="Desk" on={role === 'desk'} onPress={() => setRole('desk')} />
        </View>
      </View>
    </Sheet>
  );
}
