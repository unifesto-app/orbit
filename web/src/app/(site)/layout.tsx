import type { ReactNode } from "react";
import { AppCard } from "../app-card";
import { Footer, Navbar } from "../chrome";
import { CookieBanner } from "../cookie-banner";

// The site's pages, with the navbar and footer. A group, so pages outside it (Coming Soon) stand alone; the URLs
// don't change.
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Navbar />
      {children}
      <Footer />
      <CookieBanner />
      <AppCard />
    </>
  );
}
