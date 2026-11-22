// The tab bar shrinks while a tab's screen scrolls down and comes back when it scrolls up (owner, 15 Nov 2026: "when
// scroll make the tab small and remove text", again on our own bar 19 Nov: "shrink the bar on scroll like before").
// A tab screen passes its scroll on with useTabBarScroll, as its Animated.event's listener; src/app/(tabs)/_layout.tsx
// provides where it goes.
import { createContext, useContext } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

export const TabBarScroll = createContext<(y: number) => void>(() => {});
// Whether the bar is small right now. Home's city line and Search's chips fold with it (owner, 19 Nov 2026: "Both",
// the Capsule take), inside the bar's own LayoutAnimation, since they re-render in the same commit.
export const TabBarSmall = createContext(false);
export const useTabBarSmall = () => useContext(TabBarSmall);

export const BAR = 52; // the capsule's and the orb's height (owner, 19 Nov 2026: "make them small", from 62)
export const SIDE = 16; // the bar's distance from the screen's sides

/** How far up the bar sits: on iOS low over the home indicator, as the system's bar does; on Android above its own. */
export function barBottom(insetBottom: number, ios: boolean): number {
  return ios ? Math.max(insetBottom - 12, 12) : insetBottom + 12;
}

/** The chat orb's centre on a `width` x `height` screen: the far right of the bar. The chat's colours spread from it. */
export function orbCentre(width: number, height: number, insetBottom: number, ios: boolean) {
  return { x: width - SIDE - BAR / 2, y: height - barBottom(insetBottom, ios) - BAR / 2 };
}

/** After a scroll step of `dy` points ending at `y`: true to shrink, false to open out, null to stay as it is. */
export function barAfterScroll(y: number, dy: number): boolean | null {
  if (y <= 40 || dy < -4) return false; // near the top, or any scroll up
  return dy > 4 ? true : null;
}

export function useTabBarScroll() {
  const onY = useContext(TabBarScroll);
  return (e: NativeSyntheticEvent<NativeScrollEvent>) => onY(e.nativeEvent.contentOffset.y);
}

// The bubble over the chat orb, nudging people to ask Orbit (owner, 19 Nov 2026: "add bubble at tab for ai button to
// make it use with a message. dont use same for all"). What it says fits the tab, the hour and the day; `roll` (0 to 1)
// picks among the lines that fit, so it differs from one showing to the next.
const NUDGES: Record<string, string[]> = {
  index: ['Tell me your mood, I’ll find a plan.', 'Bored? Ask me what’s good nearby.', 'Not sure what to do? Ask me.'],
  search: ['Can’t find it? Just ask me.', 'Describe it, I’ll look for you.', 'Need a turf or a gaming slot? Ask me.'],
};
export function orbNudge(tab: string, at: Date, roll: number): string {
  const hour = at.getHours();
  const day = at.getDay(); // 0 is Sunday
  const lines = [...(NUDGES[tab] ?? NUDGES.index)];
  if (hour >= 5 && hour < 12) lines.push('Morning! Anything you’d like to do today?');
  else if (hour >= 17 && hour < 21) lines.push('Free tonight? Ask me what’s on.');
  else if (hour >= 21 || hour < 5) lines.push('Still up? Ask me what’s on late.');
  if (day === 5 || day === 6 || day === 0) lines.push('Weekend plans? I can help.');
  return lines[Math.min(lines.length - 1, Math.floor(Math.max(0, roll) * lines.length))];
}
