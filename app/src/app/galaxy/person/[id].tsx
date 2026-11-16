// A person as staff see them (Galaxy doc, People; Galaxy canvas, 16 Nov 2026), for the People feature: who they are,
// their contacts masked behind Show, how they sign in, their bookings, the hosts they're on, what Orbit sent them, reports,
// the history of staff actions on them, and what staff can do. Never a ticket link or QR, so a shared screen can't leak a
// ticket. Nobody acts on their own account (Roles doc).
// ponytail: opening this page and each Show are logged by the API; Edit and Sign out everywhere confirm only.
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { Group, Page, Pill, Row } from '../../../account/kit';
import { maskEmail, maskPhone } from '../../../account/rules';
import { accountOf } from '../../../galaxy/data';
import { Head, type Risky, StaffNote, askReason, gated } from '../../../galaxy/kit';
import { canActOn } from '../../../modes';
import { NotFound } from '../../../rows';
import { useMe } from '../../../session';

const spaced = (e164: string) => {
  const local = e164.replace(/^\+91/, '');
  return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
};

export default gated('people', function PersonPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const [shown, setShown] = useState({ phone: false, email: false });
  const a = accountOf(id);
  if (!a) return <NotFound what="person" />;

  const first = a.name.split(' ')[0];
  const acts = canActOn(me, { accountId: a.id });
  const risky = (r: Omit<Risky, 'who' | 'feature'>) => () => askReason({ ...r, who: `${first} sees this`, feature: 'people' });
  const show = (k: 'phone' | 'email') => <Pill label={shown[k] ? 'Hide' : 'Show'} size="small" onPress={() => setShown((s) => ({ ...s, [k]: !s[k] }))} />;
  const tags = [a.id === me.id && 'You', a.suspended && `Suspended until ${a.suspended}`].filter((t): t is string => !!t);
  return (
    <Page>
      <Head mark={a} name={a.name} note={[`Since ${a.since}`, a.city].filter(Boolean).join(' · ')} tags={tags} round />

      <Group title="Contact">
        <Row label="Phone" note={shown.phone ? spaced(a.phone) : maskPhone(a.phone)} right={show('phone')} />
        {a.email && <Row label="Email" note={shown.email ? a.email : maskEmail(a.email)} right={show('email')} />}
      </Group>
      <StaffNote>Each Show is logged.</StaffNote>

      {(a.ways || a.devices) && (
        <Group title="Sign-in">
          {a.ways && <Row label="Ways in" value={a.ways} />}
          {a.devices?.map(([device, seen]) => <Row key={device} label={device} value={seen} />)}
        </Group>
      )}
      {a.bookings && (
        <Group title="Bookings">
          {a.bookings.map((b) => (
            <Row key={b.title} label={b.title} note={b.line} value={b.date} />
          ))}
        </Group>
      )}
      {a.hosts && (
        <Group title="Hosts">
          {a.hosts.map(([host, role]) => (
            <Row key={host} label={host} value={role} />
          ))}
        </Group>
      )}
      {(a.messages || a.emails) && (
        <Group title="Messages, last 30 days">
          {a.messages?.map((m) => <Row key={m.title} label={m.title} note={m.via} value={m.status} />)}
          {a.emails && (
            <Row
              label="Emails"
              note={a.emails}
              right={
                acts ? (
                  <Pill
                    label="Send again"
                    size="small"
                    onPress={risky({ title: 'Send emails again?', line: 'Emails to them were held back after a bounce.', action: 'Send again' })}
                  />
                ) : undefined
              }
            />
          )}
        </Group>
      )}
      <Group title="Reports">
        <Row label="Made or about" value="None" />
      </Group>
      <Group title="History">
        <Row label="You opened this page" value="Now" />
        {a.history?.map(([what, when]) => <Row key={what} label={what} value={when} />)}
      </Group>

      {acts ? (
        <Group title="Actions">
          <Row label="Edit name and photo" onPress={() => Alert.alert('Edit name and photo', 'Comes with the API.')} />
          <Row
            label="Sign out everywhere"
            onPress={() =>
              Alert.alert(`Sign ${first} out everywhere?`, 'Every phone and browser they’re signed in on.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Sign out', style: 'destructive' },
              ])
            }
          />
          <Row
            label={a.suspended ? 'Lift the suspension' : 'Suspend or close'}
            onPress={risky(
              a.suspended
                ? { title: `Lift ${first}’s suspension?`, line: 'They can sign in and book again at once.', action: 'Lift it' }
                : { title: `Suspend ${first}?`, line: 'They can’t sign in until it ends or you lift it. Their tickets stay valid.', action: 'Suspend' },
            )}
          />
          <Row label="Correct date of birth" onPress={risky({ title: 'Correct the date of birth?', line: 'Once per account.', action: 'Correct it' })} />
          <Row
            label="Change phone number"
            onPress={risky({ title: 'Change the phone number?', line: 'It changes after 72 hours, with a cancel link to the old number and email.', action: 'Start the change' })}
          />
          <Row
            label="Remove a way in"
            onPress={risky({ title: 'Remove a lost way in?', line: 'It goes after 7 days, with a cancel link to every other way in.', action: 'Remove it' })}
          />
          <Row label="Export data" onPress={risky({ title: `Export ${first}’s data?`, line: 'An expiring link goes to your verified email.', action: 'Export' })} />
          <Row
            label="Start deletion"
            onPress={risky({ title: `Start deleting ${first}’s account?`, line: 'They confirm with a code first. It’s deleted after 30 days.', action: 'Start' })}
          />
        </Group>
      ) : (
        <StaffNote>Nobody acts on their own account.</StaffNote>
      )}
    </Page>
  );
});
