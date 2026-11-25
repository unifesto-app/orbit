// You, from the circle in each tab's head: the venues you're on with your role at each (Admin sees Today and Venue, Money
// too without the 1.0 flag; Desk sees Today alone); tap one to look as it. Sign out goes back to Sign in.
import { Text, View } from 'react-native';

import { signOut } from '../session';
import { useStation } from '../station/state';
import { Chip, Pill, Sheet, styles } from '../station/ui';

const ROLE = { admin: 'Admin', desk: 'Desk' } as const;

export default function You() {
  const { seats, seat, setSeat } = useStation();
  return (
    <Sheet title="You">
      <View style={styles.field}>
        <Text style={styles.label}>Your venues</Text>
        <View style={styles.chips}>
          {seats.map((x) => (
            <Chip key={x.hostId} label={`${x.name} · ${ROLE[x.role]}`} on={seat?.hostId === x.hostId} onPress={() => setSeat(x.hostId)} />
          ))}
        </View>
      </View>
      <View style={styles.field}>
        <Pill label="Sign out" onPress={signOut} />
      </View>
    </Sheet>
  );
}
