// Orbit's bubbles live in @orbit/mobile (shared with the host apps since 22 Nov 2026); opening the chat is the people
// app's own.
import { router } from 'expo-router';
import { Keyboard } from 'react-native';

export { type Answer, ORB, OrbitSays } from '@orbit/mobile/orbitSays';

/** Opens the chat, with `ask` typed in its field when given (src/app/chat.tsx reads it), the keyboard put away first. */
export function askOrbit(ask?: string) {
  Keyboard.dismiss();
  router.push(ask ? { pathname: '/chat', params: { ask } } : '/chat');
}
