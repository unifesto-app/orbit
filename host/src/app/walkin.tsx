// A walk-in or a block on one kind of station, from Today's + and Block (Play, At the desk): it starts at the current
// half hour or hour and runs whole hours, refused while a booking needs the station ("Only 1 free until 7:00 PM") or
// the venue is shut. A walk-in pays cash at the counter (the money stays off Orbit) or by the Pay now QR on their own
// phone; a block says why.
import { useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { HOUR, timeLabel, walkIn, walkInStart } from '../station/day';
import { useStation } from '../station/state';
import { Chip, close, Pill, Sheet, SheetSays, Stepper, styles } from '../station/ui';

const WHY = ['Maintenance', 'Private party', 'Closed'];

export default function WalkIn() {
  const { type, mode } = useLocalSearchParams<{ type: string; mode?: string }>();
  const { venue: v, claims, now, hours: h, add } = useStation();
  const block = mode === 'block';
  const [hours, setHours] = useState(block ? 2 : 1);
  const [count, setCount] = useState(1);
  const [pay, setPay] = useState<'cash' | 'qr'>('cash');
  const [why, setWhy] = useState(WHY[0]);
  const done = useRef(false); // a second tap while the sheet closes adds nothing
  const t = v.types.find((x) => x.id === type);
  if (!t) return null;
  const tried = walkIn(claims, v, t, now, hours, count);
  const start = walkInStart(t, now);
  const end = Math.min(start + hours * HOUR, h.closes);
  const note = h.state === 'open' ? `${timeLabel(start)} to ${timeLabel(end)}, from this ${t.step === 30 ? 'half hour' : 'hour'}` : undefined;
  return (
    <Sheet title={`${block ? 'Block' : 'Walk-in'} · ${t.name}`} note={note}>
      {t.count > 1 && (
        <View style={styles.frow}>
          <Text style={styles.label}>How many</Text>
          <Stepper n={count} min={1} max={t.count} onChange={setCount} label={t.unit[1]} />
        </View>
      )}
      <View style={styles.field}>
        <Text style={styles.label}>For</Text>
        <View style={styles.chips}>
          {[1, 2, 3].map((n) => (
            <Chip key={n} label={n === 1 ? '1 hour' : `${n} hours`} on={hours === n} onPress={() => setHours(n)} />
          ))}
        </View>
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>{block ? 'Why' : 'They pay'}</Text>
        <View style={styles.chips}>
          {block
            ? WHY.map((w) => <Chip key={w} label={w} on={why === w} onPress={() => setWhy(w)} />)
            : [
                <Chip key="cash" label="Cash here" on={pay === 'cash'} onPress={() => setPay('cash')} />,
                <Chip key="qr" label="Pay now QR" on={pay === 'qr'} onPress={() => setPay('qr')} />,
              ]}
        </View>
      </View>
      {!tried.ok ? (
        <SheetSays text={tried.line} />
      ) : (
        !block && pay === 'qr' && <SheetSays text="They scan it and pay on their own phone; it books and checks in once they’ve paid." />
      )}
      <Pill
        wide
        label={block ? 'Block' : pay === 'qr' ? 'Show Pay now QR' : 'Add walk-in'}
        disabled={!tried.ok}
        onPress={() => {
          if (!tried.ok || done.current) return;
          done.current = true;
          add(block ? { ...tried.claim, id: `b${tried.claim.id}`, kind: 'block', why } : tried.claim);
          close();
        }}
      />
    </Sheet>
  );
}
