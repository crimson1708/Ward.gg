import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native (compiled) module. Tell Next's bundler to load it
  // at runtime instead of trying to bundle it, which would break the build.
  serverExternalPackages: ["better-sqlite3", "@prisma/adapter-better-sqlite3"],
};

export default nextConfig;
