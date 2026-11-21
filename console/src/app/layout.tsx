import type { Metadata } from "next";
import { DM_Sans, Plus_Jakarta_Sans, Sacramento } from "next/font/google";
import "@orbit/tokens/tokens.css";
import "./globals.css";
import { Shell } from "./shell";

// Galaxy's type: Plus Jakarta Sans for headings, titles and buttons; DM Sans for text (latin-ext carries ₹, U+20B9);
// Sacramento for the name "Console", as Galaxy's is drawn.
const display = Plus_Jakarta_Sans({ variable: "--font-display", subsets: ["latin"] });
const text = DM_Sans({ variable: "--font-text", subsets: ["latin", "latin-ext"] });
const script = Sacramento({ variable: "--font-script", weight: "400", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Console", template: "%s | Console" },
  description: "Where hosts run their events on Orbit",
  // A tool behind sign-in, never a search result.
  robots: { index: false, follow: false },
};

// Dark unless this browser chose light (the switch in shell.tsx). Read here, before paint, so a light page never flashes
// dark. Not a cookie: reading cookies() in the root layout would make every page wait (cacheComponents).
const THEME = `try{if(localStorage.getItem("theme")==="light")document.documentElement.dataset.theme="light"}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${display.variable} ${text.variable} ${script.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME }} />
      </head>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
