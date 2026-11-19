import { palette } from '@orbit/tokens';
import { router } from 'expo-router';
import { type ComponentRef, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  type ImageSourcePropType,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Svg, { Defs, Image as SvgImage, LinearGradient, Mask, Rect, Stop } from 'react-native-svg';

import { DARK_TINT, Glass, useAccessibility } from '../glass';
import type { AppRatio } from '../media';
import { around, color, font, radius, rim, space, stoneAt } from '../theme';

export type CarouselSlide = {
  key: string;
  image: ImageSourcePropType;
  edge: string;
  label: string;
  action?: string; // the pill's label; no pill without one
  href?: string; // the event or host page the slide opens; a still poster without one
  mark?: string; // "Promoted" on a paid slide: the one word allowed over a poster, so the boost is never hidden
};

// ponytail: the owner set no timing; 5 s, pause while touched, loop, off under Reduce Motion or a screen reader
// are the proposed defaults.
const ADVANCE_MS = 5000;
const BLUR = 24; // the extension's blur
const FADE = 90; // how far into the poster the blur hands over to the sharp image

// Home's carousel (owner's calls, 15 Nov 2026): each slide is a 4:3 poster edge to edge, its top at the header's
// bottom (`top`), with the poster's own top-edge colour filling the space above, so it reads as running to the top.
// A light wash behind the header keeps it readable; one small pill centred at the bottom, no text on the poster.
// The event and host pages show their own poster or banner the same way (owner, 15 Nov 2026: "apply 4:3/ 3:4 poster
// full", "same like home page carousel"): one slide, so no dots, no paging and no auto-advance, and `ratio` 3:4 for an
// event that has no 4:3 poster. They pass `extend` off and `top` 0: the poster starts at the top of the screen, sharp,
// with no blurred extension above it and no wash over it (owner, 15 Nov 2026: "posters in detail pages top is blurred,
// disturbing the poster content", then "remove the poster top blur, instead start poster from top").
// `dark` (Home, owner 19 Nov 2026: "Both", the Capsule take): the pill and Promoted on the tab bar's dark glass, and the
// running dot filling Sage to Moss like the open tab's icon.
export function Carousel({
  slides,
  top,
  ratio = '4:3',
  extend = true,
  dark = false,
}: {
  slides: CarouselSlide[];
  top: number;
  ratio?: AppRatio;
  extend?: boolean;
  dark?: boolean;
}) {
  const { width } = useWindowDimensions();
  const posterHeight = ratio === '3:4' ? (width * 4) / 3 : (width * 3) / 4;
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
            scrollEnabled={slides.length > 1}
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
                {extend && (
                  <>
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
                  </>
                )}
                {!extend ? (
                  <Image
                    source={s.image}
                    resizeMode="cover"
                    style={{ position: 'absolute', top, width, height: posterHeight }}
                    accessible
                    accessibilityRole="image"
                    accessibilityLabel={s.label}
                  />
                ) : (
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
                    {/* The wash, measured in the same points as the poster, so its bottom is the poster's bottom. As a
                        separate full-size layer it came out about the top safe area short on the owner's phone, leaving
                        an undarkened strip along the bottom (owner, 15 Nov 2026: "issue in home screen carousel"). */}
                    <LinearGradient id={`wash${i}`} x1="0" y1="0" x2="0" y2={height} gradientUnits="userSpaceOnUse">
                      <Stop offset={0} stopColor={color.ground} stopOpacity={0.5} />
                      <Stop offset={top / height} stopColor={color.ground} stopOpacity={0.3} />
                      <Stop offset={(top + 38) / height} stopColor={color.ground} stopOpacity={0} />
                      <Stop offset={0.68} stopColor={color.ground} stopOpacity={0} />
                      <Stop offset={1} stopColor={color.ground} stopOpacity={s.action ? 0.35 : 0} />
                    </LinearGradient>
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
                  <Rect x="0" y="0" width={width} height={height} fill={`url(#wash${i})`} />
                </Svg>
                )}
              </View>
            ))}
          </ScrollView>
          {/* The app's frosted glass (src/glass.tsx). Only the pill opens the page, never the poster (owner, 15 Nov
            2026: "in home carousel, only the button should work"); a swipe that starts on it doesn't page. */}
          {slides[active].action && (
            <Pressable
              style={styles.pill}
              disabled={!slides[active].href}
              onPress={() => router.push(slides[active].href!)}
              accessibilityRole={slides[active].href ? 'button' : undefined}
              hitSlop={6}>
              <Glass style={styles.pillGlass} tint={dark ? DARK_TINT : undefined}>
                <Text style={styles.pillText}>{slides[active].action}</Text>
              </Glass>
            </Pressable>
          )}
          {/* A paid slide says so, small on the glass at the bottom left, level with the pill (owner, 19 Nov 2026). */}
          {slides[active].mark && (
            <Glass style={styles.mark} tint={dark ? DARK_TINT : undefined}>
              <Text style={styles.markText}>{slides[active].mark}</Text>
            </Glass>
          )}
        </View>
      </View>

      {slides.length > 1 && (
        <View style={styles.dots} accessible accessibilityLabel={`Slide ${active + 1} of ${slides.length}`}>
          {slides.map((s, i) =>
            i === active ? (
              <View key={s.key} style={styles.active}>
                <Animated.View style={[styles.fill, auto && { transform: [{ scaleX: progress }] }]}>
                  {dark && (
                    <Svg width={18} height={6}>
                      <Defs>
                        <LinearGradient id="dotFill" x1="0" y1="0" x2="1" y2="0">
                          <Stop offset={0} stopColor={palette.sage} />
                          <Stop offset={1} stopColor={palette.moss} />
                        </LinearGradient>
                      </Defs>
                      <Rect width={18} height={6} fill="url(#dotFill)" />
                    </Svg>
                  )}
                </Animated.View>
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

// The wash, drawn into each slide's poster (above): 50% at the top, behind the header, 30% where the poster starts,
// clear 38px below. A light shade at the bottom keeps the pill readable on bright posters; a slide with no pill has
// none. A wash over the poster, never a fade into the page.

// The bottom corners nest like the cards' (owner, 15 Nov 2026: "Inner Radius = Outer Radius - Padding", "even
// carousel"): the 6px corner plus the small gap gives 14, and the rim 16.
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
  layer: { position: 'absolute', top: 0, left: 0, pointerEvents: 'none' },
  pill: {
    position: 'absolute',
    alignSelf: 'center', // centred on the slide (owner, 15 Nov 2026: "in carousel, make the button center")
    bottom: space.small,
  },
  pillGlass: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 17, // fully round (owner: "rounded view ticket and view events and book ticket")
    justifyContent: 'center',
  },
  pillText: { fontFamily: font.title, fontSize: 13, color: color.text },
  // Centred on the pill's height (34): 24 tall, 5 lower.
  mark: { position: 'absolute', left: 20, bottom: space.small + 5, height: 24, paddingHorizontal: 10, borderRadius: 12, justifyContent: 'center', pointerEvents: 'none' },
  markText: { fontFamily: font.medium, fontSize: 11, color: color.text },
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
    backgroundColor: stoneAt(0.3),
  },
  active: {
    width: 18,
    height: 6,
    borderRadius: 3,
    backgroundColor: stoneAt(0.3),
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
