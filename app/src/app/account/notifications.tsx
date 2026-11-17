// Notifications: the one screen with every switch (Notifications doc, Settings; defaults accepted 15 Nov 2026). Push
// stops every push but the inbox still fills; each kind has a push switch, and the optional emails their own. Quiet
// hours hold low and normal pushes 10 PM to 7 AM, India time. Must-sends are listed as "Always sent", so nobody wonders
// why a receipt still arrives. Titles only, no descriptions (owner, 15 Nov 2026).
import { useState } from 'react';

import { Group, Page, Row, Toggle } from '../../account/kit';
import { useSession } from '../../session';

const PUSH = [
  ['tickets', 'Tickets'],
  ['reminders', 'Reminders'],
  ['follows', 'From hosts you follow'],
  ['near', 'New events near you'],
  ['announcements', 'Host announcements'],
  ['team', 'Your hosts'],
] as const;
const EMAIL = PUSH.filter(([key]) => key !== 'tickets' && key !== 'near');

export default function Notifications() {
  // ponytail: kept on this screen only until settings reach the API.
  const near = !!useSession()?.me.city; // nearby needs the account's city for new events
  const [on, setOn] = useState<Record<string, boolean>>({ 'push.near': near, quiet: false });
  const is = (key: string) => on[key] ?? true; // every switch defaults to on, but quiet hours and near without a city
  const flip = (key: string) => (v: boolean) => setOn((s) => ({ ...s, [key]: v }));

  return (
    <Page title="Notifications">
      <Group>
        <Row label="Push" right={<Toggle label="Push" value={is('push')} onChange={flip('push')} />} />
      </Group>

      <Group title="Push">
        {PUSH.map(([key, label]) => (
          <Row key={key} label={label} right={<Toggle label={`${label} pushes`} value={is(`push.${key}`)} onChange={flip(`push.${key}`)} />} />
        ))}
      </Group>

      <Group title="Email">
        {EMAIL.map(([key, label]) => (
          <Row key={key} label={label} right={<Toggle label={`${label} email`} value={is(`email.${key}`)} onChange={flip(`email.${key}`)} />} />
        ))}
      </Group>

      <Group title="Quiet hours">
        <Row label="10 PM to 7 AM" right={<Toggle label="Quiet hours" value={is('quiet')} onChange={flip('quiet')} />} />
      </Group>

      <Group title="Always sent">
        <Row label="Sign-in codes and account changes" />
        <Row label="Your tickets, receipts and refunds" />
        <Row label="Changes to an event you’re going to" />
        <Row label="Replies from support" />
      </Group>
    </Page>
  );
}
