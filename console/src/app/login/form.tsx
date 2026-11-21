"use client";

import { ADULT, ageOn, readContact, readPhone } from "@orbit/contract";
import { useRouter, useSearchParams } from "next/navigation";
import Script from "next/script";
import { type FormEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import ui from "../ui.module.css";
import { addEmail, confirm, keepAccount, type Next, type Outcome, type Question, resendCode, sendCode, signUp, verifyCode } from "./actions";
import styles from "./login.module.css";

// The app's sign-in steps (app/src/app/login.tsx), in Galaxy's sign-in panel. One field takes a phone number or an
// email, and Continue always sends a code; the API says which step comes next. New people add a WhatsApp number if they
// started by email, then About you. A phone code on a browser the account hasn't used asks "Is this you?" first.
// Google and passkeys come in their own change, as they need the API's help.

type Step = { at: "start" } | Next | Question;

const WWW = "https://heyorbit.in"; // Orbit's terms and privacy pages, as the app links them

// "+91 98765 43210", and where a code went, as the app says it (app/src/signin.ts).
const showPhone = (e164: string) => `+91 ${e164.slice(3, 8)} ${e164.slice(8)}`;
const sentTo = (to: string) => (to.startsWith("+") ? `On WhatsApp to ${showPhone(to)}` : `Emailed to ${to}`);
const longDay = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
const today = (now: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now); // "2026-11-21", in India

export function LoginForm({ turnstile }: { turnstile?: string }) {
  const check = useTurnstile(turnstile);
  return (
    <>
      <Steps take={check.take} />
      {check.widget}
    </>
  );
}

function Steps({ take }: { take: () => Promise<string | undefined> }) {
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/";
  const [step, go] = useState<Step>({ at: "start" });
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const later = useRef<Question[]>([]); // the questions after signing in still to ask
  const goTo = useRef("/"); // where to go once they're answered (the server checked it)

  // Next keeps a page it leaves alive and hidden (React's Activity; Next's "Preserving UI state" guide), so coming back to
  // sign in would open on the last visit's step: a question, or "Is this you?" with a spent ticket. Hidden, it starts over.
  useLayoutEffect(
    () => () => {
      go({ at: "start" });
      setError(null);
      later.current = [];
    },
    [],
  );

  const show = (s: Step) => {
    setError(null);
    go(s);
  };
  // The questions after signing in, one by one, then where they were going.
  const advance = () => {
    const q = later.current.shift();
    if (q) show(q);
    else router.replace(goTo.current);
  };

  // One request at a time (the buttons are busy meanwhile). Signed in with nothing to ask, the action itself goes on.
  const run = (request: () => Promise<Outcome>, then?: (o: Outcome) => void) =>
    start(async () => {
      const o = await request();
      if (o.error) {
        // A step that took too long can't be finished: start again, with the API's word why. Not at the questions after
        // signing in: they're signed in by then, and Not now still goes on.
        if (o.expired && step.at !== "link" && step.at !== "keep") go({ at: "start" });
        setError(o.error);
        return;
      }
      if (o.questions) {
        later.current = [...o.questions];
        goTo.current = o.go ?? "/";
        return advance();
      }
      if (o.next) return show(o.next);
      then?.(o);
    });

  const send = (to: string, signup?: string) => run(async () => sendCode(to, signup, await take()));
  const alert = <Alert error={error} />;

  switch (step.at) {
    case "start":
      return (
        <Panel title="Sign in or sign up">
          <Start busy={busy} alert={alert} onContact={(to) => send(to)} />
        </Panel>
      );
    case "code":
      return (
        <Panel title="Enter the code" note={sentTo(step.to)}>
          <Code
            key={step.to}
            phone={step.to.startsWith("+")}
            wait={step.wait}
            busy={busy}
            alert={alert}
            onCode={(code) => run(() => verifyCode(step.to, code, step.signup, next))}
            onResend={(setLeft) =>
              start(async () => {
                const o = await resendCode(step.to, await take());
                setError(o.error ?? null);
                if (o.retryIn !== undefined) setLeft(o.retryIn);
              })
            }
            onChange={() => show(step.signup ? { at: "phone", signup: step.signup } : { at: "start" })}
          />
        </Panel>
      );
    case "phone":
      return (
        <Panel title="Your WhatsApp number">
          <Phone busy={busy} alert={alert} onPhone={(e164) => send(e164, step.signup)} />
        </Panel>
      );
    case "whose":
      return (
        <Panel title="Is this you?">
          <Choice
            yes="Yes, sign in"
            no="Not me, start fresh"
            busy={busy}
            alert={alert}
            onYes={() => run(() => confirm(step.ticket, true, next))}
            onNo={() => run(() => confirm(step.ticket, false, next))}
          >
            <p className={styles.card}>
              {step.name}
              <span>On Orbit since {step.since}</span>
            </p>
            <p className={styles.line}>Numbers change hands. If this isn’t your account, start fresh.</p>
          </Choice>
        </Panel>
      );
    case "about":
      return (
        <Panel title="About you">
          <About name={step.name} busy={busy} alert={alert} onDone={(name, dob) => run(() => signUp(step.signup, name, dob, next))} />
        </Panel>
      );
    // Both questions come after signing in: Not now still goes on, signed in.
    case "link":
      return (
        <Panel title="Add this email to your account?" note="Your number is already on Orbit.">
          <Choice yes="Add email" no="Not now" busy={busy} alert={alert} onYes={() => run(() => addEmail(step.token), advance)} onNo={advance}>
            <p className={styles.card}>{step.email}</p>
          </Choice>
        </Panel>
      );
    case "keep":
      return (
        <Panel title="Keep your account?" note={`It’s set to be deleted on ${longDay(step.due)}.`}>
          <Choice yes="Keep my account" no="Not now" busy={busy} alert={alert} onYes={() => run(keepAccount, advance)} onNo={advance} />
        </Panel>
      );
  }
}

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className={styles.form}>
      <h1 className={styles.title}>{title}</h1>
      {note && <p className={styles.line}>{note}</p>}
      {children}
    </div>
  );
}

// Every step's form says method="post": sent before the page is ready, a form falls back to the browser's own submit,
// and a GET would put the typed phone or email in the address, Caddy's access log and the browser's history.
const submit = (then: (form: FormData) => void) => (e: FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  then(new FormData(e.currentTarget));
};

function Start({ busy, alert, onContact }: { busy: boolean; alert: ReactNode; onContact: (to: string) => void }) {
  const [text, setText] = useState("");
  const read = readContact(text);
  const contact = read && read !== "abroad" ? read : null;
  return (
    <form method="post" className={styles.form} onSubmit={submit(() => contact && onContact(contact.kind === "phone" ? contact.e164 : contact.email))}>
      <label className={styles.label}>
        Phone number or email
        <input
          className={`${ui.input} ${styles.input}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="98765 43210 or you@example.com"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          autoFocus
        />
      </label>
      {read === "abroad" && <p className={styles.line}>Orbit takes Indian (+91) numbers only.</p>}
      {alert}
      <div className={styles.buttons}>
        <button className={`${ui.btn} ${ui.primary}`} disabled={!contact || busy}>
          Continue
        </button>
      </div>
    </form>
  );
}

// The 6-digit code. Filling the sixth digit (typed, pasted or offered by the browser) sends it. A new code waits out the
// API's resend time, counted down on the button.
function Code({
  phone,
  wait,
  busy,
  alert,
  onCode,
  onResend,
  onChange,
}: {
  phone: boolean;
  wait: number;
  busy: boolean;
  alert: ReactNode;
  onCode: (code: string) => void;
  onResend: (setLeft: (s: number) => void) => void;
  onChange: () => void;
}) {
  const [left, setLeft] = useState(wait);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return (
    <form
      method="post"
      className={styles.form}
      onSubmit={submit((form) => {
        const code = String(form.get("code") ?? "").trim();
        if (/^\d{6}$/.test(code)) onCode(code);
      })}
    >
      <label className={styles.label}>
        Code
        <input
          className={`${ui.input} ${styles.input}`}
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          autoFocus
          onChange={(e) => !busy && /^\d{6}$/.test(e.currentTarget.value) && e.currentTarget.form?.requestSubmit()}
        />
      </label>
      {alert}
      <div className={styles.buttons}>
        <button className={`${ui.btn} ${ui.primary}`} disabled={busy}>
          Continue
        </button>
        <button type="button" className={ui.btnLink} disabled={busy || left > 0} onClick={() => onResend(setLeft)}>
          {left > 0 ? `Send a new code in ${left}s` : "Send a new code"}
        </button>
      </div>
      <button type="button" className={styles.back} onClick={onChange}>
        {phone ? "Change number" : "Use a different email"}
      </button>
    </form>
  );
}

function Phone({ busy, alert, onPhone }: { busy: boolean; alert: ReactNode; onPhone: (e164: string) => void }) {
  const [text, setText] = useState("");
  const read = readPhone(text);
  const e164 = read && read !== "abroad" ? read : null;
  return (
    <form method="post" className={styles.form} onSubmit={submit(() => e164 && onPhone(e164))}>
      <label className={styles.label}>
        WhatsApp number
        <input
          className={`${ui.input} ${styles.input}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="98765 43210"
          inputMode="tel"
          autoComplete="tel-national"
          required
          autoFocus
        />
      </label>
      {read === "abroad" && <p className={styles.line}>Orbit takes Indian (+91) numbers only.</p>}
      {alert}
      <div className={styles.buttons}>
        <button className={`${ui.btn} ${ui.primary}`} disabled={!e164 || busy}>
          Continue
        </button>
      </div>
    </form>
  );
}

// About you, the last sign-up step: Continue makes the account. The date can't be changed afterwards except by support,
// so the age shows back under it. Under 18, no account: a host can add them as a guest (User doc, decision 5).
function About({ name: given, busy, alert, onDone }: { name: string | null; busy: boolean; alert: ReactNode; onDone: (name: string, dob: string) => void }) {
  const [name, setName] = useState(given ?? "");
  const [dob, setDob] = useState("");
  const [now] = useState(() => Date.now()); // the step's moment, read once
  const max = today(now);
  const age = /^\d{4}-\d{2}-\d{2}$/.test(dob) && dob >= "1900-01-01" && dob <= max ? ageOn(dob, now) : null;
  const ok = !!name.trim() && age !== null && age >= ADULT;
  return (
    <form method="post" className={styles.form} onSubmit={submit(() => ok && onDone(name.trim(), dob))}>
      <label className={styles.label}>
        Name
        <input
          className={`${ui.input} ${styles.input}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your full name"
          autoComplete="name"
          maxLength={100}
          required
          autoFocus
        />
      </label>
      <label className={styles.label}>
        Date of birth
        <input
          className={`${ui.input} ${styles.input}`}
          type="date"
          value={dob}
          onChange={(e) => setDob(e.target.value)}
          min="1900-01-01"
          max={max}
          autoComplete="bday"
          required
        />
      </label>
      {age !== null && (
        <p className={styles.line}>
          {age < ADULT ? "Orbit is for people 18 and over. A host can still add you to their event as a guest." : `You’re ${age}`}
        </p>
      )}
      <p className={styles.line}>
        By continuing you agree to the{" "}
        <a href={`${WWW}/terms`} target="_blank" rel="noreferrer">
          Terms
        </a>{" "}
        and{" "}
        <a href={`${WWW}/privacy`} target="_blank" rel="noreferrer">
          Privacy Policy
        </a>
        .
      </p>
      {alert}
      <div className={styles.buttons}>
        <button className={`${ui.btn} ${ui.primary}`} disabled={!ok || busy}>
          Continue
        </button>
      </div>
    </form>
  );
}

// A two-answer question: "Is this you?", and the questions after signing in.
function Choice({
  yes,
  no,
  busy,
  alert,
  onYes,
  onNo,
  children,
}: {
  yes: string;
  no: string;
  busy: boolean;
  alert: ReactNode;
  onYes: () => void;
  onNo: () => void;
  children?: ReactNode;
}) {
  return (
    <form method="post" className={styles.form} onSubmit={submit(onYes)}>
      {children}
      {alert}
      <div className={styles.buttons}>
        <button className={`${ui.btn} ${ui.primary}`} disabled={busy}>
          {yes}
        </button>
        <button type="button" className={ui.btnLink} disabled={busy} onClick={onNo}>
          {no}
        </button>
      </div>
    </form>
  );
}

function Alert({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className={styles.alert}>
      {error}
    </p>
  ) : null;
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

// Cloudflare Turnstile, as on Galaxy's sign-in (galaxy/src/app/login/form.tsx): every code send carries one of its
// tokens and the API checks it, so a script can't pump Orbit's WhatsApp through this page. It shows only when
// Cloudflare wants a click. A send waits for the token (up to 30 seconds, the button busy meanwhile; at once without one
// if the widget errs or its script can't load), and a token works once, so the widget starts on the next after one is
// used. Without a site key (a laptop) there's no widget, and sends go without one.
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
