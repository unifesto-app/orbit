import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Until launch the site is a few pages: the homepage, the waitlist (at / until the owner moved it to /waitlist, 22
  // Nov 2026: "lets move the waitlist from homepage"), terms, privacy and careers (owner, 18 Nov 2026: "remove
  // /coming-soon", "add terms & privacy pages"; 22 Nov: "careers page at heyorbit.in/careers"). Any other address, old
  // links like /coming-soon too, opens /. Temporary (307), so search engines keep / as the page. Left out: those pages,
  // Next's own files, what search, link previews and the welcome email read (robots, sitemap, llms.txt, icons, social
  // and email images), and /v, where the page sends its visits (app/v/route.ts). Regex: dots escaped.
  async redirects() {
    const keep = ["waitlist$", "orb\\.webp", "home-on\\.webp", "terms$", "privacy$", "careers$", "careers/", "_next/", "__nextjs", "robots\\.txt", "sitemap\\.xml", "llms\\.txt", "icon\\.svg", "apple-icon", "favicon\\.ico", "opengraph-image", "twitter-image", "email/", "v$"];
    return [{ source: `/:path((?!${keep.join("|")}).+)`, destination: "/", permanent: false }];
  },
  // A job application's PDF résumé passes through a Server Action: up to 5 MB, plus the form around it (the API caps
  // the file).
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
};

export default nextConfig;
