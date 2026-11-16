import type { Metadata } from "next";
import Image from "next/image";
import { Suspense } from "react";
import { OpenApp } from "./open-app";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Get the app · Orbit",
  description: "Get Orbit on Android or iOS: find events near you and keep every ticket in one place.",
};

// The web's host links add ?for=hosts (HOST in chrome.tsx) to swap the words, since hosting lives in the app
// (owner, 16 Nov). Reading the URL needs Suspense under Cache Components; the empty main holds the footer down meanwhile.
export default function AppPage({ searchParams }: PageProps<"/app">) {
  return (
    <Suspense fallback={<main className={styles.wrap} />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: PageProps<"/app">["searchParams"] }) {
  const host = (await searchParams).for === "hosts";
  return (
    <main className={styles.wrap}>
      {/* The QR is for desktop visitors; on a phone this page opens the app itself. */}
      <span className={styles.qr}>
        <Image src="/app-qr.svg" alt="QR code linking to the Orbit app" width={168} height={168} priority />
      </span>
      <h1 className={styles.title}>{host ? "Host on Orbit" : "Explore the app"}</h1>
      <p className={styles.text}>
        {host ? "Send an Event Request from the Orbit app. Orbit staff review every one." : "Find events near you and keep every ticket in one place."}
        <span className={styles.scan}> Scan with your phone to open Orbit.</span>
      </p>
      <OpenApp />
    </main>
  );
}
