// A walk-in or a block on one kind of station, from Today's + and Block (Play, At the desk): it starts at the current
// half hour or hour and runs whole hours, refused while a booking needs the station ("Only 1 free until 7:00 PM") or
// the venue is shut. A walk-in pays cash at the counter (the money stays off Orbit) or by the Pay now QR on their own
// phone (not in 1.0); a block says why.
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { HOUR, timeLabel, walkIn, walkInStart } from '../station/day';
import { useToday } from '../station/state';
import { Chip, close, Pill, Sheet, SheetSays, Stepper, styles } from '../station/ui';
import { ONE_0 } from '../variant';

const WHY = ['Maintenance', 'Private party', 'Closed'];

export default function WalkIn() {
  const { type, mode } = useLocalSearchParams<{ type: string; mode?: string }>();
  const { venue: v, claims, now, hours: h, add, place, busy, today, load } = useToday(); // signed in, the API's stations and claims
  const block = mode === 'block';
  const [hours, setHours] = useState(block ? 2 : 1);
  const [count, setCount] = useState(1);
  const [pay, setPay] = useState<'cash' | 'qr'>('cash');
  const [why, setWhy] = useState(WHY[0]);
  // Signed in, the API's line when it won't place it: gone when what's asked changes, or when the day comes back new
  // after the fetch the refusal itself set off (`skip`), as the sheet's own check then reads the fresh day.
  const [refused, setRefused] = useState<{ line: string; skip: number } | null>(null);
  useEffect(() => setRefused(null), [hours, count, why, pay]);
  useEffect(() => setRefused((r) => r && (r.skip > 0 ? { ...r, skip: r.skip - 1 } : null)), [load?.data]);
  const up = useRef(true); // closed mid-send: a refusal goes to Today
  useEffect(() => () => void (up.current = false), []);
  const done = useRef(false); // a second tap while the sheet closes adds nothing
  const t = v.types.find((x) => x.id === type);
  if (!today || !t) return null; // a seat switch while the sheet is up: no day yet
  const sending = busy.has('sheet');
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
                // ponytail: signed in, cash only until Pay now's API exists; 1.0 (ONE_0) is cash only, demo too.
                !load && !ONE_0 && <Chip key="qr" label="Pay now QR" on={pay === 'qr'} onPress={() => setPay('qr')} />,
              ]}
        </View>
      </View>
      {refused ? (
        <SheetSays text={refused.line} />
      ) : !tried.ok ? (
        <SheetSays text={tried.line} />
      ) : (
        !block && pay === 'qr' && <SheetSays text="They scan it and pay on their own phone; it books and checks in once they’ve paid." />
      )}
      <Pill
        wide
        label={sending ? 'Sending…' : block ? 'Block' : pay === 'qr' ? 'Show Pay now QR' : 'Add walk-in'}
        disabled={!tried.ok || sending}
        onPress={async () => {
          if (!tried.ok || done.current) return;
          done.current = true;
          if (!load) {
            add(block ? { ...tried.claim, id: `b${tried.claim.id}`, kind: 'block', why } : tried.claim);
            return close();
          }
          // Signed in, the API places it from the current step (the day is fetched again either way); a refusal stays
          // in the sheet.
          const sent = await place({ stationId: t.id, hours, count, why: block ? why : undefined }, () => !up.current);
          if ('dropped' in sent) return void (done.current = false); // another send is still on its way: nothing went
          if (!sent.line) return close();
          done.current = false;
          setRefused({ line: sent.line, skip: 1 });
        }}
      />
    </Sheet>
  );
}
