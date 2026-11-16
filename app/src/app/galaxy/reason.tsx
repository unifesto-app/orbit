// The sheet every risky action goes through (Roles doc; Galaxy canvas, 16 Nov 2026): what's about to happen, a written
// reason the other side sees, and the action, which stays off until there's a reason. The change, its audit row and the
// email to everyone holding the feature are written together by the API. No passcode again: Galaxy asked for it on the
// way in (Roles decision 11).
// An action the API has comes held in memory under the link's ticket (src/galaxy/held.ts), taken once as the sheet
// opens: its words are drawn from there, not the link, and it runs on Confirm. A refusal shows the API's own message
// (staff on that host's team, a rename since the page opened). Closed before the answer came, the sheet leaves the
// screen under it alone and says a refusal in an alert. Actions the API doesn't have yet take their words from the link
// and only close.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { Field, Pill } from '../../account/kit';
import { NeedsFeature, type Risky, StaffNote, emailed } from '../../galaxy/kit';
import { take } from '../../galaxy/held';
import { STAFF_FEATURES, type StaffFeature } from '../../modes';
import { NotFound, Sheet } from '../../rows';
import { color, font } from '../../theme';

export default function ReasonSheet() {
  const p = useLocalSearchParams<Risky & { ticket?: string }>();
  const [job] = useState(() => take(p.ticket));
  const words = job ?? p;
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const open = useRef(true);
  useEffect(
    () => () => {
      open.current = false;
    },
    [],
  );
  // Only for someone holding the action's feature; a link naming no feature names no action.
  if (!STAFF_FEATURES.includes(words.feature as StaffFeature)) return <NotFound what="action" />;
  const feature = words.feature as StaffFeature;
  const confirm = async () => {
    if (!job) return router.back();
    setBusy(true);
    setRefused(null);
    const r = await job.run(reason.trim());
    if (!open.current) {
      if (!r.ok) Alert.alert('Not done', r.error.message);
      return;
    }
    if (r.ok) return router.back(); // still busy while it closes, so a second tap can't send it again
    setBusy(false);
    setRefused(r.error.message);
  };
  return (
    <NeedsFeature feature={feature}>
      <Sheet title={words.title ?? 'Are you sure?'} full>
        {words.line && <Text style={styles.line}>{words.line}</Text>}
        {/* The API takes 3 to 500 characters. */}
        <Field label="Reason" placeholder={words.who} multiline value={reason} onChangeText={setReason} maxLength={500} autoFocus />
        <StaffNote flush>{emailed(feature)}</StaffNote>
        {refused && (
          <Text style={styles.line} accessibilityLiveRegion="polite">
            {refused}
          </Text>
        )}
        <View>
          <Pill label={words.action ?? 'Confirm'} disabled={reason.trim().length < 3 || busy} onPress={confirm} />
        </View>
      </Sheet>
    </NeedsFeature>
  );
}

const styles = StyleSheet.create({
  line: { fontFamily: font.text, fontSize: 15, lineHeight: 21, color: color.text },
});
