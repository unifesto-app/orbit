import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // App content's image uploads pass through a Server Action: up to 5 MB, plus the form around it (the API caps the file).
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
};

export default nextConfig;
