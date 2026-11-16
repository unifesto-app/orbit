// Google's sign-in comes back to the app as heyorbit://google?grant=… (src/ways.ts, googleProof). On iOS the sign-in
// browser keeps it; on Android the link also reaches the router, which opens this route over the sign-in or security
// sheet. It hands the grant (or the error) to the sign-in waiting for it, then leaves at once.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { googleReturned } from '../ways';

export default function GoogleReturn() {
  const { grant, error } = useLocalSearchParams<{ grant?: string; error?: string }>();
  useEffect(() => {
    googleReturned({ grant, error });
    if (router.canGoBack()) router.back();
    else router.replace('/');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, as it opens
  }, []);
  return null;
}
