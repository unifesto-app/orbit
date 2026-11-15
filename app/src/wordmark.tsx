// The ORBIT wordmark, drawn from the splash's letters (assets/splash/letter-*.svg), so there is one source for the
// logo. Used at the foot of Account and of the mode switcher (owner, 16 Nov 2026: "add orbit logo at bottom").
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { loadLocalRawResource } from 'react-native-svg/css';

// The letters share one coordinate space, so drawn together they are the whole mark, MARK_BOX wide and tall.
const LETTERS = [
  require('../assets/splash/letter-o.svg'),
  require('../assets/splash/letter-r.svg'),
  require('../assets/splash/letter-b.svg'),
  require('../assets/splash/letter-i.svg'),
  require('../assets/splash/letter-t.svg'),
];
const MARK_BOX = '36 -682 5371 682'; // x, y, width, height in the letters' space

export function Wordmark({ width }: { width: number }) {
  const [xml, setXml] = useState<string | null>(null);
  useEffect(() => {
    Promise.all(LETTERS.map((f) => loadLocalRawResource(f)))
      .then((files) => {
        const paths = files.map((f) => f.match(/<path[^>]*\/>/)?.[0] ?? '').join('');
        setXml(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_BOX}">${paths}</svg>`);
      })
      .catch(() => {}); // a file that fails to load leaves the space empty, as on the splash
  }, []);
  const height = (width * 682) / 5371;
  return (
    <View style={{ width, height }} accessible accessibilityRole="image" accessibilityLabel="Orbit">
      {xml && <SvgXml xml={xml} width={width} height={height} />}
    </View>
  );
}
