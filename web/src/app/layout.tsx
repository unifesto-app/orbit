import type { Metadata, Viewport } from "next";
import { DM_Sans, Plus_Jakarta_Sans, Sacramento } from "next/font/google";
import { palette } from "@orbit/tokens";
import "@orbit/tokens/tokens.css";
import "./globals.css";
import { DESCRIPTION, OPEN_GRAPH, SITE, X_HANDLE } from "./site";

// The kit's three typefaces: Plus Jakarta Sans for display, titles and buttons; DM Sans for text; Sacramento for asides.
const display = Plus_Jakarta_Sans({ variable: "--font-display", subsets: ["latin"] });
const text = DM_Sans({ variable: "--font-text", subsets: ["latin", "latin-ext"] }); // latin-ext carries ₹
// Only the done screen's "see you soon" uses it, so it isn't preloaded ahead of the page.
const script = Sacramento({ variable: "--font-script", subsets: ["latin"], weight: "400", preload: false });

// Search and link previews (owner, 18 Nov 2026: "make it seo friendly"). The social image is opengraph-image.png (and
// twitter-image.png), made from the page's own drawing; Next adds its tags.
export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "Orbit: There’s more to live beyond the usual.", template: "%s · Orbit" },
  description: DESCRIPTION,
  applicationName: "Orbit",
  alternates: { canonical: "/" },
  openGraph: { ...OPEN_GRAPH, url: "/", title: "Orbit: There’s more to live beyond the usual.", description: DESCRIPTION },
  twitter: { card: "summary_large_image", site: X_HANDLE, title: "Orbit: There’s more to live beyond the usual.", description: DESCRIPTION },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = { themeColor: palette.charcoal };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-IN" className={`${display.variable} ${text.variable} ${script.variable}`}>
      <body>{children}</body>
    </html>
  );
}
