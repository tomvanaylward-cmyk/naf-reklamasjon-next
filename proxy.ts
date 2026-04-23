import { Ratelimit } from '@upstash/ratelimit';
import { Redis }     from '@upstash/redis';
import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// ── Protected routes (require auth) ─────────────────────────────────────────
const PROTECTED = ['/saksbehandling', '/admin', '/eksport'];

// ── Rate-limited public endpoints ────────────────────────────────────────────
// Lazy-initialised — Redis client created only when needed, not at module load.
let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis) return redis;
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  redis = new Redis({ url, token });
  return redis;
}

const RATE_LIMITS: Record<string, { requests: number; window: `${number} ${'s' | 'm' | 'h' | 'd'}` }> = {
  '/api/customer-reply':     { requests: 5,  window: '10 m' },
  '/api/attachments/upload': { requests: 10, window: '10 m' },
  '/ny-reklamasjon':         { requests: 3,  window: '1 h'  },
};

async function checkRateLimit(req: NextRequest): Promise<NextResponse | null> {
  const { pathname } = req.nextUrl;
  const limitConfig  = RATE_LIMITS[pathname];

  // Only rate-limit configured paths on POST
  if (!limitConfig || req.method !== 'POST') return null;

  const r = getRedis();
  if (!r) {
    // Upstash not configured — fail open, log warning
    console.warn('[rate-limit] Upstash not configured; skipping rate limit for', pathname);
    return null;
  }

  try {
    const limiter = new Ratelimit({
      redis: r,
      limiter: Ratelimit.slidingWindow(limitConfig.requests, limitConfig.window),
      prefix: 'naf-rl',
    });

    const ip       = (
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('cf-connecting-ip') ||
      req.headers.get('x-real-ip') ||
      'unknown'
    );
    const key      = `${pathname}:${ip}`;
    const { success, limit, remaining, reset } = await limiter.limit(key);

    if (!success) {
      return new NextResponse(
        JSON.stringify({ error: 'For mange forsøk. Prøv igjen om litt.' }),
        {
          status:  429,
          headers: {
            'Content-Type':          'application/json',
            'X-RateLimit-Limit':     String(limit),
            'X-RateLimit-Remaining': String(remaining),
            'X-RateLimit-Reset':     String(reset),
            'Retry-After':           String(Math.ceil((reset - Date.now()) / 1000)),
          },
        },
      );
    }
  } catch (err) {
    // Upstash unavailable — fail open to preserve availability
    console.error('[rate-limit] Upstash error; allowing request:', err);
  }

  return null;
}

// ── Middleware entry point ────────────────────────────────────────────────────
export async function proxy(req: NextRequest) {
  const res = NextResponse.next();
  const { pathname } = req.nextUrl;

  // 1. Rate limiting (public endpoints only)
  const rateLimitResponse = await checkRateLimit(req);
  if (rateLimitResponse) return rateLimitResponse;

  // 2. Auth guard (protected routes only)
  if (!PROTECTED.some(p => pathname.startsWith(p))) return res;

  const supabase = createServerClient(
    (process.env.NEXT_PUBLIC_SUPABASE_URL  ?? '').trim(),
    (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').replace(/\s/g, ''),
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value, options }) => {
            req.cookies.set(name, value);
            res.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return res;
}

export const config = {
  matcher: [
    // Auth-protected routes
    '/saksbehandling/:path*',
    '/admin/:path*',
    '/eksport/:path*',
    // Rate-limited public endpoints
    '/api/customer-reply',
    '/api/attachments/upload',
    '/ny-reklamasjon',
  ],
};
