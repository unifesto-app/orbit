// Unifesto's social links, in the footer and on Coming Soon. Their own module so a page can use them without the navbar.
import Image from "next/image";
import styles from "./socials.module.css";

// Brand marks in their own colours (public/social, from thesvg, MIT). X is white, per its rules for dark backgrounds.
const social = [
  { label: "Instagram", href: "https://www.instagram.com/unifesto.app/", src: "/social/instagram.svg" },
  { label: "LinkedIn", href: "https://www.linkedin.com/company/unifesto", src: "/social/linkedin.svg" },
  { label: "X", href: "https://x.com/unifestoapp", src: "/social/x.svg" },
  { label: "YouTube", href: "https://www.youtube.com/@unifesto-app", src: "/social/youtube.svg" },
];

export function Socials({ className = "" }: { className?: string }) {
  return (
    <ul className={`${styles.social} ${className}`} aria-label="Unifesto on social media">
      {social.map(({ label, href, src }) => (
        <li key={label}>
          <a href={href} rel="noopener" className={styles.link}>
            <Image src={src} alt={`Unifesto on ${label}`} width={20} height={20} />
          </a>
        </li>
      ))}
    </ul>
  );
}
