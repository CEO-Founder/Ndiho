import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Ship bcryptjs as a real dependency in the standalone output: the admin CLI
  // (scripts/admin.mjs create-admin) imports it inside the production image.
  serverExternalPackages: ["bcryptjs"],
};

export default nextConfig;
