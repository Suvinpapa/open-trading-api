import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // P2: Frontend 3001, Backend 8003
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://127.0.0.1:8003/api/:path*',
      },
    ];
  },
};

export default nextConfig;
