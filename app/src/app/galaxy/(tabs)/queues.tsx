// Galaxy's queues (Galaxy doc; Galaxy canvas, 16 Nov 2026): the Requests queue, support and content reports, picked by
// chip, each a list of what's waiting with its age and its 24-hour due time, overdue first. Opens with the first queue
// that has something overdue.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Chips, Group, Row } from '../../../account/kit';
import { KINDS, reports, requests, tickets } from '../../../galaxy/data';
import { ago, due, oldestFirst } from '../../../galaxy/due';
import { gated } from '../../../galaxy/kit';
import { Empty, TabPage } from '../../../modeKit';
import { events, hosts, now } from '../../../mock';
import { color } from '../../../theme';

type Item = { id: string; label: string; note: string; askedAt: string; open: string; waiting?: boolean };
const hostName = (id: string) => hosts.find((h) => h.id === id)?.name ?? id;
const eventOf = (id: string) => events.find((e) => e.id === id);

const QUEUES: Record<'Requests' | 'Support' | 'Reports', Item[]> = {
  Requests: requests.map((r) => ({
    id: r.id,
    label: KINDS[r.kind].title,
    note: `${hostName(r.hostId)} · ${ago(r.askedAt, now)}`,
    askedAt: r.askedAt,
    open: `/galaxy/request/${r.id}`,
  })),
  Support: tickets
    .filter((t) => t.status !== 'Resolved')
    .map((t) => ({
      id: t.id,
      label: t.title,
      note: `${t.from} · ${ago(t.askedAt, now)}`,
      askedAt: t.askedAt,
      open: `/galaxy/support/${t.id}`,
      waiting: t.status === 'Waiting on the person',
    })),
  Reports: reports.map((r) => {
    const what = r.byOrbit ? 'Raised by Orbit' : r.ticket ? 'Ticket problem' : 'Event';
    const many = r.reports.length > 1 ? ` · ${r.reports.length} reports` : '';
    return { id: r.id, label: eventOf(r.eventId)?.title ?? r.eventId, note: `${what}${many} · ${ago(r.askedAt, now)}`, askedAt: r.askedAt, open: `/galaxy/report/${r.id}` };
  }),
};
type Queue = keyof typeof QUEUES;
const NAMES = Object.keys(QUEUES) as Queue[];
const label = (q: Queue) => `${q} ${QUEUES[q].length}`;
const late = (i: Item) => !i.waiting && due(i.askedAt, now).overdue;

// Overdue first, then what's due today, then anything waiting on the person (which isn't on the clock).
function sections(items: Item[]) {
  const sorted = oldestFirst(items);
  return [
    { title: 'Overdue', items: sorted.filter(late) },
    { title: 'Due today', items: sorted.filter((i) => !i.waiting && !late(i)) },
    { title: 'Waiting on the person', items: sorted.filter((i) => i.waiting) },
  ].filter((s) => s.items.length > 0);
}

// `show` picks a queue: the dashboard's rows open the one they name.
export default gated('queues', function Queues() {
  const { show } = useLocalSearchParams<{ show?: string }>();
  const named = NAMES.find((q) => q === show);
  const [queue, setQueue] = useState<Queue>(() => named ?? NAMES.find((q) => QUEUES[q].some(late)) ?? 'Requests');
  useEffect(() => {
    if (named) setQueue(named);
  }, [named]);
  const list = sections(QUEUES[queue]);
  return (
    <TabPage head="Queues" tint={color.galaxy}>
      <View style={styles.chips}>
        <Chips options={NAMES.map(label)} value={label(queue)} onChange={(l) => setQueue(NAMES.find((q) => label(q) === l) ?? queue)} />
      </View>
      {list.length === 0 && <Empty>Nothing waiting.</Empty>}
      {list.map((s) => (
        <Group key={s.title} title={s.title}>
          {s.items.map((i) => (
            <Row key={i.id} label={i.label} note={i.note} value={i.waiting ? undefined : due(i.askedAt, now).line} onPress={() => router.push(i.open)} />
          ))}
        </Group>
      ))}
    </TabPage>
  );
});

const styles = StyleSheet.create({
  chips: { marginHorizontal: 20, marginTop: 8 },
});
