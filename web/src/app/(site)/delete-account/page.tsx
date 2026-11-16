import type { Metadata } from "next";
import styles from "./page.module.css";

// The web deletion page Google Play asks for (User flow, decision 10): it reads without signing in.
// ponytail: information only until the API exists; the User flow's "any sign-in method, then Delete" button lands with it.

export const metadata: Metadata = {
  title: "Delete your account · Orbit",
  description: "How to delete your Orbit account, the 30 days before it goes, and what is deleted and what is kept.",
};

const PRIVACY = "privacy@heyorbit.in";
const mailto = `mailto:${PRIVACY}?subject=${encodeURIComponent("Delete my account")}`;

export default function DeleteAccountPage() {
  return (
    <main className={styles.wrap}>
      <h1 className={styles.title}>Delete your account</h1>
      <p className={styles.lede}>You can delete your Orbit account at any time, in the app or by email. Here is exactly what happens.</p>

      <section className={styles.section}>
        <h2>In the app</h2>
        <ol>
          <li>Open Orbit and sign in.</li>
          <li>Go to <strong>Account</strong>, then <strong>Delete account</strong>.</li>
          <li>Confirm with a code or your passkey.</li>
        </ol>
      </section>

      <section className={styles.section}>
        <h2>Without the app</h2>
        <p>
          Write to <a href={mailto}>{PRIVACY}</a> with the subject “Delete my account”, from the email or with the phone
          number you sign in with. We send a code to that email or number to confirm it’s you, then start the deletion.
        </p>
      </section>

      <section className={styles.section}>
        <h2>The 30 days</h2>
        <p>
          Every device signs out at once. Your account is deleted 30 days later. Sign in before then and choose{" "}
          <strong>Keep my account</strong> to stop it. We email you when it’s done.
        </p>
      </section>

      <section className={styles.section}>
        <h2>Before it can go</h2>
        <ul>
          <li>If you started a host, archive it first. A host still owed a payout can be archived once it’s paid.</li>
          <li>Cancel any ticket for an event that hasn’t ended, or wait until it’s over. A ticket with a refund request already open can stay.</li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2>What is deleted</h2>
        <ul>
          <li>Your sign-in methods, passkeys and sessions.</li>
          <li>Your devices, notification settings, saved events, follows and notifications.</li>
          <li>Your roles on hosts, your photo and anything you uploaded.</li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2>What is wiped from what stays</h2>
        <p>
          Your name, phone, email and date of birth; the answers you gave hosts; names on tickets; your support messages;
          and any host bank account you hold, down to its last 4 digits.
        </p>
      </section>

      <section className={styles.section}>
        <h2>What is kept, and why</h2>
        <p>
          Bookings, payments, refunds and payouts stay, with your details removed. They are books of account, which the
          law requires us to keep for 8 years.
        </p>
      </section>
    </main>
  );
}
