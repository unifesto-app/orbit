import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT, LEGAL_UPDATED, OPEN_GRAPH, X_HANDLE } from "../../site";
import styles from "../legal.module.css";

// The waitlist's terms. A draft for the waitlist only; a lawyer reviews it before launch (orbit-plan.md, open item 17). The app gets its own terms at launch.
export const metadata: Metadata = {
  title: "Terms",
  description: "The terms for joining the Orbit waitlist.",
  alternates: { canonical: "/terms" },
  openGraph: { ...OPEN_GRAPH, url: "/terms", title: "Terms · Orbit", description: "The terms for joining the Orbit waitlist." },
  twitter: { card: "summary_large_image", site: X_HANDLE, title: "Terms · Orbit", description: "The terms for joining the Orbit waitlist." },
};

export default function Terms() {
  const mail = <a href={`mailto:${CONTACT}`}>{CONTACT}</a>;
  return (
    <article>
      <h1>Terms</h1>
      <p className={styles.updated}>Last updated {LEGAL_UPDATED}</p>

      <p>
        These terms cover the Orbit waitlist at heyorbit.in (“Orbit”, “we”). By joining the waitlist you agree to them and
        to the <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <h2>What the waitlist is</h2>
      <p>
        Orbit isn’t open yet. Joining puts your name on a list so we can tell you when it opens. It isn’t an Orbit account,
        and it’s free.
      </p>

      <h2>Who can join</h2>
      <ul>
        <li>You’re 18 or older.</li>
        <li>You use your own Indian (+91) WhatsApp number and email address, and your real name and date of birth.</li>
        <li>One entry for each number.</li>
      </ul>

      <h2>What we promise, and what we don’t</h2>
      <p>
        We’ll tell you by WhatsApp or email when Orbit opens. We don’t promise a date, a city, or any feature: the features listed
        are what we’re building, and they may change. A place on the waitlist doesn’t guarantee access.
      </p>

      <h2>Messages</h2>
      <p>
        Joining sends you a code on WhatsApp and a welcome email, and later, news of Orbit opening. To stop the messages, write to {mail}, and
        we’ll delete your entry.
      </p>

      <h2>Fair use</h2>
      <p>
        Don’t use bots or scripts, someone else’s number, or false details, and don’t try to break or overload the site. We
        may remove entries that do.
      </p>

      <h2>Our name and look</h2>
      <p>The Orbit name, wordmark, symbols and this site are ours. Please don’t copy them.</p>

      <h2>Liability</h2>
      <p>
        The waitlist is free and provided as it is. As far as the law allows, we aren’t liable for any loss from using it or
        from Orbit not opening when or as you expected.
      </p>

      <h2>Leaving, and changes</h2>
      <p>
        You can leave at any time by writing to {mail}. We may close the waitlist or change these terms; we’ll update this
        page and its date, and tell you by WhatsApp or email about any change that matters to you.
      </p>

      <h2>Law</h2>
      <p>These terms are governed by the laws of India, and the courts at Hyderabad, Telangana, decide any dispute.</p>

      <h2>Contact</h2>
      <p>{mail}</p>
    </article>
  );
}
