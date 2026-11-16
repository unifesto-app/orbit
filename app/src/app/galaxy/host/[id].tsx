// A host as staff see it (Galaxy doc, Hosts; Galaxy canvas, 16 Nov 2026), for the Hosts and events feature: who it is,
// its team, events, money, bank account (last 4 only), reports, the history of staff actions on it, and what staff can
// do, every one of them risky. Its own colour glows from the top, as on its public page. No host is ever deleted, and
// nobody acts on a host whose team they're on (Roles doc).
// A host on the API (a UUID id) reads GET /galaxy/hosts/:id, which logs the open, and verify, suspend and lift go to
// the API through the reason sheet. Its events, money, bank account and reports come with those slices.
// ponytail: the custom domains list and its off switch come with the API; setting a parent host needs a host picker and
// changing the owner needs its request flow, so neither shows on a real host yet.
import { router, useLocalSearchParams } from 'expo-router';

import type { Result } from '../../../api';
import { Group, Page, Row } from '../../../account/kit';
import { hostFiles, reports } from '../../../galaxy/data';
import { Head, type Risky, StaffNote, askReason, gated, opener } from '../../../galaxy/kit';
import { hostsApi, isReal, kindLabel, markOf } from '../../../hosts';
import { useLoad } from '../../../load';
import { events, hosts } from '../../../mock';
import { canActOn } from '../../../modes';
import { Failed, NotFound, Waiting } from '../../../rows';
import { api, useMe } from '../../../session';

export default gated('hosts', function HostPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return isReal(id) ? <LiveHost id={id} /> : <MockHost id={id} />;
});

const STATUS = { live: 'Live', paused: 'Paused by its owner', archived: 'Archived', suspended: 'Suspended' } as const;

function LiveHost({ id }: { id: string }) {
  const me = useMe();
  const page = useLoad(`${id}|${me.id}`, () => hostsApi(api).staffPage(id));
  if (page.loading) return <Waiting />;
  if (page.status === 404) return <NotFound what="host" />;
  if (!page.data) return <Failed message={page.error!.message} retry={page.reload} />;

  const h = page.data;
  const x = hostsApi(api);
  // Your own team, as far as the app knows; the API also refuses staff invited to it or gone from it within 30 days,
  // and the sheet shows its message.
  const acts = canActOn(me, { hostId: h.id });
  // A suspension staff placed carries their reason; one with none is a hold while none of its Admins can answer.
  const held = h.status === 'suspended' && !h.suspendReason;
  const risky = (r: Omit<Risky, 'who' | 'feature'>, run: (reason: string) => Promise<Result<unknown>>) => () =>
    askReason({ ...r, who: `${h.name}’s Admins see this`, feature: 'hosts' }, async (reason) => {
      const done = await run(reason);
      page.reload(); // a refusal can mean the page is out of date too (a rename since it opened)
      return done;
    });
  const tags = [
    h.verified ? 'Verified' : 'Unverified',
    h.status !== 'live' && (held ? 'On hold' : STATUS[h.status]),
    h.visibility === 'private' && 'Private',
    !acts && 'Your team',
  ].filter((t): t is string => !!t);
  const note = [kindLabel(h.kind), h.city, `${h.followers.toLocaleString('en-IN')} follower${h.followers === 1 ? '' : 's'}`].join(' · ');
  return (
    <Page tint={markOf(h).bg}>
      <Head mark={markOf(h)} name={h.name} note={note} tags={tags} />

      {h.suspendReason && (
        <Group title="Suspended">
          <Row label={h.suspendReason} />
        </Group>
      )}
      {held && <StaffNote>On hold: every Admin on its team is suspended, so nothing sells until one is back.</StaffNote>}

      <Group title="Team">
        {h.team.map((m) => (
          <Row key={m.userId} label={m.name ?? 'Someone'} value={m.owner ? 'Owner' : 'Admin'} />
        ))}
        <Row label="Owner’s contact" value={h.owner.phone ?? h.owner.email ?? undefined} />
      </Group>

      {(h.parent || h.clubs.length > 0) && (
        <Group title={h.parent ? 'Part of' : 'Clubs'}>
          {h.parent && <Row label={h.parent.name} onPress={() => router.push(`/galaxy/host/${h.parent!.id}`)} />}
          {h.clubs.map((c) => (
            <Row key={c.id} label={c.name} value={c.status === 'live' ? undefined : STATUS[c.status]} onPress={() => router.push(`/galaxy/host/${c.id}`)} />
          ))}
        </Group>
      )}

      {acts ? (
        <Group title="Actions">
          <Row
            label={h.verified ? 'Remove the verified mark' : 'Verify'}
            onPress={
              h.verified
                ? risky({ title: `Remove ${h.name}’s verified mark?`, line: 'The tick goes from its pages and events.', action: 'Remove it' }, (reason) => x.unverify(h.id, reason))
                : risky({ title: `Verify ${h.name}?`, line: 'A tick shows beside its name everywhere on Orbit.', action: 'Verify' }, (reason) => x.verify(h.id, reason, h.name))
            }
          />
          {h.status === 'suspended' && !held ? (
            <Row
              label="Lift the suspension"
              onPress={risky(
                { title: `Lift ${h.name}’s suspension?`, line: 'It goes back to how it was before: live, paused or archived.', action: 'Lift it' },
                (reason) => x.lift(h.id, reason),
              )}
            />
          ) : (
            <Row
              label="Suspend"
              onPress={risky(
                { title: `Suspend ${h.name}?`, line: 'They can’t publish, sell or ask for a payout until it’s lifted. Sold tickets still check in.', action: 'Suspend' },
                (reason) => x.suspend(h.id, reason),
              )}
            />
          )}
        </Group>
      ) : (
        <StaffNote>You’re on this team, so someone else acts on it.</StaffNote>
      )}
    </Page>
  );
}

function MockHost({ id }: { id: string }) {
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
}
