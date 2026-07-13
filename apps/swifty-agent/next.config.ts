import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/binary deps with dynamic requires should not be bundled by webpack.
  serverExternalPackages: ["redis", "mysql2", "knex"],
};

export default nextConfig;
