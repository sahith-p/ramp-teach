import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The agent worker, scripts, and extension are not part of the Next bundle.
  serverExternalPackages: ["playwright"],
};

export default nextConfig;
