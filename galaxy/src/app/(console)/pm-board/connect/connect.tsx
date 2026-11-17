"use client";

import type { PmToken } from "@orbit/contract";
import { startTransition, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Alert, Badge, Container, day, ui } from "../../../ui";
import { createToken, revokeToken } from "../actions";
import styles from "../pm.module.css";

// Making a token: it's shown once, here, with the command that adds orbit-pm to Claude Code. It lives only in this
// component's state: never in the page the server renders, the address, a cookie or storage. It's dropped on Done,
// when the browser tab is hidden, and when this page is left (Next keeps a left page, hidden, with its state; the layout
// effect's cleanup runs on hiding), so it can't be found again later.
export function Connect({ url, tokens }: { url: string; tokens: PmToken[] }) {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);

  // `shown` is false while the page is hidden: a token that arrives after leaving is dropped, not kept out of sight.
  const shown = useRef(true);
  useLayoutEffect(() => {
    shown.current = true;
    return () => {
      shown.current = false;
      setToken(null);
    };
  }, []);
  useEffect(() => {
    const hide = () => document.hidden && setToken(null);
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);

  const command = token ? `claude mcp add --scope user --transport http orbit-pm ${url} --header "Authorization: Bearer ${token}"` : "";

  const make = (f: FormData) => {
    setError(undefined);
    setPending(true);
    startTransition(async () => {
      const r = await createToken(String(f.get("name") ?? "").trim());
      setPending(false);
      if (r.error) setError(r.error);
      else if (shown.current && !document.hidden) {
        setCopied(false);
        setToken(r.token ?? null);
      }
    });
  };

  const revoke = (t: PmToken) => {
    if (!confirm(`Revoke "${t.name}"? Claude Code using it stops reaching the board at once.`)) return;
    startTransition(async () => {
      const r = await revokeToken(t.id);
      setError(r.error);
    });
  };

  return (
    <>
      <Container title="Make a token">
        <p className={ui.secondary}>
          One token for each computer that runs Claude Code. It works while you are Orbit&apos;s platform owner, until you
          revoke it. Claude Code reaches the board at <code>{url}</code>.
        </p>
        {token ? (
          <div className={styles.form}>
            <Alert>Copy this now. It won&apos;t be shown again.</Alert>
            <label className={styles.field}>
              Run this in a terminal on that computer
              <textarea className={`${ui.input} ${styles.notes}`} readOnly value={command} rows={4} onFocus={(e) => e.currentTarget.select()} />
            </label>
            <p className={ui.secondary}>The command lands in your shell history; clear that line after if others use the computer.</p>
            <div className={ui.row}>
              <button
                type="button"
                className={`${ui.btn} ${ui.primary}`}
                onClick={() => navigator.clipboard.writeText(command).then(() => setCopied(true), () => setError("Couldn't copy. Select the text and copy it."))}
              >
                {copied ? "Copied" : "Copy command"}
              </button>
              <button type="button" className={ui.btn} onClick={() => setToken(null)}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <form action={make} className={ui.row}>
            <input className={ui.input} name="name" placeholder="This computer, like laptop" aria-label="Token name" required maxLength={80} />
            <button className={`${ui.btn} ${ui.primary}`} disabled={pending}>
              Make token
            </button>
          </form>
        )}
        <Alert>{error}</Alert>
      </Container>

      <Container title="Tokens" count={tokens.length}>
        {tokens.length === 0 ? (
          <p className={ui.secondary}>None yet.</p>
        ) : (
          <table className={ui.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Made</th>
                <th>Last used</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{day(t.createdAt)}</td>
                  <td>{t.lastUsedAt ? day(t.lastUsedAt) : "Never"}</td>
                  <td>
                    {t.revokedAt ? (
                      <Badge tone="neutral">Revoked</Badge>
                    ) : t.active ? (
                      <Badge tone="success">Active</Badge>
                    ) : (
                      // Made by someone who's no longer the platform owner: it fails until revoked.
                      <Badge tone="warning">Inactive</Badge>
                    )}
                  </td>
                  <td>
                    {!t.revokedAt && (
                      <button type="button" className={ui.btn} onClick={() => revoke(t)}>
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Container>
    </>
  );
}
