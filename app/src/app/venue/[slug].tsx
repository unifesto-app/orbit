// The venue sheet, from Where on the event page (owner, 15 Nov 2026: "remove open in Google Maps, when Where clicked
// Open Modal", "Venue", "copy share and get directions button", "short modal"). A short sheet sized to what's in it, in
// the ticket bar's frosted glass ("modal is glass one ( same as cta )"; registered in src/app/_layout.tsx): the venue,
// with Copy and Share as icon circles to the right of its address ("icons for copy and share right to address"), then
// Get directions as a wide frosted pill, opening Google Maps.
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { Glass } from '../../glass';
import { events } from '../../mock';
import { CircleButton, NotFound, Sheet } from '../../rows';
import { color, font, space } from '../../theme';

// Google Maps only (owner, 15 Nov 2026: "use only google maps"), searched by the venue's name and address, never its
// coordinates ("dont use long and lats in google map search"). On iOS its app opens by its own link when it's
// installed, since a web link to Google Maps opened Safari ("get directions button is not working properly"); without
// the app, Google Maps in the browser. Android opens its Google Maps app from the web link. Share sends the search link,
// which opens anywhere.
const q = encodeURIComponent;
const appLink = (place: string) => `comgooglemaps://?daddr=${q(place)}&directionsmode=driving`;
const webLink = (place: string) => `https://www.google.com/maps/dir/?api=1&destination=${q(place)}`;
const mapLink = (place: string) => `https://www.google.com/maps/search/?api=1&query=${q(place)}`;
const getDirections = (place: string) =>
  Platform.OS === 'ios'
    ? Linking.openURL(appLink(place)).catch(() => Linking.openURL(webLink(place)))
    : Linking.openURL(webLink(place));

export default function VenueSheet() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [copied, setCopied] = useState(false);
  const e = events.find((x) => x.id === slug);
  if (!e) return <NotFound what="event" />;
  const place = `${e.venue.name}, ${e.venue.address}`;

  // expo-clipboard is native (added 15 Nov 2026), so it works only once the app is rebuilt with it. Until then the
  // import fails here, not when the page loads, and the share sheet stands in: it has a Copy of its own. Copied, the
  // icon turns to a tick.
  const copy = async () => {
    try {
      const Clipboard = await import('expo-clipboard');
      await Clipboard.setStringAsync(place);
      setCopied(true);
    } catch {
      Share.share({ message: place });
    }
  };

  return (
    <Sheet title="Venue">
      <View style={styles.place}>
        <View style={styles.grow}>
          <Text style={styles.name}>{e.venue.name}</Text>
          <Text style={styles.address}>{e.venue.address}</Text>
        </View>
        <CircleButton icon={copied ? 'check' : 'copy'} label={copied ? 'Copied' : 'Copy address'} onPress={copy} />
        <CircleButton icon="share" label="Share address" onPress={() => Share.share({ message: `${place}\n${mapLink(place)}` })} />
      </View>
      <Pressable onPress={() => getDirections(place)} accessibilityRole="button">
        <Glass style={styles.wide}>
          <Text style={styles.label}>Get directions</Text>
        </Glass>
      </Pressable>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  place: { flexDirection: 'row', alignItems: 'center', gap: space.small },
  grow: { flex: 1, minWidth: 0 },
  name: { fontFamily: font.title, fontSize: 17, lineHeight: 22, color: color.text },
  address: { marginTop: 2, fontFamily: font.text, fontSize: 14, lineHeight: 20, color: color.secondary },
  // A wide frosted pill, as Set location and Use my current location.
  wide: { height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: font.title, fontSize: 15, color: color.text },
});
