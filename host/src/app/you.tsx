// You, from the circle in each tab's head. Signed in, it lists the venues you're on with your role at each (Admin sees
// Today, Money and Venue; Desk sees Today alone); tap one to look as it. The dev demo picks a mock venue and either role.
// Sign out goes back to Sign in.
import { Text, View } from 'react-native';

import { signOut } from '../session';
import { venues } from '../station/mock';
import { useStation } from '../station/state';
import { Chip, Pill, Sheet, styles } from '../station/ui';

const ROLE = { admin: 'Admin', desk: 'Desk' } as const;

export default function You() {
  const { venue, role, seats, seat, setSeat, setVenue, setRole } = useStation();
  return (
    <Sheet title="You">
      {seats ? (
        <View style={styles.field}>
          <Text style={styles.label}>Your venues</Text>
          <View style={styles.chips}>
            {seats.map((x) => (
              <Chip key={x.hostId} label={`${x.name} · ${ROLE[x.role]}`} on={seat?.hostId === x.hostId} onPress={() => setSeat(x.hostId)} />
            ))}
          </View>
        </View>
      ) : (
        <>
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
        </>
      )}
      <View style={styles.field}>
        <Pill label="Sign out" onPress={signOut} />
      </View>
    </Sheet>
  );
}
