// Any route that isn't open to this app or this person (a guarded screen, an old link): back to the start.
import { Redirect } from 'expo-router';

export default function NotFound() {
  return <Redirect href="/" />;
}
