"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import ui from "../../ui.module.css";
import { markRead } from "./actions";

// Told after a mark-read, so the count beside Inbox reads again at once (link.tsx).
export const INBOX_CHANGED = "orbit:inbox";
const changed = () => window.dispatchEvent(new Event(INBOX_CHANGED));

// The page's unread rows, read once they've been shown.
export function SeenOnView({ ids }: { ids: string[] }) {
  const key = ids.join();
  useEffect(() => {
    if (!key) return;
    void markRead(key.split(",")).then((ok) => ok && changed());
  }, [key]);
  return null;
}

export function MarkAll() {
  const router = useRouter();
  const [busy, start] = useTransition();
  return (
    <button
      type="button"
      className={ui.btn}
      disabled={busy}
      onClick={() =>
        start(async () => {
          if (await markRead()) changed();
          router.refresh();
        })
      }
    >
      Mark all read
    </button>
  );
}
