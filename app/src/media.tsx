import { mediaAspect, type MediaRatio } from '@orbit/contract';
import { Image, type ImageSourcePropType, StyleSheet, View } from 'react-native';

import { color } from './theme';

export type MediaItem = { source: ImageSourcePropType; ratio: MediaRatio };

// Shows an image whole, never cropped (owner's rule; same as web's Media). `frame` sets the box's
// shape; media of a different shape sits whole inside it over a blurred copy of itself.
export function Media({ media, frame = media.ratio, label }: { media: MediaItem; frame?: MediaRatio; label?: string }) {
  const fits = frame === media.ratio;
  return (
    <View
      style={[styles.frame, { aspectRatio: mediaAspect[frame] }]}
      accessible={!!label}
      accessibilityRole={label ? 'image' : undefined}
      accessibilityLabel={label}>
      {!fits && <Image source={media.source} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={24} />}
      <Image source={media.source} style={StyleSheet.absoluteFill} resizeMode={fits ? 'cover' : 'contain'} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', overflow: 'hidden', backgroundColor: color.raised },
});
