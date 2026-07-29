import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";
const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") ?? "";

const nextConfig: NextConfig = {
  output: isGitHubPages ? "export" : undefined,
  basePath: isGitHubPages ? configuredBasePath : "",
  assetPrefix: isGitHubPages ? configuredBasePath : "",
  images: { unoptimized: true },
};

export default nextConfig;
