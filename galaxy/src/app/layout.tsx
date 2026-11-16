import type { Metadata } from "next";
import { DM_Sans, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

// Same type as the web app: Plus Jakarta Sans for headings, titles and
// buttons; DM Sans for text. latin-ext carries ₹ (U+20B9).
const display = Plus_Jakarta_Sans({ variable: "--font-display", subsets: ["latin"] });
const text = DM_Sans({ variable: "--font-text", subsets: ["latin", "latin-ext"] });

export const metadata: Metadata = {
  title: { default: "Galaxy", template: "%s | Galaxy" },
  description: "Platform admin for Orbit by Unifesto",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${text.variable}`}>
      <body>
        {children}
      </body>
    </html>
  );
}
