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

// Read once per launch, not on every mount: the files are async reads (over the network from Metro in a dev build), so
// reading per mount made the mark pop in each time Account or the switcher opened. Splash warms it at launch.
let cached: string | null = null;
let pending: Promise<string> | null = null;
export function loadWordmark(): Promise<string> {
  pending ??= Promise.all(LETTERS.map((f) => loadLocalRawResource(f)))
    .then((files) => {
      // Android release builds resolve null for a file they couldn't read; f.match then throws, which lands below.
      const paths = files.map((f) => f.match(/<path[^>]*\/>/)?.[0] ?? '').join('');
      return (cached = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_BOX}">${paths}</svg>`);
    })
    .catch((e) => {
      pending = null; // not cached, so the next mount tries again
      throw e;
    });
  return pending;
}

export function Wordmark({ width }: { width: number }) {
  const [xml, setXml] = useState(cached);
  useEffect(() => {
    if (!xml) loadWordmark().then(setXml, () => {}); // a file that fails to load leaves the space empty, as on the splash
  }, [xml]);
  const height = (width * 682) / 5371;
  return (
    <View style={{ width, height }} accessible accessibilityRole="image" accessibilityLabel="Orbit">
      {xml && <SvgXml xml={xml} width={width} height={height} />}
    </View>
  );
}
