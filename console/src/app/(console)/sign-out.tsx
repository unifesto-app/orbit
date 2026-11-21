"use client";

import { useTransition } from "react";
import { signOut } from "../login/actions";

// Sign out, then load sign-in as a new page: Next keeps visited pages alive in the browser (React's Activity), and none
// of this account's should outlive it on a shared computer.
export function SignOut({ className }: { className: string }) {
  const [busy, start] = useTransition();
  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      onClick={() =>
        start(async () => {
          await signOut();
          location.replace("/login");
        })
      }
    >
      Sign out
    </button>
  );
}
