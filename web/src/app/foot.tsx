import Link from "next/link";
import { SOCIAL } from "./site";

// The one footer: every page's links and Orbit's accounts. Each page's stylesheet places it.
export function Foot({ className }: { className: string }) {
  return (
    <footer className={className}>
      <p>© 2027 Orbit</p>
      <nav>
        <Link href="/waitlist">Waitlist</Link>
        <Link href="/careers">Careers</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/privacy">Privacy</Link>
        {SOCIAL.map(([name, url]) => (
          <a key={name} href={url} target="_blank" rel="noopener noreferrer" aria-label={`Orbit on ${name}`}>
            {name}
          </a>
        ))}
      </nav>
    </footer>
  );
}
