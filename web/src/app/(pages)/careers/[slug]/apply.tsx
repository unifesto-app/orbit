"use client";

import { startTransition, useActionState } from "react";
import { useTurnstile } from "../../../turnstile";
import type { Applied } from "../actions";
import styles from "../careers.module.css";

// The Apply form under an opening: who they are, a PDF résumé, and anything else they'd like to send. Sent by hand
// (onSubmit), so a refused send keeps everything typed and the file chosen: React empties a form after its own action.
// `action` is still set: before the page's script has loaded, React's placeholder for it stops the browser sending the
// form itself, which would put the name, email and phone in the address. Once loaded, a prevented submit never runs it.

// The API's cap (contract RESUME_MAX_BYTES), checked here too: past 6 MB Next refuses the send before the action runs,
// which would read as "can't reach Orbit". Kept here so the contract's schemas stay off the browser.
const MAX_BYTES = 5 * 1024 * 1024;
const TOO_BIG = "That file is over 5 MB. Attach a smaller PDF.";

export function ApplyForm({ action, turnstile }: { action: (prev: Applied, data: FormData) => Promise<Applied>; turnstile?: string }) {
  const check = useTurnstile(turnstile);
  const [s, act, pending] = useActionState(async (prev: Applied, data: FormData): Promise<Applied> => {
    if (prev.done) return prev; // a second tap after sending
    const resume = data.get("resume");
    if (resume instanceof File && resume.size > MAX_BYTES) return { error: TOO_BIG };
    try {
      data.set("turnstile", (await check.take()) ?? "");
      return await action(prev, data);
    } catch {
      return { error: "Can't reach Orbit right now. Try again in a minute." };
    }
  }, {});

  if (s.done)
    return (
      <div role="status" className={styles.done}>
        <p className={styles.doneTitle}>Thanks, {s.done.name}. Your application is in.</p>
        <p>We read every one. If it’s a fit, we’ll write to you at {s.done.email}.</p>
      </div>
    );

  return (
    <form
      action={act}
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => act(data));
      }}
    >
      <label className={styles.field}>
        <span>Name</span>
        <input name="name" required maxLength={100} autoComplete="name" />
      </label>
      <label className={styles.field}>
        <span>Email</span>
        <input name="email" type="email" required maxLength={254} autoComplete="email" placeholder="you@example.com" />
      </label>
      <label className={styles.field}>
        <span>
          Phone <em>Optional</em>
        </span>
        <input name="phone" type="tel" inputMode="tel" maxLength={20} autoComplete="tel" placeholder="+91 98765 43210" />
      </label>
      <label className={styles.field}>
        <span>
          LinkedIn <em>Optional</em>
        </span>
        <input name="linkedin" inputMode="url" maxLength={300} autoComplete="url" placeholder="linkedin.com/in/you" />
      </label>
      <label className={styles.field}>
        <span>
          Your work <em>Optional</em>
        </span>
        <input name="link" inputMode="url" maxLength={300} placeholder="A portfolio, GitHub or anything you’ve made" />
      </label>
      <label className={styles.field}>
        <span>Résumé (PDF, up to 5 MB)</span>
        <input name="resume" type="file" required accept="application/pdf,.pdf" className={styles.file} />
      </label>
      <label className={styles.field}>
        <span>
          Anything you’d like us to know <em>Optional</em>
        </span>
        <textarea name="note" rows={5} maxLength={2000} />
      </label>
      <label className={styles.agree}>
        <input type="checkbox" name="agree" required />
        <span>
          I agree to Orbit keeping these details to consider me for this role, as the{" "}
          <a href="/privacy" target="_blank">
            Privacy Policy
          </a>{" "}
          says.
        </span>
      </label>
      {s.error && (
        <p role="alert" className={styles.error}>
          {s.error}
        </p>
      )}
      <button type="submit" className="button" disabled={pending}>
        {pending ? "Sending…" : "Send application"}
      </button>
      {check.widget}
    </form>
  );
}
