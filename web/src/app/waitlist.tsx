"use client";

import Script from "next/script";
import { useActionState, useEffect, useRef } from "react";
import { type Details, join, sendCode, type Step } from "./actions";
import styles from "./page.module.css";

// Two steps and nothing else (owner, 18 Nov 2026: "very simple for user to complete it"): the details with the features
// they'd love (optional), then the WhatsApp code, which sends itself once six digits are in. `features` comes from the
// page, so the contract's schemas stay off the browser.

const FRESH = 9 * 60_000; // a code lasts 10 minutes (api auth/codes.ts); one sent within 9 is still worth typing

// What the page can see of the visit: where it came from, the link's utm_ tags, the time zone, language and screen.
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
        return stamp(await sendCode(data), sent);
      }
      const intent = data.get("intent");
      if (intent === "edit") return { at: "details", form: prev.form, sent };
      if (intent === "again") {
        const again = asForm(prev.form);
        again.set("turnstile", (await check.take()) ?? "");
        return stamp(await sendCode(again), sent);
      }
      data.set("visit", visit());
      const r = await join(prev.form, data);
      return r.at === "done" ? r : { ...r, sent };
    } catch {
      return prev.at === "details" ? { at: "details", form: typed(data), error: OFFLINE, sent } : { ...prev, error: OFFLINE, note: undefined };
    }
  }

  const [s, act, pending] = useActionState(step, { at: "details" });

  if (s.at === "done")
    return (
      <div role="status" className={styles.done}>
        <p className={styles.aside}>see you soon</p>
        <h2 className={styles.title}>You’re in, {s.name}.</h2>
      </div>
    );

  return (
    <form action={act} className={styles.form}>
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

declare global {
  interface Window {
    turnstile?: {
      render(
        el: HTMLElement,
        options: { sitekey: string; appearance: "interaction-only"; callback(token: string): void; "expired-callback"(): void; "error-callback"(): void },
      ): string;
      reset(id: string): void;
      remove(id: string): void;
    };
  }
}

// Cloudflare Turnstile, as on Galaxy's login (galaxy/src/app/login/form.tsx): every code send carries one of its
// tokens and the API checks it, so a script can't pump Orbit's WhatsApp through this page. It shows only when
// Cloudflare wants a click. A send waits for the token (up to 30 seconds; at once without one if the widget errs or its
// script can't load), and a token works once. Without a site key (a laptop) there's no widget, and sends go without one.
// ponytail: a copy of Galaxy's hook; one shared package if a third page needs it.
function useTurnstile(siteKey?: string) {
  const box = useRef<HTMLDivElement>(null);
  const id = useRef<string | null>(null);
  const token = useRef<string | null>(null);
  const waiting = useRef<((t?: string) => void) | null>(null);
  const failed = useRef(false); // the script didn't load
  useEffect(
    () => () => {
      if (id.current) window.turnstile?.remove(id.current);
      id.current = null;
    },
    [],
  );
  const draw = () => {
    if (!siteKey || !box.current || !window.turnstile || id.current) return;
    id.current = window.turnstile.render(box.current, {
      sitekey: siteKey,
      appearance: "interaction-only",
      callback: (t) => {
        token.current = t;
        waiting.current?.(t);
      },
      "expired-callback": () => (token.current = null),
      "error-callback": () => waiting.current?.(), // send without one now; the API decides
    });
  };
  const take = async () => {
    if (!siteKey || failed.current) return undefined;
    const t =
      token.current ??
      (await new Promise<string | undefined>((done) => {
        waiting.current = done;
        setTimeout(() => done(undefined), 30_000);
      }));
    waiting.current = null;
    token.current = null;
    if (t && id.current) window.turnstile?.reset(id.current);
    return t;
  };
  const widget = siteKey ? (
    <>
      <div ref={box} />
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        onReady={draw}
        onError={() => {
          failed.current = true;
          waiting.current?.();
        }}
      />
    </>
  ) : null;
  return { take, widget };
}
