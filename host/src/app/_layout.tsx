import { Sacramento_400Regular } from '@expo-google-fonts/sacramento';
import { role } from '@orbit/tokens';
import { Stack } from 'expo-router';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';

export default function Layout() {
  const [loaded, error] = useFonts({ Sacramento_400Regular });
  if (!loaded && !error) return null;
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: role.ground } }} />
    </>
  );
}
