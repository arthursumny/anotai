import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  // Vinext checks multipart bodies before dispatching API routes. Leave space
  // for multipart framing; the upload service enforces the 20 MiB file limit.
  experimental: { serverActions: { bodySizeLimit: '21mb' } },
};
export default nextConfig;
