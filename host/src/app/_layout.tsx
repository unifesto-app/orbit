import { DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold } from '@expo-google-fonts/dm-sans';
import { PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans';
import { Sacramento_400Regular } from '@expo-google-fonts/sacramento';
import { role } from '@orbit/tokens';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

// The Orbit app's type (@orbit/mobile/theme's `font` names): Plus Jakarta Sans for heads, DM Sans for text.
export default function Layout() {
  const [loaded, error] = useFonts({ Sacramento_400Regular, DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold });
  if (!loaded && !error) return null;
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: role.ground } }} />
    </>
  );
}
