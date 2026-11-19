// How to pay, at checkout (owner, 19 Nov 2026: "wire it in"; Unifesto's pay-method sheet): opened from the pay bar's
// "Pay with …" on the Tickets and Slot sheets, over them. The same choices as Account › Payment methods
// (src/payChoices.tsx); a pick closes it, and the bar then shows it.
// A sheet on the glass with its title and X like every modal (owner approved Take 6 of the detail pages mockup, 19 Nov
// 2026; it was a page with a back arrow).
import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { PayChoices } from '../payChoices';
import { Sheet } from '../rows';
import { space } from '../theme';

export default function HowToPay() {
  return (
    <Sheet title="How to pay" full>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={styles.list}>
        {/* Account's cards bring the page's margins, which the sheet already has. */}
        <View style={styles.flush}>
          <PayChoices onPicked={() => router.back()} />
        </View>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: space.big },
  flush: { marginHorizontal: -20, marginTop: -space.big }, // the first group's heading brings its own gap
});
