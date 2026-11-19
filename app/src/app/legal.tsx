// Legal (owner, 19 Nov 2026: "add Legal Modal instead of many, inside that add the pages"): Account's one Legal row
// opens this sheet, with every legal page in one card, each opening on heyorbit.in (web/src/app/(legal)) with the ↗ an
// outside link has. A new page is a new line in PAGES.
import { Linking } from 'react-native';

import { Group, Row, TONE } from '../account/kit';
import type { IconName } from '../icons';
import { Sheet } from '../rows';

const WWW = 'https://heyorbit.in';
const PAGES: { label: string; path: string; icon: IconName; tone: string }[] = [
  { label: 'Terms of service', path: '/terms', icon: 'terms', tone: TONE.cyan },
  { label: 'Privacy policy', path: '/privacy', icon: 'privacy', tone: TONE.violet },
];

export default function Legal() {
  return (
    <Sheet title="Legal">
      <Group flush>
        {PAGES.map((p) => (
          <Row key={p.path} icon={p.icon} tone={p.tone} label={p.label} external onPress={() => Linking.openURL(`${WWW}${p.path}`)} />
        ))}
      </Group>
    </Sheet>
  );
}
