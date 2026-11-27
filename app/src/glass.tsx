// Shared with the host apps since 22 Nov 2026 (host apps plan, decision 14: moved, not copied).
// Here too: Orbit's own Reduce transparency and Reduce motion (Appearance), saved on the phone and read back
// synchronously at launch, as chatUsed.ts is, so the first frame already follows them.
import { forceAccessibility } from '@orbit/mobile/glass';
import Storage from 'expo-sqlite/kv-store';

export * from '@orbit/mobile/glass';

type Reduce = 'reduceTransparencyChanged' | 'reduceMotionChanged';
const key = (r: Reduce) => `orbit.${r}`;

for (const r of ['reduceTransparencyChanged', 'reduceMotionChanged'] as const) {
  try {
    if (Storage.getItemSync(key(r)) === '1') forceAccessibility(r, true);
  } catch {
    // Unreadable: off, so Orbit follows the phone alone.
  }
}

export function setReduce(r: Reduce, on: boolean) {
  forceAccessibility(r, on);
  try {
    Storage.setItemSync(key(r), on ? '1' : '0');
  } catch {
    // Not saved this time: it holds until the app closes.
  }
}
