// A host as staff see it (Galaxy doc, Hosts; Galaxy canvas, 16 Nov 2026), for the Hosts and events feature: who it is,
// its team, events, money, bank account (last 4 only), reports, the history of staff actions on it, and what staff can
// do, every one of them risky. Its own colour glows from the top, as on its public page. No host is ever deleted, and
// nobody acts on a host whose team they're on (Roles doc).
// ponytail: the custom domains list and its off switch come with the API.
import { router, useLocalSearchParams } from 'expo-router';

import { Group, Page, Row } from '../../../account/kit';
import { hostFiles, reports } from '../../../galaxy/data';
import { Head, type Risky, StaffNote, askReason, gated, opener } from '../../../galaxy/kit';
import { events, hosts } from '../../../mock';
import { canActOn } from '../../../modes';
import { NotFound } from '../../../rows';
import { useMe } from '../../../session';

export default gated('hosts', function HostPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const host = hosts.find((h) => h.id === id);
  if (!host) return <NotFound what="host" />;

  const file = hostFiles[host.id];
  const theirs = events.filter((e) => e.hostId === host.id);
  const open = reports.filter((r) => theirs.some((e) => e.id === r.eventId));
  const reported = open.reduce((n, r) => n + r.reports.length, 0);
  const acts = canActOn(me, { hostId: host.id });
  const risky = (r: Omit<Risky, 'who' | 'feature'>) => () => askReason({ ...r, who: `${host.name}’s Admins see this`, feature: 'hosts' });
  const tags = [host.verified ? 'Verified' : 'Unverified', reported > 0 && `${reported} open report${reported === 1 ? '' : 's'}`, !acts && 'Your team'].filter((t): t is string => !!t);
  const note = [host.kind, `${host.followers.toLocaleString('en-IN')} followers`, file && `Since ${file.since}`].filter(Boolean).join(' · ');
  return (
    <Page tint={host.bg}>
      <Head mark={host} name={host.name} note={note} tags={tags} />

      {file && file.team.length > 0 && (
        <Group title="Team">
          {file.team.map((m) => (
            <Row key={m.name} label={m.name} value={m.role} onPress={m.accountId ? opener(me, 'people', `/galaxy/person/${m.accountId}`) : undefined} />
          ))}
        </Group>
      )}
      {theirs.length > 0 && (
        <Group title="Events">
          {theirs.map((e) => (
            <Row key={e.id} label={e.title} value={e.when.split(' · ')[0]} onPress={() => router.push(`/galaxy/event/${e.id}`)} />
          ))}
        </Group>
      )}
      {file && (
        <Group title="Money">
          {file.money.map(([label, value]) => (
            <Row key={label} label={label} value={value} />
          ))}
          <Row label="Fee" value={file.fee} />
        </Group>
      )}
      {file?.bank && (
        <Group title="Bank account">
          <Row label={file.bank[0]} value={file.bank[1]} />
        </Group>
      )}
      {open.length > 0 && (
        <Group title="Reports">
          {open.map((r) => (
            <Row
              key={r.id}
              label={theirs.find((e) => e.id === r.eventId)?.title ?? r.eventId}
              value={`${r.reports.length} open`}
              onPress={opener(me, 'queues', `/galaxy/report/${r.id}`)}
            />
          ))}
        </Group>
      )}
      {file && file.history.length > 0 && (
        <Group title="History">
          {file.history.map(([what, when]) => (
            <Row key={what} label={what} value={when} />
          ))}
        </Group>
      )}

      {acts ? (
        <Group title="Actions">
          <Row
            label={host.verified ? 'Remove the verified mark' : 'Verify'}
            onPress={risky(
              host.verified
                ? { title: `Remove ${host.name}’s verified mark?`, line: 'The tick goes from its pages and events.', action: 'Remove it' }
                : { title: `Verify ${host.name}?`, line: 'A tick shows beside its name everywhere on Orbit.', action: 'Verify' },
            )}
          />
          <Row
            label="Suspend"
            onPress={risky({
              title: `Suspend ${host.name}?`,
              line: 'They can’t publish, sell or ask for a payout until it’s lifted. Sold tickets still check in.',
              action: 'Suspend',
            })}
          />
          <Row label="Set a parent host" onPress={risky({ title: 'Set a parent host?', line: 'One level deep: a club under its college.', action: 'Set it' })} />
          <Row
            label="Change the owner"
            onPress={risky({ title: 'Change the owner?', line: 'Payouts and bank changes hold until it lands.', action: 'Change it' })}
          />
        </Group>
      ) : (
        <StaffNote>You’re on this team, so someone else acts on it.</StaffNote>
      )}
    </Page>
  );
});
