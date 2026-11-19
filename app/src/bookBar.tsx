// A booking bar pinned to the bottom of a page: the price and a line on the left, one pill on the right. The event
// page's ticket bar (Book ticket, Register, View ticket) and a venue's Book a slot (Play doc: "Book a slot" over
// "Starting from ₹162/hr"). It floats, never attached to the screen's edges (owner, 15 Nov 2026: "bottom cta should not
// be attached"): a frosted pill on the page margins, held off the bottom, darkened like the top bar so its white text
// reads over any poster. Its corners nest round the button's (22 + the small gap = 30, half its height). The pill isn't
// a button until there's something to do (`onAction`). `onHeight` gets the room it takes, gap below included.
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Glass } from './glass';
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
}: {
  price: string;
  from: boolean;
  note?: string;
  action: string;
  onAction?: () => void;
  onHeight: (h: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, space.big);
  return (
    <View style={[styles.ticketBar, { bottom }]} onLayout={(ev) => onHeight(ev.nativeEvent.layout.height + bottom + space.big)}>
      <Glass style={styles.ticketGlass} />
      <View style={styles.ticketShade} />
      <View style={[styles.grow, styles.ticketText]}>
        <Text style={styles.price}>
          {from && <Text style={styles.from}>Starting from </Text>}
          {price}
        </Text>
        {note && <Text style={styles.small}>{note}</Text>}
      </View>
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
  ticketGlass: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: BUTTON / 2 + BAR_PAD },
  ticketShade: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: BUTTON / 2 + BAR_PAD, backgroundColor: `${color.ground}80` },
  // In from the pill's round end, so the price sits clear of the curve.
  ticketText: { paddingLeft: 12 },
  price: { fontFamily: font.price, fontSize: 18, color: color.text },
  from: { fontFamily: font.text, fontSize: 13, color: color.secondary },
  small: { fontFamily: font.text, fontSize: 12, color: color.secondary },
  // View ticket's size (owner: "rounded view ticket and view events and book ticket").
  button: { height: BUTTON, paddingHorizontal: 24, borderRadius: BUTTON / 2, justifyContent: 'center' },
  buttonText: { fontFamily: font.title, fontSize: 15, color: color.text },
});
