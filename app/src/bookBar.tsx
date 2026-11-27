// A booking bar pinned to the bottom of a page: the price and a line on the left, one pill on the right. The event
// page's ticket bar (Book ticket, Register, View ticket) and a venue's Book a slot (Play doc: "Book a slot" over
// "Starting from ₹162/hr"). It floats, never attached to the screen's edges (owner, 15 Nov 2026: "bottom cta should not
// be attached"): a frosted pill on the page margins, held off the bottom, darkened like the top bar so its white text
// reads over any poster. Its corners nest round the button's (22 + the small gap = 30, half its height). The pill isn't
// a button until there's something to do (`onAction`). `onHeight` gets the room it takes, gap below included.
// `dark`: the tab bar's dark glass, its button frosted like the tab bar's lighter pill (the event page since its Take 1,
// owner, 19 Nov 2026, matching Home and Search's "Both").
// `pay`: at checkout the way you pay takes the left, as Unifesto's pay bar has it (owner, 19 Nov 2026: "move paywith to
// cta, check unifesto app for ref"): its mark and "Pay with … ⌄" over the price, a tap changing it; the button says Pay.
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DARK_TINT, Glass } from './glass';
import { Icon } from './icons';
import { color, font, space } from './theme';

const BAR_PAD = space.small;
const BUTTON = 44;
// `from` leads the price with "Starting from" (the cheapest of several ticket types, or of a venue's stations).
export function BookBar({
  price,
  from,
  note,
  action,
  onAction,
  onHeight,
  dark = false,
  pay,
}: {
  price: string;
  from: boolean;
  note?: string;
  action: string;
  onAction?: () => void;
  onHeight: (h: number) => void;
  dark?: boolean;
  pay?: { mark: ReactNode; label: string; onPress: () => void };
}) {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, space.big);
  return (
    <View style={[styles.ticketBar, { bottom }]} onLayout={(ev) => onHeight(ev.nativeEvent.layout.height + bottom + space.big)}>
      <Glass style={styles.ticketGlass} tint={dark ? DARK_TINT : undefined} />
      {!dark && <View style={styles.ticketShade} />}
      {pay ? (
        <Pressable
          onPress={pay.onPress}
          accessibilityRole="button"
          accessibilityLabel={`${pay.label}, ${price}`}
          accessibilityHint="Changes how you pay"
          style={({ pressed }) => [styles.grow, styles.payPick, pressed && styles.pressed]}>
          {pay.mark}
          <View style={styles.grow}>
            <View style={styles.payRow}>
              <Text style={styles.payLabel} numberOfLines={1}>
                {pay.label}
              </Text>
              <Icon name="chevronDown" size={12} color={color.secondary} />
            </View>
            <Text style={styles.price}>{price}</Text>
          </View>
        </Pressable>
      ) : (
        <View style={[styles.grow, styles.ticketText]}>
          <Text style={styles.price}>
            {from && <Text style={styles.from}>Starting from </Text>}
            {price}
          </Text>
          {note && <Text style={styles.small}>{note}</Text>}
        </View>
      )}
      <Pressable onPress={onAction} disabled={!onAction} accessibilityRole="button">
        <Glass style={styles.button}>
          <Text style={styles.buttonText}>{action}</Text>
        </Glass>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  ticketBar: {
    position: 'absolute',
    left: 20,
    right: 20,
    padding: BAR_PAD,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.small,
  },
  ticketGlass: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderCurve: 'continuous', borderRadius: BUTTON / 2 + BAR_PAD },
  ticketShade: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderCurve: 'continuous', borderRadius: BUTTON / 2 + BAR_PAD, backgroundColor: `${color.ground}80` },
  // In from the pill's round end, so the price sits clear of the curve.
  ticketText: { paddingLeft: 12 },
  payPick: { paddingLeft: space.small, flexDirection: 'row', alignItems: 'center', gap: 10 },
  payRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  payLabel: { flexShrink: 1, fontFamily: font.medium, fontSize: 12, color: color.secondary },
  pressed: { opacity: 0.7 },
  price: { fontFamily: font.price, fontSize: 18, color: color.text },
  from: { fontFamily: font.text, fontSize: 13, color: color.secondary },
  small: { fontFamily: font.text, fontSize: 12, color: color.secondary },
  // View ticket's size (owner: "rounded view ticket and view events and book ticket").
  button: { height: BUTTON, paddingHorizontal: 24, borderCurve: 'continuous', borderRadius: BUTTON / 2, justifyContent: 'center' },
  buttonText: { fontFamily: font.title, fontSize: 15, color: color.text },
});
