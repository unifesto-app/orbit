import { type ComponentRef, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  type ImageSourcePropType,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Svg, { Defs, Image as SvgImage, LinearGradient, Mask, Rect, Stop } from 'react-native-svg';

import { Glass, useAccessibility } from '../glass';
import { around, color, font, radius, rim, space } from '../theme';

export type CarouselSlide = {
  key: string;
  image: ImageSourcePropType;
  edge: string;
  label: string;
  action: string;
};

// ponytail: the owner set no timing; 5 s, pause while touched, loop, off under Reduce Motion or a screen reader
// are the proposed defaults.
const ADVANCE_MS = 5000;
const BLUR = 24; // the extension's blur
const FADE = 90; // how far into the poster the blur hands over to the sharp image

// Home's carousel (owner's calls, 15 Nov 2026): each slide is a 4:3 poster edge to edge, its top at the header's
// bottom (`top`), with the poster's own top-edge colour filling the space above, so it reads as running to the top.
// A light wash behind the header keeps it readable; bottom corners are radius.lg; one small pill, no text on the poster.
export function Carousel({ slides, top }: { slides: CarouselSlide[]; top: number }) {
  const { width } = useWindowDimensions();
  const posterHeight = (width * 3) / 4;
  const height = top + posterHeight;

  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  const [progress] = useState(() => new Animated.Value(0));
  const [index, setIndex] = useState(0);
  // A press and a drag are tracked apart: Android cancels the touch once the scroll takes over the gesture.
  const [touching, setTouching] = useState(false);
  const [dragging, setDragging] = useState(false);
  const reduceMotion = useAccessibility('reduceMotionChanged');
  const screenReader = useAccessibility('screenReaderChanged');
  const auto = slides.length > 1 && !reduceMotion && !screenReader;
  const active = Math.min(index, Math.max(0, slides.length - 1));

  // One timer per slide: fill the active dot, then page on. Swipes and this both move `index` through onScroll.
  useEffect(() => {
    if (!auto || touching || dragging) return;
    progress.setValue(0);
    const fill = Animated.timing(progress, {
      toValue: 1,
      duration: ADVANCE_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    fill.start(({ finished }) => {
      if (finished)
        scroller.current?.scrollTo({
          x: ((active + 1) % slides.length) * width,
          animated: true,
        });
    });
    return () => fill.stop();
  }, [auto, touching, dragging, active, slides.length, width, progress]);

  if (slides.length === 0) return null;

  return (
    <View>
      {/* The thin frosted rim along the bottom only (owner: "apply rim to carousel bottom", "fix the rim of carousel", then
          "carousel side rim shouldnt visible"): the slides run the full width, and the glass behind them shows rim px
          below and round the bottom corners, tapering into the straight sides. */}
      <View style={styles.rimRoom}>
        <Glass style={styles.rim} />
        <View style={[styles.clip, { height }]}>
          <ScrollView
            ref={scroller}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={(e) =>
              setIndex(Math.max(0, Math.min(slides.length - 1, Math.round(e.nativeEvent.contentOffset.x / width))))
            }
            onTouchStart={() => setTouching(true)}
            onTouchEnd={() => setTouching(false)}
            onTouchCancel={() => setTouching(false)}
            onScrollBeginDrag={() => setDragging(true)}
            onScrollEndDrag={() => setDragging(false)}
            onMomentumScrollEnd={() => setDragging(false)}>
            {slides.map((s, i) => (
              <View key={s.key} style={{ width, height, backgroundColor: s.edge }}>
                {/* The poster runs on to the top of the screen like an iOS wallpaper (owner, 15 Nov 2026: a flat colour,
                  then a mirror ending on a line, both showed a seam). Behind: the poster reflected upward and a copy in
                  place, blurred alike, so the blur crosses the poster's top edge without a seam. In front: the sharp
                  poster, faded in over its top FADE px, so detail like a grid dissolves into the blur. `edge` only
                  fills in while the image loads. */}
                <Image
                  source={s.image}
                  blurRadius={BLUR}
                  resizeMode="cover"
                  style={{
                    position: 'absolute',
                    top: top - posterHeight,
                    width,
                    height: posterHeight,
                    transform: [{ scaleY: -1 }],
                  }}
                />
                <Image
                  source={s.image}
                  blurRadius={BLUR}
                  resizeMode="cover"
                  style={{
                    position: 'absolute',
                    top,
                    width,
                    height: posterHeight,
                  }}
                />
                <Svg
                  width="100%"
                  height="100%"
                  style={styles.layer}
                  accessible
                  accessibilityRole="image"
                  accessibilityLabel={s.label}>
                  <Defs>
                    <LinearGradient
                      id={`fade${i}`}
                      x1="0"
                      y1={top}
                      x2="0"
                      y2={top + FADE}
                      gradientUnits="userSpaceOnUse">
                      <Stop offset={0} stopColor="#ffffff" stopOpacity={0} />
                      <Stop offset={1} stopColor="#ffffff" stopOpacity={1} />
                    </LinearGradient>
                    <Mask id={`mask${i}`} maskUnits="userSpaceOnUse" x="0" y="0" width={width} height={height}>
                      <Rect x="0" y={top} width={width} height={posterHeight} fill={`url(#fade${i})`} />
                    </Mask>
                  </Defs>
                  <SvgImage
                    href={s.image}
                    x="0"
                    y={top}
                    width={width}
                    height={posterHeight}
                    preserveAspectRatio="xMidYMid slice"
                    mask={`url(#mask${i})`}
                  />
                </Svg>
              </View>
            ))}
          </ScrollView>
          <Wash height={height} top={top} />
          {/* The app's frosted glass (src/glass.tsx). Not a button until the event and host screens exist, so it lets
            swipes through to the slides. */}
          <Glass style={styles.pill}>
            <Text style={styles.pillText}>{slides[active].action}</Text>
          </Glass>
        </View>
      </View>

      {slides.length > 1 && (
        <View style={styles.dots} accessible accessibilityLabel={`Slide ${active + 1} of ${slides.length}`}>
          {slides.map((s, i) =>
            i === active ? (
              <View key={s.key} style={styles.active}>
                <Animated.View style={[styles.fill, auto && { transform: [{ scaleX: progress }] }]} />
              </View>
            ) : (
              <View key={s.key} style={styles.dot} />
            ),
          )}
        </View>
      )}
    </View>
  );
}

// Behind the header: 50% at the top, 30% where the poster starts, clear 38px below. A light shade at the
// bottom keeps the pill readable on bright posters. A wash over the poster, never a fade into the page.
// Sized in % so it reaches the exact edge (react-native-svg rounds numeric sizes down to whole points).
function Wash({ height, top }: { height: number; top: number }) {
  return (
    <Svg width="100%" height="100%" style={styles.wash}>
      <Defs>
        <LinearGradient id="wash" x1="0" y1="0" x2="0" y2="1">
          <Stop offset={0} stopColor={color.ground} stopOpacity={0.5} />
          <Stop offset={top / height} stopColor={color.ground} stopOpacity={0.3} />
          <Stop offset={(top + 38) / height} stopColor={color.ground} stopOpacity={0} />
          <Stop offset={0.68} stopColor={color.ground} stopOpacity={0} />
          <Stop offset={1} stopColor={color.ground} stopOpacity={0.35} />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#wash)" />
    </Svg>
  );
}

// Corners nest outward from the pill (owner, 15 Nov 2026: "Inner Radius = Outer Radius - Padding", "even carousel"): the
// pill's corner plus the small gap it sits in from the edges gives the carousel's bottom corners (6 + 8 = 14), and the
// rim 16.
const BOTTOM = around(radius.md, space.small);

const styles = StyleSheet.create({
  rimRoom: { paddingBottom: rim },
  // One rounded shape behind the slides (native glass rounds all corners alike); the slides cover all but its bottom.
  rim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: around(BOTTOM, rim),
  },
  clip: {
    borderBottomLeftRadius: BOTTOM,
    borderBottomRightRadius: BOTTOM,
    overflow: 'hidden',
  },
  wash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    pointerEvents: 'none',
  },
  layer: { position: 'absolute', top: 0, left: 0, pointerEvents: 'none' },
  pill: {
    position: 'absolute',
    left: space.small,
    bottom: space.small,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 17, // fully round (owner: "rounded view ticket and view events and book ticket")
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  pillText: { fontFamily: font.title, fontSize: 13, color: color.text },
  dots: {
    marginTop: space.small,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  active: {
    width: 18,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    overflow: 'hidden',
  },
  // Scaled from the left on the native thread while the slide's time runs.
  fill: {
    width: 18,
    height: 6,
    backgroundColor: color.accent,
    transformOrigin: 'left',
  },
});
