import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { me } from "../../../../api";
import { ui } from "../../../ui";
import { NotificationsHeader } from "../tabs";
import { LogSearch } from "./search";

// Notifications › Delivery log (notifications build plan, PR 7; API: GET /galaxy/notifications/deliveries), for holders
// of Platform or People: one person's last 100 sends and why any didn't go. Every search is written to the audit log.
export const metadata: Metadata = { title: "Delivery log" };

export default function DeliveryLogPage() {
  return (
    <div className={ui.page}>
      <NotificationsHeader current="log" description="One person’s last 100 sends, newest first, and why any didn’t go. Search by phone number, email or account id." />
      <Suspense fallback={null}>
        <Body />
      </Suspense>
    </div>
  );
}

// Nothing here without Platform or People, as the API answers.
async function Body() {
  const r = await me();
  const features = r.ok ? (r.data.staff?.features ?? []) : [];
  if (!features.includes("platform") && !features.includes("people")) notFound();
  return <LogSearch people={features.includes("people")} />;
}
