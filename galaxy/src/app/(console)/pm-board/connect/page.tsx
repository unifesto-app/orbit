import type { PmToken } from "@orbit/contract";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { me, read } from "../../../../api";
import { Alert, ui } from "../../../ui";
import { PmHeader } from "../tabs";
import { Connect } from "./connect";

// Connect Claude (owner, 17 Nov 2026: "link it to claude code"), the platform owner's alone: make a token for Claude
// Code, see the command that adds orbit-pm, and revoke tokens (API: /galaxy/pm/tokens). To anyone else it doesn't exist.
export const metadata: Metadata = { title: "Connect Claude" };

// The address Claude Code reaches from outside, not the API's address inside Docker that Galaxy's server uses.
const MCP_URL = `${process.env.ORBIT_PUBLIC_API_URL ?? "https://api.heyorbit.in"}/pm/mcp`;

export default function ConnectPage() {
  return (
    <div className={ui.page}>
      <PmHeader current="connect" description="Let Claude Code read and update this board, as orbit-pm." />
      <Suspense fallback={null}>
        <Load />
      </Suspense>
    </div>
  );
}

async function Load() {
  const viewer = await me();
  if (!viewer.ok || !viewer.data.staff?.owner) notFound();
  const r = await read<PmToken[]>("/galaxy/pm/tokens");
  if (!r.ok) return <Alert>{r.error.message}</Alert>;
  return <Connect url={MCP_URL} tokens={r.data} />;
}
