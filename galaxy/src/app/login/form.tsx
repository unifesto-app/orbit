"use client";

import { useSearchParams } from "next/navigation";
import Script from "next/script";
import { type FormEvent, useEffect, useRef, useState, useTransition } from "react";
import { ui } from "../ui";
import { confirmMe, type Outcome, sendCode, verifyCode } from "./actions";
import styles from "./login.module.css";

type Stage = { at: "contact" } | { at: "code"; to: string } | { at: "confirm"; to: string; ticket: string; name: string; since: number };

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
  const next = useSearchParams().get("next") ?? "/";
  const [stage, setStage] = useState<Stage>({ at: "contact" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Each step asks the server, then shows the API's own message when it says no.
  const run = (e: FormEvent<HTMLFormElement>, step: (form: FormData) => Promise<Outcome | void>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    start(async () => {
      const r = await step(form);
      setError(r?.error ?? null);
    });
  };

  const field = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

  if (stage.at === "confirm")
    return (
      <form
        key="confirm"
        method="post"
        className={styles.form}
        onSubmit={(e) =>
          run(e, async () => {
            const r = await confirmMe(stage.ticket, next);
            if (r.error) setStage({ at: "contact" }); // the ticket works once
            return r;
          })
        }
      >
        <h1 className={styles.title}>Is this you?</h1>
        <p className={styles.who}>
          {stage.name}
          <span className={ui.secondary}>On Orbit since {stage.since}</span>
        </p>
        <p className={ui.secondary}>This browser hasn’t signed in to this account before.</p>
        <Alert error={error} />
        <div className={styles.buttons}>
          <button className={`${ui.btn} ${ui.primary}`} disabled={pending}>
            Yes, it’s me
          </button>
          <button
            type="button"
            className={ui.btnLink}
            onClick={() => {
              setStage({ at: "contact" });
              setError("Then this number is on someone else's Orbit account. Sign in with your own.");
            }}
          >
            Not me
          </button>
        </div>
      </form>
    );

  if (stage.at === "code")
    return (
      <form
        key="code"
        method="post"
        className={styles.form}
        onSubmit={(e) =>
          run(e, async (form) => {
            const r = await verifyCode(stage.to, field(form, "code"), next);
            if (r.confirm) setStage({ at: "confirm", to: stage.to, ...r.confirm });
            return r;
          })
        }
      >
        <h1 className={styles.title}>Enter your code</h1>
        <p className={ui.secondary}>
          We sent a 6-digit code to <strong>{stage.to}</strong>.
        </p>
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
          />
        </label>
        <Alert error={error} />
        <div className={styles.buttons}>
          <button className={`${ui.btn} ${ui.primary}`} disabled={pending}>
            Sign in
          </button>
          <button
            type="button"
            className={ui.btnLink}
            disabled={pending}
            onClick={() => start(async () => setError((await sendCode(stage.to, await take())).error ?? null))}
          >
            Send a new code
          </button>
        </div>
        <button
          type="button"
          className={styles.back}
          onClick={() => {
            setStage({ at: "contact" });
            setError(null);
          }}
        >
          Use a different number or email
        </button>
      </form>
    );

  // Each step's form has its own key, so no typed value carries into the next step's field. Every step's form says
  // method="post": sent before the page is ready, a form falls back to the browser's own submit, and a GET would put the
  // typed phone or email in the address, Caddy's access log and the browser's history.
  return (
    <form
      key="contact"
      method="post"
      className={styles.form}
      onSubmit={(e) =>
        run(e, async (form) => {
          const to = field(form, "to");
          const r = await sendCode(to, await take());
          if (!r.error) setStage({ at: "code", to });
          return r;
        })
      }
    >
      <h1 className={styles.title}>Sign in to Galaxy</h1>
      <p className={ui.secondary}>For Orbit’s staff. We’ll send a code on WhatsApp or by email.</p>
      <label className={styles.label}>
        Phone number or email
        <input className={`${ui.input} ${styles.input}`} name="to" autoComplete="username" required autoFocus />
      </label>
      <Alert error={error} />
      <div className={styles.buttons}>
        <button className={`${ui.btn} ${ui.primary}`} disabled={pending}>
          Send code
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

// Cloudflare Turnstile (User flow, Account security): every code send carries one of its tokens and the API checks it,
// so a script can't pump Orbit's WhatsApp through this page. It shows only when Cloudflare wants a click. A send waits
// for the token (up to 30 seconds, the button busy meanwhile; at once without one if the widget errs or its script can't
// load), and a token works once, so the widget starts on the next after one is used. Without a site key (a laptop)
// there's no widget, and sends go without one.
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
