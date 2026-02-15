const configuredDistDir = (process.env.XM_NEXT_DIST_DIR || '').trim();
const isProd = process.env.NODE_ENV === 'production';

// Next.js expects a project-relative distDir. Keep it inside the repo so server bundles can resolve node_modules correctly.
const distDir = configuredDistDir || (isProd ? '.next' : '.next-local');

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir,
  experimental: {
    instrumentationHook: true,
  },
};

export default nextConfig;
