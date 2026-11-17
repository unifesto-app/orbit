import type { Metadata } from "next";
import Image from "next/image";
import { connection } from "next/server";
import { Suspense } from "react";
import wordmark from "../orbit-wordmark.svg";
import { LoginForm } from "./form";
import styles from "./login.module.css";
import ui from "../ui.module.css";

export const metadata: Metadata = { title: "Sign in" };

// Outside the console's shell: nothing of Galaxy shows before sign-in.
export default function Login() {
  return (
    <main className={styles.page}>
      <div className={styles.panel}>
        <div className={styles.logo}>
          <Image src={wordmark} alt="Orbit" priority />
          <span className={ui.script}>Galaxy</span>
        </div>
        {/* The form reads ?next=, a request value, so it waits behind the boundary. */}
        <Suspense fallback={null}>
          <Form />
        </Suspense>
      </div>
    </main>
  );
}

// TURNSTILE_SITE_KEY (galaxy.env) is read when the page is asked for, so one build serves any key.
async function Form() {
  await connection();
  return <LoginForm turnstile={process.env.TURNSTILE_SITE_KEY} />;
}
