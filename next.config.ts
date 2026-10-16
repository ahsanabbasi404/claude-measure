import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Scripts under client/ are read at runtime and served to developer machines.
  outputFileTracingIncludes: {
    "/api/client/agent": ["./client/agent/**/*"],
    "/api/client/heartbeat": ["./client/agent/**/*"],
    "/install.sh": ["./client/install.sh"],
    "/install.ps1": ["./client/install.ps1"],
  },
};

export default nextConfig;
