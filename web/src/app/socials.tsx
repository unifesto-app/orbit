// Orbit's social links, in the footer and on Coming Soon. Their own module so a page can use them without the navbar.
// Instagram only (owner, 17 Nov 2026: "remove socials keep https://www.instagram.com/heyorbit.in only").
import Image from "next/image";
import styles from "./socials.module.css";

// Brand marks in their own colours (public/social, from thesvg, MIT).
const social = [{ label: "Instagram", href: "https://www.instagram.com/heyorbit.in", src: "/social/instagram.svg" }];

export function Socials({ className = "" }: { className?: string }) {
  return (
    <ul className={`${styles.social} ${className}`} aria-label="Orbit on social media">
      {social.map(({ label, href, src }) => (
        <li key={label}>
          <a href={href} rel="noopener" className={styles.link}>
            <Image src={src} alt={`Orbit on ${label}`} width={20} height={20} />
          </a>
        </li>
      ))}
    </ul>
  );
}
