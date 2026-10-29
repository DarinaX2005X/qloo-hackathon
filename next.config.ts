import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Explore and API routes are fully dynamic; data caching lives in src/server/qloo.
  cacheComponents: false,
  partialPrefetching: false,
  images: {
    remotePatterns: [{ protocol: "https", hostname: "images.qloo.com" }],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
