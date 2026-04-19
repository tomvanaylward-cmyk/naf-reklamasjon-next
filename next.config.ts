import type { NextConfig } from "next";

const SUPABASE_HOST = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL.trim()).host
  : '*.supabase.co';

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // unsafe-eval needed by Supabase Realtime (uses new Function internally)
              `script-src 'self' 'unsafe-inline' 'unsafe-eval'`,
              `connect-src 'self' https://${SUPABASE_HOST} wss://${SUPABASE_HOST}`,
              `img-src 'self' data: blob: https://${SUPABASE_HOST}`,
              `style-src 'self' 'unsafe-inline'`,
              "font-src 'self'",
              "frame-ancestors 'none'",
              "object-src 'none'",
            ].join('; '),
          },
          { key: 'X-Frame-Options',        value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy',        value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
