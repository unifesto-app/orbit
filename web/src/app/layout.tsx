import type { Metadata, Viewport } from "next";
import { DM_Sans, Plus_Jakarta_Sans } from "next/font/google";
import { AppCard } from "./app-card";
import { Footer, Navbar } from "./chrome";
import { CookieBanner } from "./cookie-banner";
import "./globals.css";

// Approved type: Plus Jakarta Sans for headlines, titles and buttons; DM Sans for text and prices.
const display = Plus_Jakarta_Sans({ variable: "--font-display", subsets: ["latin"] });
// latin-ext carries ₹ (U+20B9).
const text = DM_Sans({ variable: "--font-text", subsets: ["latin", "latin-ext"] });

export const metadata: Metadata = {
  title: "Orbit by Unifesto",
  description: "Events near you, from the hosts you keep going back to.",
};

export const viewport: Viewport = { themeColor: "#121215" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${text.variable}`}>
      <body>
        <Navbar />
        {children}
        <Footer />
        <CookieBanner />
        <AppCard />
      </body>
    </html>
  );
}
