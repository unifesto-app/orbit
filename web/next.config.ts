import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Until launch the site is the waitlist at / plus its terms and privacy pages (owner, 18 Nov 2026: "keep everything in
  // landing page", "remove /coming-soon", "add terms & privacy pages"). Any other address, old links like /coming-soon
  // too, opens /. Temporary (307), so search engines keep / as the page. Left out: the other pages, Next's own files,
  // what search, link previews and the welcome email read (robots, sitemap, llms.txt, icons, social and email images),
  // and /v, where the page sends its visits (app/v/route.ts). Regex: dots escaped.
  async redirects() {
    const keep = ["terms$", "privacy$", "_next/", "__nextjs", "robots\\.txt", "sitemap\\.xml", "llms\\.txt", "icon\\.svg", "apple-icon", "favicon\\.ico", "opengraph-image", "twitter-image", "email/", "v$"];
    return [{ source: `/:path((?!${keep.join("|")}).+)`, destination: "/", permanent: false }];
  },
};

export default nextConfig;
