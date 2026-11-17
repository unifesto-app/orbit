import type { Metadata, Viewport } from "next";
import { DM_Sans, Plus_Jakarta_Sans } from "next/font/google";
import { palette } from "@orbit/tokens";
import "@orbit/tokens/tokens.css";
import "./globals.css";

// Approved type: Plus Jakarta Sans for headlines, titles and buttons; DM Sans for text and prices.
const display = Plus_Jakarta_Sans({ variable: "--font-display", subsets: ["latin"] });
// latin-ext carries ₹ (U+20B9).
const text = DM_Sans({ variable: "--font-text", subsets: ["latin", "latin-ext"] });

export const metadata: Metadata = {
  title: "Orbit by Unifesto",
  description: "Events near you, from the hosts you keep going back to.",
};

export const viewport: Viewport = { themeColor: palette.charcoal };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${text.variable}`}>
      {/* The navbar and footer are the (site) group's; Coming Soon has none. */}
      <body>{children}</body>
    </html>
  );
}
