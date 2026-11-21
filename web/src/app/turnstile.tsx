"use client";

import Script from "next/script";
import { useEffect, useRef } from "react";

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

// Cloudflare Turnstile, as on Galaxy's login (galaxy/src/app/login/form.tsx): every waitlist code send and every job
// application carries one of its tokens and the API checks it, so a script can't pump Orbit's WhatsApp or fill the
// careers inbox through this site. It shows only when Cloudflare wants a click. A send waits for the token (up to 30 seconds; at once without one if the widget errs or its
// script can't load), and a token works once. Without a site key (a laptop) there's no widget, and sends go without one.
// ponytail: a copy of Galaxy's hook; one shared package if Galaxy and the site ever need to change it together.
export function useTurnstile(siteKey?: string) {
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
