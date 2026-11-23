import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT, OPEN_GRAPH, PRIVACY_UPDATED, X_HANDLE } from "../../site";
import styles from "../legal.module.css";

// The waitlist's privacy policy: exactly what the page and the API keep (api/src/prelaunch.ts, contract
// InterestMeta) and why. A draft for the waitlist only, written to India's DPDP Act; a lawyer reviews it before launch
// (orbit-plan.md, open item 17).
export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What Orbit keeps when you join the waitlist, why, and how to have it deleted.",
  alternates: { canonical: "/privacy" },
  openGraph: { ...OPEN_GRAPH, url: "/privacy", title: "Privacy Policy · Orbit", description: "What Orbit keeps when you join the waitlist, why, and how to have it deleted." },
  twitter: { card: "summary_large_image", site: X_HANDLE, title: "Privacy Policy · Orbit", description: "What Orbit keeps when you join the waitlist, why, and how to have it deleted." },
};

export default function Privacy() {
  const mail = <a href={`mailto:${CONTACT}`}>{CONTACT}</a>;
  return (
    <article>
      <h1>Privacy Policy</h1>
      <p className={styles.updated}>Last updated {PRIVACY_UPDATED}</p>

      <p>
        This policy covers the Orbit website at heyorbit.in (“Orbit”, “we”): its waitlist, and job applications sent from
        its careers pages.
      </p>

      <h2>What we keep</h2>
      <p>What you give us when you join:</p>
      <ul>
        <li>Your name, WhatsApp number, email address and date of birth.</li>
        <li>The features you pick, if any.</li>
      </ul>
      <p>What your visit tells us when you join:</p>
      <ul>
        <li>Your IP address, and the country (and region and city, where available) our network provider reads from it.</li>
        <li>Your browser and device: its name and version, language, time zone and screen size.</li>
        <li>The page or link that brought you here, and any campaign tags on it.</li>
        <li>When you joined.</li>
      </ul>
      <p>
        Like most websites, our servers also keep a short access log (IP address, time, the page asked for and the browser)
        for up to 180 days, to keep the site secure. We don’t ask for payment details, and we don’t use advertising or
        analytics cookies.
      </p>
      <p>What we count from every visit, whether or not you join:</p>
      <ul>
        <li>
          The page you open, where you came from (as a name like Instagram or LinkedIn), the kind of device and browser,
          and the country, region and city our network provider reads from your IP address.
        </li>
        <li>How long the page was on screen, how fast it loaded, and whether you started the form, got a code and joined, or sent a job application.</li>
      </ul>
      <p>
        We count visits to see which links bring people and how the site works for them. We use no cookies, and we don’t
        keep your IP address, name or number with these counts. To count a visitor once a day, we make a code from your
        network address and browser using a random key that changes every day; the key is deleted when its day ends, so
        the code can’t be made again afterwards. We keep these counts for up to 180 days.
      </p>

      <h2>If you apply for a job</h2>
      <p>
        When you apply for a role at heyorbit.in/careers, we keep what you send: your name and email address, your
        résumé, and your phone number, LinkedIn, work link and note if you give them, with when you applied and your IP
        address. We use it only to consider you for that role and to write to you about it. Only the Orbit staff who
        handle hiring can see it, and every time they open it is recorded. We keep it while the role is open, and delete
        it, résumé included, within 12 months of the role closing, or sooner if you ask by writing to {mail}. When
        it’s in, we send you one email to say so.
      </p>

      <h2>Why we keep it</h2>
      <ul>
        <li>To check the WhatsApp number is yours, with a 6-digit code.</li>
        <li>To check you’re 18 or over. If you’re not, your entry isn’t kept.</li>
        <li>To send you one email when you join, and to tell you by WhatsApp or email when Orbit opens.</li>
        <li>To decide what to build first and where, from the features people pick.</li>
        <li>To keep the waitlist free of bots and abuse.</li>
        <li>To see which pages and links bring visitors, and to make the site faster.</li>
      </ul>
      <p>We never sell your data or use it for advertising.</p>

      <h2>Your consent</h2>
      <p>
        We keep this because you agree to it when you join. You can withdraw that at any time by writing to {mail}; we then
        delete your entry.
      </p>

      <h2>Who handles it for us</h2>
      <ul>
        <li>Amazon Web Services, which runs our servers and database and sends our emails.</li>
        <li>Cloudflare, which runs our network and the check that you’re not a bot.</li>
        <li>Meta, which delivers our WhatsApp messages.</li>
        <li>Sentry, which tells us when something on our servers breaks.</li>
      </ul>
      <p>They handle it only to provide these services to us.</p>

      <h2>How long we keep it</h2>
      <p>Until Orbit opens and for up to 12 months after, unless you ask us to delete it sooner.</p>

      <h2>How we protect it</h2>
      <p>
        It travels encrypted and is stored on our own servers. Only the Orbit staff who need it can see the waitlist, and
        every time they look is recorded.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask to see what we keep about you, to correct it, or to delete it, and you can name someone to act for you.
        Write to {mail} from the details you joined with. We reply within 30 days. If you’re unhappy with our answer, you
        can complain to the Data Protection Board of India.
      </p>

      <h2>Under 18</h2>
      <p>Orbit is for people 18 and over. If a date of birth shows someone is under 18, no waitlist entry is kept.</p>

      <h2>Changes</h2>
      <p>
        If this policy changes, we’ll update this page and its date. If a change affects what we keep or why, we’ll tell
        you by WhatsApp or email first.
      </p>

      <h2>Contact</h2>
      <p>
        Questions, requests and complaints: {mail}. See also the <Link href="/terms">Terms</Link>.
      </p>
    </article>
  );
}
