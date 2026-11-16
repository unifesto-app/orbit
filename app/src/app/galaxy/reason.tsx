// The sheet every risky action goes through (Roles doc; Galaxy canvas, 16 Nov 2026): what's about to happen, a written
// reason the other side sees, and the action, which stays off until there's a reason. The change, its audit row and the
// email to everyone holding the feature are written together by the API. No passcode again: Galaxy asked for it on the
// way in (Roles decision 11).
// An action the API has runs from here (askReason in src/galaxy/kit.tsx) and closes the sheet once it's done; a refusal
// shows the API's own message, which says why (staff on that host's team, a rename since the page opened). Actions the
// API doesn't have yet only close it.
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Field, Pill } from '../../account/kit';
import { NeedsFeature, type Risky, StaffNote, emailed, runFor } from '../../galaxy/kit';
import { STAFF_FEATURES, type StaffFeature } from '../../modes';
import { NotFound, Sheet } from '../../rows';
import { color, font } from '../../theme';

export default function ReasonSheet() {
  const p = useLocalSearchParams<Risky & { ticket?: string }>();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  // Only for someone holding the action's feature; a link naming no feature names no action.
  if (!STAFF_FEATURES.includes(p.feature)) return <NotFound what="action" />;
  const feature: StaffFeature = p.feature;
  const confirm = async () => {
    const run = runFor(p.ticket);
    if (!run) return router.back();
    setBusy(true);
    setRefused(null);
    const r = await run(reason.trim());
    setBusy(false);
    if (r.ok) router.back();
    else setRefused(r.error.message);
  };
  return (
    <NeedsFeature feature={feature}>
      <Sheet title={p.title ?? 'Are you sure?'} full>
        {p.line && <Text style={styles.line}>{p.line}</Text>}
        <Field label="Reason" placeholder={p.who} multiline value={reason} onChangeText={setReason} autoFocus />
        <StaffNote flush>{emailed(feature)}</StaffNote>
        {refused && (
          <Text style={styles.line} accessibilityLiveRegion="polite">
            {refused}
          </Text>
        )}
        <View>
          {/* The API wants at least 3 characters of reason. */}
          <Pill label={p.action ?? 'Confirm'} disabled={reason.trim().length < 3 || busy} onPress={confirm} />
        </View>
      </Sheet>
    </NeedsFeature>
  );
}

const styles = StyleSheet.create({
  line: { fontFamily: font.text, fontSize: 15, lineHeight: 21, color: color.text },
});
