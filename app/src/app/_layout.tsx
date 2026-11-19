import { DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold } from '@expo-google-fonts/dm-sans';
import { PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans';
import { Sacramento_400Regular } from '@expo-google-fonts/sacramento';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';

import { NoteHost } from '../note';
import { refreshAccount } from '../session';
import { Splash } from '../splash/Splash';
import { color } from '../theme';

// The tabs always sit under the location sheet, even when the app opens or reloads on /location, so Close has a
// screen to go back to (without it: "GO_BACK was not handled", and the sheet shows as a plain card).
export const unstable_settings = { anchor: '(tabs)' };

// Every modal is see-through, so its own frosted glass shows (GlassFill in src/rows.tsx; owner, 15 Nov 2026: "Glass for
// all"). The venue's is a short sheet, as tall as what's in it, with a grabber.
const MODAL = { presentation: 'modal', contentStyle: { backgroundColor: 'transparent' } } as const;
const SHEET = {
  presentation: 'formSheet',
  sheetAllowedDetents: 'fitToContents',
  sheetGrabberVisible: true,
  contentStyle: { backgroundColor: 'transparent' },
} as const;

export default function RootLayout() {
  const [loaded, error] = useFonts({
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    Sacramento_400Regular,
  });
  // On a font load error, carry on with the system font rather than a stuck splash.
  const ready = loaded || !!error;
  const [splashLeaving, setSplashLeaving] = useState(false);
  const [splashDone, setSplashDone] = useState(false);
  // The account as the API has it now: its name and roles may have changed since this phone last saw them.
  useEffect(() => {
    void refreshAccount();
  }, []);

  return (
    <>
      <StatusBar style="light" />
      {/* Home mounts underneath as soon as it can draw, so the splash's zoom lands on it; and if the
          splash starts leaving through its cap first, Home mounts then, never a blank screen. */}
      {(ready || splashLeaving) && (
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: color.ground },
          }}
        >
          {/* The tabs, Home and Search (src/app/(tabs)/_layout.tsx), with the location as a sheet over them: swipe down
              on iOS, back on Android. */}
          <Stack.Screen name="location" options={MODAL} />
          {/* A speaker, guest or anyone on an event, as a sheet over the event page the same way. The event and host
              pages (event/[slug], host/[slug]) push over the tabs as plain screens. */}
          <Stack.Screen name="person/[id]" options={MODAL} />
          {/* One page per event: without an id the stack matches event pages by name alone, so the person sheet's
              dismissTo would rewrite the event under it with another one. With it, dismissTo goes back to that event
              if it's open, or puts the event in the sheet's place; and opening an event that's already open brings
              that page to the top rather than a second copy. `dangerouslySingular` (getId's new name in expo-router 58)
              keys each page by its filled-in path, event/<slug>. */}
          <Stack.Screen name="event/[slug]" dangerouslySingular />
          {/* From the event page: Where opens the venue as a short sheet ("short modal"), When the agenda as a full
              modal ("Agenda full modal"), owner, 15 Nov 2026. */}
          <Stack.Screen name="venue/[slug]" options={SHEET} />
          <Stack.Screen name="agenda/[slug]" options={MODAL} />
          {/* The event's FAQ and terms ("add Event FAQ & Terms & Conditions Modals"). */}
          <Stack.Screen name="faq/[slug]" options={MODAL} />
          <Stack.Screen name="terms/[slug]" options={MODAL} />
          {/* Booking: an event's tickets, and a slot at a place to play. */}
          <Stack.Screen name="book/[slug]" options={MODAL} />
          <Stack.Screen name="slot/[venue]" options={MODAL} />
          {/* How to pay, over either booking sheet (src/app/pay.tsx). */}
          <Stack.Screen name="pay" options={MODAL} />
          {/* One thing inside a fest, from its page's Inside the fest. */}
          <Stack.Screen name="fest/[fest]/[item]" options={MODAL} />
          {/* Legal, from Account: every legal page in one sheet. */}
          <Stack.Screen name="legal" options={MODAL} />
          {/* The sign-in sheet (User flow), over whatever needed an account, so closing it lands back there. */}
          <Stack.Screen name="login" options={MODAL} />
          {/* Sign-in and security's sheets: Confirm it's you before a change (and Change number or email), and Rename
              passkey. Google's return link, which Android hands to the router too, lands on an empty screen that leaves
              at once (src/app/google.tsx). */}
          <Stack.Screen name="account/verify" options={MODAL} />
          <Stack.Screen name="account/passkey-name" options={MODAL} />
          <Stack.Screen name="google" options={{ presentation: 'transparentModal', animation: 'none', contentStyle: { backgroundColor: 'transparent' } }} />
          {/* Saved lists (Saved events and lists doc): the heart's list modal, a full modal like the location's (owner,
              16 Nov 2026: "instead of toast use modal, when clicked on love", "fix that modal"; the short sheet cut its
              lists off); naming a list from Account › Saved or renaming one, a full modal too. */}
          <Stack.Screen name="lists/[event]" options={MODAL} dangerouslySingular />
          <Stack.Screen name="list-name" options={MODAL} />
          {/* Your profile fades in over Account from its View profile (src/app/account/index.tsx), its top Account's
              panel grown. The swipe back still slides. */}
          <Stack.Screen name="account/profile" options={{ animation: 'fade' }} />
          {/* Edit profile's city for new events, the same city sheet as the location's. */}
          <Stack.Screen name="account/city" options={MODAL} />
        </Stack>
      )}
      {/* The note (Undo after removing saves, and the like), over every screen (src/note.tsx). */}
      <NoteHost />
      {!splashDone && <Splash ready={ready} onLeave={() => setSplashLeaving(true)} onDone={() => setSplashDone(true)} />}
    </>
  );
}
