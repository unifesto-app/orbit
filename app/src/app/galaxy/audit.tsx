// The audit log (Galaxy doc, Audit log; Roles doc; Galaxy canvas, 16 Nov 2026), for the Staff feature: every staff change,
// and every page opened, search and contact shown, newest first, by day. Searchable by staff member, person, host, event
// or action, and narrowed to changes or to opens and searches. Rows keep only ids once a person is deleted (API).
// ponytail: an entry's own page (who, what, to whom, the reason, what changed) is the next slice.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Chips, Group, Page, Row } from '../../account/kit';
import { audit } from '../../galaxy/data';
import { gated } from '../../galaxy/kit';
import { Empty } from '../../modeKit';
import { SearchBox } from '../../rows';

const KINDS = ['All', 'Changes', 'Opens and searches'] as const;

export default gated('staff', function AuditLog() {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<(typeof KINDS)[number]>('All');
  const q = query.trim().toLowerCase();
  const rows = audit.filter(
    (r) => (kind === 'All' || (kind === 'Changes') === (r.kind === 'change')) && (!q || `${r.text} ${r.note}`.toLowerCase().includes(q)),
  );
  const days = [...new Set(rows.map((r) => r.day))];
  return (
    <Page title="Audit log">
      <View style={styles.box}>
        <SearchBox value={query} onChangeText={setQuery} placeholder="Staff, person, host, event or action" autoCapitalize="none" />
      </View>
      <View style={styles.chips}>
        <Chips options={KINDS} value={kind} onChange={setKind} />
      </View>
      {rows.length === 0 && <Empty>Nothing matches.</Empty>}
      {days.map((day) => (
        <Group key={day} title={day}>
          {rows
            .filter((r) => r.day === day)
            .map((r) => (
              <Row key={`${r.time}${r.text}`} label={r.text} note={[r.note, r.time].filter(Boolean).join(' · ')} />
            ))}
        </Group>
      ))}
    </Page>
  );
});

const styles = StyleSheet.create({
  box: { marginHorizontal: 20, marginTop: 16 },
  chips: { marginHorizontal: 20, marginTop: 16 },
});
