import type { NextConfig } from "next";

// What isn't sent to Coming Soon: the page, the files it loads (the card drawings, social marks, the two logos, the site
// icon), Next's scripts and dev tools, and /api. Regex pieces, so dots are escaped.
const COMING_SOON_KEEPS = [
  "coming-soon",
  "_next/",
  "__nextjs",
  "api/",
  "explore/",
  "social/",
  "orbit-wordmark\\.svg",
  "by-unifesto\\.svg",
  "icon\\.svg",
  "favicon\\.ico",
];

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Until launch, every page opens Coming Soon, unknown addresses too (owner, 16 Nov 2026: "/ should open /coming-soon",
  // then "tempory all page redirect to /coming-soon even 404"). Temporary (307), so browsers and search engines don't
  // keep it; delete this to bring the site back. Redirects run before Next serves any file, so Coming Soon itself, the
  // files it loads, Next's own and /api (data, not pages) are left out.
  async redirects() {
    return [
      { source: "/", destination: "/coming-soon", permanent: false },
      { source: `/:path((?!${COMING_SOON_KEEPS.join("|")}).*)`, destination: "/coming-soon", permanent: false },
    ];
  },
};

export default nextConfig;
