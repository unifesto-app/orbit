"use client";

// Coming Soon's waitlist (owner, 17 Nov 2026: "add express interest and collect info, email", "use join the
// waitlist"). Before sending, the page adds what it can see of the visit: where it came from, the link's utm_ tags, the
// time zone, language and screen.
import { useActionState } from "react";
import { expressInterest, type Sent } from "./actions";
import styles from "./page.module.css";

function visit() {
  const utm = Object.fromEntries([...new URLSearchParams(location.search)].filter(([k]) => k.startsWith("utm_")).slice(0, 10).map(([k, v]) => [k.slice(0, 40), v.slice(0, 200)]));
  return JSON.stringify({
    referrer: document.referrer.slice(0, 1000) || undefined,
    utm: Object.keys(utm).length ? utm : undefined,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone?.slice(0, 64),
    language: navigator.language?.slice(0, 35),
    screen: `${screen.width}x${screen.height}@${Math.round(devicePixelRatio * 100) / 100}`.slice(0, 20),
  });
}

export function InterestForm() {
  const [sent, send, pending] = useActionState<Sent, FormData>(expressInterest, null);

  if (sent?.ok)
    return (
      <p role="status" className={styles.done}>
        You&apos;re on the waitlist. We&apos;ll email you when Orbit opens.
      </p>
    );
  return (
    <form
      className={styles.form}
      action={(form) => {
        form.set("visit", visit());
        send(form);
      }}
    >
      <label htmlFor="email" className="sr-only">
        Email
      </label>
      <input id="email" name="email" type="email" required maxLength={254} autoComplete="email" placeholder="Your email" defaultValue={sent?.ok === false ? sent.email : ""} className={styles.input} />
      <button type="submit" className={`button ${styles.send}`} disabled={pending}>
        {pending ? "Joining…" : "Join the waitlist"}
      </button>
      {sent && !sent.ok && (
        <p role="alert" className={styles.error}>
          {sent.error}
        </p>
      )}
    </form>
  );
}
