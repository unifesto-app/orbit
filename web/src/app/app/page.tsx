import type { Metadata } from "next";
import Image from "next/image";
import { OpenApp } from "./open-app";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Get the app · Orbit",
  description: "Get Orbit on Android or iOS: find events near you and keep every ticket in one place.",
};

export default function AppPage() {
  return (
    <main className={styles.wrap}>
      {/* The QR is for desktop visitors; on a phone this page opens the app itself. */}
      <span className={styles.qr}>
        <Image src="/app-qr.svg" alt="QR code linking to the Orbit app" width={168} height={168} priority />
      </span>
      <h1 className={styles.title}>Explore the app</h1>
      <p className={styles.text}>
        Find events near you and keep every ticket in one place.
        <span className={styles.scan}> Scan with your phone to open Orbit.</span>
      </p>
      <OpenApp />
    </main>
  );
}
