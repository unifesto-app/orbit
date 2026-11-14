import Image from "next/image";
import { mediaAspect, type MediaRatio } from "@orbit/contract";
import styles from "./media.module.css";

export type MediaItem = { src: string; ratio: MediaRatio };

// Shows an image whole, never cropped. `frame` sets the box's shape (event cards use 4:3 so the
// grid stays even); media of a different shape sits whole inside it over a blurred copy of itself.
export function Media({
  media,
  frame = media.ratio,
  alt,
  sizes,
  priority,
}: {
  media: MediaItem;
  frame?: MediaRatio;
  alt: string;
  sizes: string;
  priority?: boolean;
}) {
  const fits = frame === media.ratio;
  return (
    <div className={styles.frame} style={{ aspectRatio: mediaAspect[frame] }}>
      {!fits && <Image src={media.src} alt="" aria-hidden fill sizes={sizes} className={styles.backdrop} />}
      <Image src={media.src} alt={alt} fill sizes={sizes} priority={priority} className={fits ? styles.cover : styles.contain} />
    </div>
  );
}
