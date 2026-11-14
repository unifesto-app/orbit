import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Icon } from "../../icons";
import { Media } from "../../media";
import { allEvents, formatPrice, getEvent } from "../../mock";
import { seatsNote } from "../../seats";
import styles from "./page.module.css";

// Prerender every known event; an unknown slug falls through to the 404 page.
export function generateStaticParams() {
  return allEvents.map((e) => ({ slug: e.slug }));
}

// notFound() here too, so an unknown slug gets the 404 page's title. Because the details stream,
// the status stays 200; Next adds noindex, so search engines still drop it.
export async function generateMetadata({ params }: PageProps<"/event/[slug]">): Promise<Metadata> {
  const event = getEvent((await params).slug);
  if (!event) notFound();
  return { title: `${event.title} · Orbit`, description: event.about[0] };
}

const mapsUrl = (query: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;

const initials = (name: string) =>
  name.split(/[\s,]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

// The shell (back link) is shared by every event, so links can show it instantly; the slug is read
// inside Suspense so the details stream in (partial prefetching, see next.config.ts).
export default function Page({ params }: PageProps<"/event/[slug]">) {
  return (
    <main className={styles.main}>
      <Link href="/" className={styles.back}>
        <Icon name="back" size={18} />
        Discover
      </Link>
      <Suspense fallback={<Skeleton />}>
        <EventDetails params={params} />
      </Suspense>
    </main>
  );
}

function Skeleton() {
  return (
    <div className={styles.layout} aria-busy="true" aria-label="Loading event">
      <div className={`${styles.poster} ${styles.ghost}`} style={{ aspectRatio: "3 / 4" }} />
      <div className={styles.content}>
        <div className={styles.ghost} style={{ height: 44, width: "70%" }} />
        <div className={styles.ghost} style={{ height: 20, width: "40%" }} />
        <div className={styles.ghost} style={{ height: 260 }} />
      </div>
    </div>
  );
}

async function EventDetails({ params }: { params: Promise<{ slug: string }> }) {
  const event = getEvent((await params).slug);
  if (!event) notFound();

  const open = event.tiers.filter((t) => !t.soldOut);
  const paid = open.some((t) => t.pricePaise > 0);
  const left = event.capacity === null ? Infinity : event.capacity - event.taken;
  const maxQty = Math.max(1, Math.min(10, left));
  const note = seatsNote(event.taken, event.capacity);

  return (
    <div className={styles.layout}>
      {event.media && (
        <div className={styles.poster}>
          <Media media={event.media} alt={`Poster for ${event.title}`} sizes="(min-width: 960px) 30vw, 100vw" priority />
        </div>
      )}

      <div className={styles.content}>
        <header className={styles.head}>
          <p className={styles.status}>
            <span className={styles.dot} />
            {open.length ? "Registrations open" : "Sold out"}
          </p>
          <h1 className={styles.title}>{event.title}</h1>
          <p className={styles.by}>by {event.host}</p>
        </header>

        <ul className={styles.facts}>
          <li>
            <Icon name="calendar" size={22} className={styles.factIcon} />
            <span>
              <strong>{event.date}</strong>
              <span>{event.time}</span>
            </span>
          </li>
          <li>
            <Icon name="pin" size={22} className={styles.factIcon} />
            <span>
              <strong>{event.venue.name}</strong>
              <span>{event.venue.address}</span>
            </span>
          </li>
          {event.repeats && (
            <li>
              <Icon name="repeat" size={22} className={styles.factIcon} />
              <span>
                <strong>{event.repeats}</strong>
                <span>{event.host} runs this again and again</span>
              </span>
            </li>
          )}
        </ul>

        {/* Registration: pick a ticket, then sign in. Payment and the ticket itself come after sign-in. */}
        <section aria-labelledby="tickets" className={styles.panel}>
          <h2 id="tickets" className={styles.panelTitle}>Tickets</h2>
          {note && <p className={styles.meta}>{note}</p>}
          {open.length > 0 ? (
            <form action="/login" method="get" className={styles.form}>
              <input type="hidden" name="next" value={`/event/${event.slug}`} />
              <fieldset className={styles.tiers}>
                <legend className="sr-only">Ticket type</legend>
                {event.tiers.map((t) => (
                  <label key={t.id} className={styles.tier}>
                    <input type="radio" name="tier" value={t.id} defaultChecked={t.id === open[0].id} disabled={t.soldOut} required />
                    <span className={styles.tierText}>
                      <span className={styles.tierName}>{t.name}</span>
                      {t.note && <span className={styles.meta}>{t.note}</span>}
                    </span>
                    <span className={styles.tierPrice}>{t.soldOut ? "Sold out" : formatPrice(t.pricePaise)}</span>
                  </label>
                ))}
              </fieldset>
              <label className={styles.qty}>
                <span>Quantity</span>
                <select name="qty" defaultValue="1">
                  {Array.from({ length: maxQty }, (_, i) => (
                    <option key={i + 1} value={i + 1}>{i + 1}</option>
                  ))}
                </select>
              </label>
              <button type="submit" className="button">Register</button>
              <p className={styles.fine}>
                {paid ? "Next, sign in. You'll see the processing fee before you pay." : "Next, sign in to get your free ticket."}{" "}
                Your ticket shows up in the Orbit app.
              </p>
            </form>
          ) : (
            <p className={styles.meta}>Every ticket has been taken.</p>
          )}
        </section>

        <section aria-labelledby="about" className={styles.section}>
          <h2 id="about" className={styles.h2}>About</h2>
          {event.about.map((p) => (
            <p key={p} className={styles.prose}>{p}</p>
          ))}
        </section>

        {event.agenda && (
          <section aria-labelledby="agenda" className={styles.section}>
            <h2 id="agenda" className={styles.h2}>Agenda</h2>
            <ol className={styles.agenda}>
              {event.agenda.map((a) => (
                <li key={a.time}>
                  <span className={styles.meta}>{a.time}</span>
                  <span>{a.item}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section aria-labelledby="venue" className={styles.section}>
          <h2 id="venue" className={styles.h2}>Venue</h2>
          <p className={styles.prose}>
            <strong>{event.venue.name}</strong>
            <br />
            {event.venue.address}
          </p>
          <a href={mapsUrl(`${event.venue.name}, ${event.venue.address}`)} className={styles.link} rel="noopener">
            Open in Google Maps
          </a>
        </section>

        {event.faq && (
          <section aria-labelledby="faq" className={styles.section}>
            <h2 id="faq" className={styles.h2}>FAQ</h2>
            <div className={styles.faqs}>
              {event.faq.map((f) => (
                <details key={f.q} className={styles.faq}>
                  <summary>{f.q}</summary>
                  <p className={styles.prose}>{f.a}</p>
                </details>
              ))}
            </div>
          </section>
        )}

        <section aria-labelledby="host" className={styles.section}>
          <h2 id="host" className={styles.h2}>Hosted by</h2>
          <div className={styles.host}>
            <span className={styles.hostAvatar} aria-hidden="true">{initials(event.host)}</span>
            <span className={styles.hostText}>
              <strong>{event.host}</strong>
              <span className={styles.meta}>{event.hostKind}</span>
            </span>
          </div>
          {/* People come back by following the host; following lives in the app. */}
          <p className={styles.prose}>
            Follow {event.host} in the Orbit app to hear about their next one.{" "}
            <Link href="/app" className={styles.link}>Get the app</Link>
          </p>
        </section>
      </div>
    </div>
  );
}
