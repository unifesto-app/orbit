// Discover pieces shared by the home page and /search.
import Link from "next/link";
import styles from "./discover.module.css";
import { Icon, type IconName } from "./icons";
import { Media } from "./media";
import { allEvents, type EventCard, formatPrice } from "./mock";
import { seatsNote } from "./seats";

// Categories are browse tiles only (plan, section 4). No alcohol or nightlife categories.
export const categories: { slug: string; label: string; icon: IconName }[] = [
  { slug: "hackathons", label: "Hackathons", icon: "code" },
  { slug: "comedy", label: "Comedy", icon: "comedy" },
  { slug: "music", label: "Music", icon: "music" },
  { slug: "meetups", label: "Meetups", icon: "group" },
  { slug: "workshops", label: "Workshops", icon: "workshop" },
  { slug: "fests", label: "Fests", icon: "fest" },
  { slug: "sports", label: "Sports", icon: "sports" },
  { slug: "theatre", label: "Theatre", icon: "theatre" },
  { slug: "art", label: "Art", icon: "art" },
  { slug: "film", label: "Film", icon: "film" },
  { slug: "startups", label: "Startups", icon: "startup" },
  { slug: "gaming", label: "Gaming", icon: "gaming" },
];

// Events matching a query and/or category. Used by /search and /api/search.
// ponytail: substring match over the mock list; the API's search replaces this.
export function searchEvents(q: string, category?: string): EventCard[] {
  const needle = q.trim().toLowerCase();
  const label = (slug: string) => categories.find((c) => c.slug === slug)?.label ?? "";
  return allEvents.filter(
    (e) =>
      (!category || e.category === category) &&
      (!needle || [e.title, e.host, e.area, label(e.category)].some((f) => f.toLowerCase().includes(needle))),
  );
}

export function EventGrid({ events }: { events: EventCard[] }) {
  return (
    <ul className={styles.grid}>
      {events.map((e) => {
        const note = seatsNote(e.taken, e.capacity);
        return (
          <li key={e.slug}>
            <Link href={`/event/${e.slug}`} className={styles.card}>
              {/* Cards keep a 4:3 frame so the grid stays even; the title beside it names the event. */}
              {e.media && <Media media={e.media} frame="4:3" alt="" sizes="(min-width: 960px) 380px, (min-width: 640px) 50vw, 100vw" />}
              <span className={styles.cardBody}>
                <span className={styles.when}>
                  <span className={styles.meta}>{e.date} · {e.time}</span>
                  {/* Hosts with a following run things again and again: say so on the card. */}
                  {e.repeats && (
                    <span className={styles.repeat}>
                      <Icon name="repeat" size={14} />
                      {e.repeats}
                    </span>
                  )}
                </span>
                <h3 className={styles.cardTitle}>{e.title}</h3>
                <span className={styles.meta}>{e.host} · {e.area}</span>
                <span className={styles.cardFoot}>
                  <span className={styles.cardPrice}>{formatPrice(e.pricePaise)}</span>
                  {note && <span className={styles.meta}>{note}</span>}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
