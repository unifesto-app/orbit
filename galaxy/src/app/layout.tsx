import type { Metadata } from "next";
import { DM_Sans, Plus_Jakarta_Sans, Sacramento } from "next/font/google";
import "@orbit/tokens/tokens.css";
import "./globals.css";

// Same type as the web app: Plus Jakarta Sans for headings, titles and
// buttons; DM Sans for text. latin-ext carries ₹ (U+20B9).
const display = Plus_Jakarta_Sans({ variable: "--font-display", subsets: ["latin"] });
const text = DM_Sans({ variable: "--font-text", subsets: ["latin", "latin-ext"] });
// Sacramento, the app's Explore script (web's explore.tsx), for the name "Galaxy" (owner, 17 Nov 2026: "for galaxy use
// explore font from web/app"), as on the app's Galaxy lock.
const script = Sacramento({ variable: "--font-script", weight: "400", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Galaxy", template: "%s | Galaxy" },
  description: "Platform admin for Orbit by Unifesto",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${text.variable} ${script.variable}`}
    >
      <body>
        {children}
      </body>
    </html>
  );
}
