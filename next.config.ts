import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  typedRoutes: false,
  experimental: {
    // Credentials and avatars still POST through a Server Action. Intro videos
    // do not — they are far too big for this, and upload straight to the bucket
    // instead (see src/lib/storage/direct-upload.ts).
    serverActions: { bodySizeLimit: '5mb' },
  },
  images: {
    // Avatars and video thumbnails are served from the public R2 bucket.
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
};

export default nextConfig;
