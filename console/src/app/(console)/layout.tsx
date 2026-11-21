import { Suspense } from "react";
import { me } from "../../api";
import { Shell } from "../shell";
import styles from "../shell.module.css";
import { SignOut } from "./sign-out";

// Every page behind sign-in (proxy.ts sends anyone else to /login), inside the Console's chrome.
export default function ConsoleLayout({ children }: LayoutProps<"/">) {
  return (
    <Shell
      account={
        <Suspense fallback={null}>
          <Account />
        </Suspense>
      }
    >
      {children}
    </Shell>
  );
}

// The top bar's right end, as on the AWS console: who's signed in, and Sign out.
async function Account() {
  const r = await me();
  return (
    <div className={styles.account}>
      {r.ok && <span className={styles.accountName}>{r.data.name ?? "Signed in"}</span>}
      <SignOut className={styles.topLink} />
    </div>
  );
}
