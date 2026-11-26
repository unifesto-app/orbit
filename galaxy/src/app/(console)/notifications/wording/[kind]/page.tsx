import type { GalaxyWording } from "@orbit/contract";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { read } from "../../../../../api";
import { Alert, Container, ui } from "../../../../ui";
import { CHANNEL_NAMES, kindName, NotificationsHeader } from "../../tabs";
import { WordingEditor } from "../editor";

// One kind's wording (API: GET /galaxy/notifications/templates/:kind), for holders of Platform: a card per channel with
// the wording in code, Galaxy's editor, a preview filled with samples, a test send and the way back to the code's.
export const metadata: Metadata = { title: "Wording" };

export default function KindWordingPage({ params }: PageProps<"/notifications/wording/[kind]">) {
  return (
    <div className={ui.page}>
      <NotificationsHeader current="wording" description="Variables in braces are filled from each message. Saved wording goes out within a minute." />
      <Suspense fallback={null}>
        <Body params={params} />
      </Suspense>
    </div>
  );
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

async function Body({ params }: Pick<PageProps<"/notifications/wording/[kind]">, "params">) {
  const { kind } = await params;
  const r = await read<GalaxyWording>(`/galaxy/notifications/templates/${encodeURIComponent(kind)}`);
  if (!r.ok) return <Alert>{r.error.message}</Alert>;
  const { vars, channels } = r.data;
  return (
    <>
      <p>
        <Link href="/notifications/wording" prefetch={false}>
          Wording
        </Link>{" "}
        › {kindName(kind)}
      </p>
      {channels.map((c) => (
        <Container key={c.channel} title={CHANNEL_NAMES[c.channel]}>
          <p className={ui.secondary}>
            {c.saved ? `Galaxy’s wording, saved ${when(c.saved.updatedAt)}${c.saved.by ? ` by ${c.saved.by}` : ""}.` : "The wording in code goes out."}
          </p>
          <WordingEditor kind={kind} channel={c.channel} vars={vars} code={c.code} saved={c.saved} />
        </Container>
      ))}
    </>
  );
}
