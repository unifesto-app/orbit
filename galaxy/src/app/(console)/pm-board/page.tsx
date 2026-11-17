import type { PmBoard } from "@orbit/contract";
import type { Metadata } from "next";
import { Suspense } from "react";
import { read } from "../../../api";
import { Alert, ui } from "../../ui";
import { Board } from "./board";
import { PmHeader } from "./tabs";

// Orbit's PM board (owner, 17 Nov 2026; API: /galaxy/pm/*), for holders of Platform. Claude Code reads and writes the
// same board as "orbit-pm" (api/src/pm/mcp.ts).
export const metadata: Metadata = { title: "PM board" };

export default function PmBoardPage() {
  return (
    <div className={ui.page}>
      <PmHeader current="board" description="Tracks and tasks, shared with Claude Code. Drag a task to move it, or pick its status." />
      <Suspense fallback={null}>
        <Load />
      </Suspense>
    </div>
  );
}

async function Load() {
  const r = await read<PmBoard>("/galaxy/pm/board");
  if (!r.ok) return <Alert>{r.error.message}</Alert>;
  // Overdue is by India's date.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return <Board tracks={r.data.tracks} tasks={r.data.tasks} today={today} />;
}
