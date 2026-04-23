import type { NextConfig } from "next";

const SUPABASE_HOST = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL.trim()).host
  : '*.supabase.co';

const CSP = [
  "default-src 'self'",
  // unsafe-eval required by Supabase Realtime (uses new Function internally)
  // unsafe-inline required by Next.js client-side hydration
  `script-src 'self' 'unsafe-inline' 'unsafe-eval'`,
  `connect-src 'self' https://${SUPABASE_HOST} wss://${SUPABASE_HOST}`,
  `img-src 'self' data: blob: https://${SUPABASE_HOST}`,
  `style-src 'self' 'unsafe-inline'`,
  "font-src 'self'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join('; ');

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy',      value: CSP },
          { key: 'X-Frame-Options',              value: 'DENY' },
          { key: 'X-Content-Type-Options',       value: 'nosniff' },
          { key: 'Referrer-Policy',              value: 'strict-origin-when-cross-origin' },
          { key: 'Cross-Origin-Opener-Policy',   value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-site' },
          {
            key:   'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), display-capture=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
