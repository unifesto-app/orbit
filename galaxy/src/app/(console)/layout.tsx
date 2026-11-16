import { Suspense } from "react";
import { me } from "../../api";
import { signOut } from "../login/actions";
import { Shell } from "../shell";
import styles from "../shell.module.css";

// Every page behind sign-in (proxy.ts sends anyone else to /login), inside the console's chrome.
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
    <form action={signOut} className={styles.account}>
      {r.ok && <span className={styles.accountName}>{r.data.name ?? "Signed in"}</span>}
      <button className={styles.topLink}>Sign out</button>
    </form>
  );
}
