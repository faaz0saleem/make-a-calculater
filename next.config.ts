import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  typedRoutes: false,
  images: {
    // Avatars and video thumbnails are served from the public R2 bucket.
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
};

export default nextConfig;
