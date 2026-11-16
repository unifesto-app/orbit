// Platform (Roles doc; Galaxy canvas, 16 Nov 2026), opened from the circle at the right of the dashboard's header, not a
// tab (owner, 16 Nov 2026: "move platform to header right side from tab"). The app's own settings for the Platform
// feature; staff and the audit log for the Staff feature. Each group shows only with its feature.
// ponytail: legal documents, app settings and the notice to chosen accounts are the next slice, so they don't open yet.
import { router } from 'expo-router';

import { Group, Page, Row } from '../../account/kit';
import { staff } from '../../galaxy/data';
import { gated } from '../../galaxy/kit';
import { hasFeature } from '../../modes';
import { useMe } from '../../session';

export default gated(['platform', 'staff'], function Platform() {
  const me = useMe();
  const waiting = staff.filter((s) => s.waiting).length;
  return (
    <Page title="Platform">
      {hasFeature(me, 'platform') && (
        <Group title="The app">
          <Row label="Legal documents" value="Terms v4 · Privacy v3" />
          <Row label="App settings" value="1.0 on both" />
          <Row label="Notice to chosen accounts" />
        </Group>
      )}
      {hasFeature(me, 'staff') && (
        <Group title="Staff">
          <Row label="Staff" value={`${staff.length - waiting}${waiting ? ` · ${waiting} waiting` : ''}`} onPress={() => router.push('/galaxy/staff')} />
          <Row label="Audit log" onPress={() => router.push('/galaxy/audit')} />
        </Group>
      )}
    </Page>
  );
});
