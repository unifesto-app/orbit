import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { me } from "../../../../../api";
import { Container, ui } from "../../../../ui";
import { NotificationsHeader } from "../../tabs";
import { ComposeForm } from "../forms";

// A new broadcast (API: POST /galaxy/notifications/broadcasts), for holders of Platform. It waits for a second person.
export const metadata: Metadata = { title: "New broadcast" };

export default function NewBroadcast() {
  return (
    <div className={ui.page}>
      <NotificationsHeader current="broadcasts" description="Count the audience, then save. Someone else with Platform confirms it before it goes." />
      <Suspense fallback={null}>
        <Body />
      </Suspense>
    </div>
  );
}

async function Body() {
  const r = await me();
  if (!(r.ok && r.data.staff?.features.includes("platform"))) notFound();
  return (
    <Container title="New broadcast">
      <ComposeForm />
    </Container>
  );
}
