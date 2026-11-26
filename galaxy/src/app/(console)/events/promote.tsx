"use client";

import { useActionState } from "react";
import { ui } from "../../ui";
import { type Done, promoteEvent } from "../actions";

// Promote or Unpromote: the event's link in App content's Promoted list. No reason: App content's own edits take none.
export function Promote({ slug, on }: { slug: string; on: boolean }) {
  const [state, submit, pending] = useActionState<Done, FormData>(promoteEvent, {});
  return (
    <form action={submit}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="on" value={on ? "0" : "1"} />
      <button className={ui.btn} disabled={pending}>
        {on ? "Unpromote" : "Promote"}
      </button>
      {state.error && <p role="alert">{state.error}</p>}
    </form>
  );
}
