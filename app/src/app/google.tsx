// Google's sign-in comes back to the app as heyorbit://google?grant=… (src/ways.ts, googleProof). On iOS the sign-in
// browser keeps it; on Android the link also reaches the router, which opens this route over the sign-in or security
// sheet. The browser has already handed the grant on, so this leaves at once and nothing moves underneath.
import { router } from 'expo-router';
import { useEffect } from 'react';

export default function GoogleReturn() {
  useEffect(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, []);
  return null;
}
