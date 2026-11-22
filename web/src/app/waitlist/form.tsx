"use client";

import { useActionState, useState } from "react";
import { type Details, join, sendCode, type Step } from "./actions";
import styles from "../site.module.css";
import { useTurnstile } from "../turnstile";
import { formStarted, pageFacts, viewId } from "../visit";

// Two steps and nothing else (owner, 18 Nov 2026: "very simple for user to complete it"): the details with the features
// they'd love (optional), then the WhatsApp code, which sends itself once six digits are in. `features` comes from the
// page, so the contract's schemas stay off the browser.

const FRESH = 9 * 60_000; // a code lasts 10 minutes (api auth/codes.ts); one sent within 9 is still worth typing

const digits = (phone: string) => phone.replace(/\D/g, "").slice(-10);
const shown = (phone: string) => `+91 ${digits(phone).slice(0, 5)} ${digits(phone).slice(5)}`; // "+91 98765 43210"

// The details as typed, for going back to step 2 without a new send; the server checks them all at join.
const typed = (data: FormData): Details => ({
  name: String(data.get("name") ?? "").trim(),
  phone: String(data.get("phone") ?? "").trim(),
  email: String(data.get("email") ?? "").trim(),
  dob: String(data.get("dob") ?? ""),
  features: data.getAll("features").map(String) as Details["features"],
  agree: data.get("agree") === "on",
});

const asForm = (d: Details) => {
  const f = new FormData();
  f.set("name", d.name);
  f.set("phone", d.phone);
  f.set("email", d.email);
  f.set("dob", d.dob);
  d.features.forEach((k) => f.append("features", k));
  if (d.agree) f.set("agree", "on");
  f.set("again", "1");
  return f;
};

const OFFLINE = "Can't reach Orbit right now. Try again in a minute.";

// After joining (owner, 18 Nov 2026: "after joined waitlist add share with your network button"): the phone's own share
// sheet (WhatsApp, Instagram, LinkedIn, X), or the link copied where there's none (most desktop browsers). The link is
// tagged, so Galaxy's Campaign column shows who came from a share.
function Share() {
  const [said, say] = useState<string>();
  async function share() {
    const url = `${location.origin}/waitlist?utm_source=waitlist&utm_medium=share`;
    const text = "I’m on the Orbit waitlist. There’s more to live beyond the usual.";
    try {
      if (navigator.share) return await navigator.share({ title: "Orbit", text, url });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return; // they closed the sheet
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      say("Link copied. Paste it anywhere.");
    } catch {
      say(url); // no clipboard either: the link to copy by hand
    }
  }
  return (
    <>
      <button type="button" className={`button ${styles.share}`} onClick={share}>
        Share with your network
      </button>
      {/* Always there, so a screen reader announces the text when it appears. */}
      <p role="status" className={said ? styles.note : undefined}>
        {said}
      </p>
    </>
  );
}

export function Waitlist({ features, turnstile }: { features: [string, string][]; turnstile?: string }) {
  const check = useTurnstile(turnstile);

  // Step 1 sends a code, unless only the name or date changed and the last code is still good. Step 2 joins, or its
  // own buttons change the details or send a new code. A call that fails (offline, or a page from before a deploy)
  // keeps the step and says so, instead of losing the form.
  async function step(prev: Step, data: FormData): Promise<Step> {
    if (prev.at === "done") return prev; // a second tap after joining
    const sent = prev.sent;
    try {
      if (prev.at === "details") {
        if (sent && digits(String(data.get("phone") ?? "")) === sent.phone && Date.now() - sent.at < FRESH) {
          data.set("reuse", "1"); // checked by the server like a send, but no new code
          const r = await sendCode(data);
          return r.at === "done" ? r : { ...r, sent };
        }
        data.set("turnstile", (await check.take()) ?? "");
        data.set("view", viewId() ?? "");
        return stamp(await sendCode(data), sent);
      }
      const intent = data.get("intent");
      if (intent === "edit") return { at: "details", form: prev.form, sent };
      if (intent === "again") {
        const again = asForm(prev.form);
        again.set("turnstile", (await check.take()) ?? "");
        again.set("view", viewId() ?? "");
        return stamp(await sendCode(again), sent);
      }
      data.set("visit", JSON.stringify(pageFacts()));
      data.set("view", viewId() ?? "");
      const r = await join(prev.form, data);
      return r.at === "done" ? r : { ...r, sent };
    } catch {
      return prev.at === "details" ? { at: "details", form: typed(data), error: OFFLINE, sent } : { ...prev, error: OFFLINE, note: undefined };
    }
  }

  const [s, act, pending] = useActionState(step, { at: "details" });

  if (s.at === "done")
    return (
      <div className={styles.done}>
        <div role="status" className={styles.joined}>
          <p className={styles.aside}>see you soon</p>
          <h2 className={styles.title}>You’re in, {s.name}</h2>
        </div>
        <Share />
      </div>
    );

  return (
    <form action={act} className={styles.form} onFocus={formStarted}>
      <div className={styles.track} aria-hidden="true">
        <span style={{ width: s.at === "details" ? "50%" : "100%" }} />
      </div>

      {s.at === "details" ? (
        <>
          <h2 className={styles.title}>Join the waitlist</h2>
          <label className={styles.field}>
            <span>Name</span>
            <input name="name" required maxLength={100} autoComplete="name" defaultValue={s.form?.name} />
          </label>
          <label className={styles.field}>
            <span>WhatsApp number</span>
            <span className={styles.phone}>
              <span aria-hidden="true">+91</span>
              <input name="phone" type="tel" inputMode="tel" required maxLength={20} autoComplete="tel-national" placeholder="98765 43210" defaultValue={s.form?.phone} />
            </span>
          </label>
          <label className={styles.field}>
            <span>Email</span>
            <input name="email" type="email" required maxLength={254} autoComplete="email" placeholder="you@example.com" defaultValue={s.form?.email} />
          </label>
          <label className={styles.field}>
            <span>Date of birth</span>
            <input name="dob" type="date" required min="1900-01-01" defaultValue={s.form?.dob} />
          </label>
          <fieldset className={styles.wants}>
            <legend>
              What would you love to use? <span>Optional</span>
            </legend>
            <div className={styles.chips}>
              {features.map(([key, label]) => (
                <label key={key} className={styles.chip}>
                  <input type="checkbox" name="features" value={key} defaultChecked={s.form?.features.includes(key as Details["features"][number])} />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <label className={styles.agree}>
            <input type="checkbox" name="agree" required defaultChecked={s.form?.agree} />
            <span>
              I’m 18 or older and I agree to the{" "}
              <a href="/terms" target="_blank">
                Terms
              </a>{" "}
              and{" "}
              <a href="/privacy" target="_blank">
                Privacy Policy
              </a>
              .
            </span>
          </label>
          {s.error && (
            <p role="alert" className={styles.error}>
              {s.error}
            </p>
          )}
          <button type="submit" className="button" disabled={pending}>
            {pending ? "Sending…" : "Get code on WhatsApp"}
          </button>
        </>
      ) : (
        <>
          <h2 className={styles.title}>Enter the code</h2>
          <p className={styles.sent}>Sent to {shown(s.form.phone)} on WhatsApp.</p>
          <label className={styles.field}>
            <span className="sr-only">6-digit code</span>
            <input
              name="code"
              className={styles.code}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              autoFocus
              placeholder="••••••"
              onChange={(e) => {
                if (!pending && /^\d{6}$/.test(e.currentTarget.value)) e.currentTarget.form?.requestSubmit();
              }}
            />
          </label>
          {(s.error || s.note) && (
            <p role={s.error ? "alert" : "status"} className={s.error ? styles.error : styles.note}>
              {s.error ?? s.note}
            </p>
          )}
          <button type="submit" className="button" disabled={pending}>
            {pending ? "Joining…" : "Join the waitlist"}
          </button>
          <div className={styles.links}>
            <button type="submit" name="intent" value="edit" formNoValidate className={styles.link} disabled={pending}>
              Change details
            </button>
            <button type="submit" name="intent" value="again" formNoValidate className={styles.link} disabled={pending}>
              Send a new code
            </button>
          </div>
        </>
      )}
      {check.widget}
    </form>
  );
}

// A code that went out starts the clock for going back without another send.
function stamp(r: Step, sent: Extract<Step, { sent?: unknown }>["sent"]): Step {
  if (r.at === "code" && !r.error) return { ...r, sent: { phone: digits(r.form.phone), at: Date.now() } };
  return r.at === "done" ? r : { ...r, sent };
}
