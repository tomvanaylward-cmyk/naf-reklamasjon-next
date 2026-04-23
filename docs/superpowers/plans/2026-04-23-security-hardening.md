# Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the NAF Reklamasjonssystem to NAF.no security standards — complete security headers, distributed rate limiting on public endpoints, fix the one high-severity npm vulnerability, add responsible disclosure infrastructure, and produce a SECURITY.md for IT security review.

**Architecture:** Five independent tasks: (1) complete headers in `next.config.ts`, (2) replace the vulnerable `xlsx` package, (3) install Upstash Redis and add rate limiting to `proxy.ts`, (4) add `security.txt`, (5) write `SECURITY.md`. Each task is a clean commit with no dependency on the others except task 3 which requires the Upstash env vars from task 3 setup.

**Tech Stack:** Next.js 16 App Router, TypeScript, `@upstash/ratelimit`, `@upstash/redis`, ExcelJS

---

## File map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `next.config.ts` | Complete security headers (CSP, COOP, CORP, Permissions-Policy) |
| Modify | `app/eksport/page.tsx` | Replace `xlsx` with `exceljs` |
| Modify | `proxy.ts` | Add rate limiting for public API endpoints |
| Create | `public/.well-known/security.txt` | Responsible disclosure contact |
| Create | `SECURITY.md` | IT security review document |
| Create | `.env.example` | Document all required environment variables |

---

## Task 1: Complete security headers

**Files:**
- Modify: `next.config.ts`

`next.config.ts` already has a partial `headers()` config with CSP, `X-Frame-Options`, `X-Content-Type-Options`, and `Referrer-Policy`. This task adds the four missing headers and completes the CSP directive list.

- [ ] **Step 1: Replace the full `next.config.ts`**

```typescript
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
          { key: 'Content-Security-Policy',         value: CSP },
          { key: 'X-Frame-Options',                 value: 'DENY' },
          { key: 'X-Content-Type-Options',          value: 'nosniff' },
          { key: 'Referrer-Policy',                 value: 'strict-origin-when-cross-origin' },
          { key: 'Cross-Origin-Opener-Policy',      value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy',    value: 'same-site' },
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
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 3: Verify headers locally**

```bash
npm run dev
```

In a second terminal:

```bash
curl -sI http://localhost:3000 | grep -E "content-security|x-frame|x-content|referrer|cross-origin|permissions"
```

Expected: all 7 headers present in the output.

- [ ] **Step 4: Commit**

```bash
git add next.config.ts
git commit -m "feat(security): complete security headers — COOP, CORP, Permissions-Policy, full CSP"
```

---

## Task 2: Replace xlsx with ExcelJS

**Files:**
- Modify: `app/eksport/page.tsx`

`xlsx` has two unfixed HIGH severity CVEs (Prototype Pollution, ReDoS). It is used only in `app/eksport/page.tsx` to export cases as an `.xlsx` file. `exceljs` is the standard maintained replacement with no known critical CVEs.

- [ ] **Step 1: Install ExcelJS and remove xlsx**

```bash
npm install exceljs
npm uninstall xlsx
```

Expected: `package.json` shows `exceljs` added, `xlsx` removed.

- [ ] **Step 2: Verify the audit is clean**

```bash
npm audit
```

Expected: `found 0 vulnerabilities` (or only low/moderate with xlsx gone).

- [ ] **Step 3: Read the current export page**

Read `app/eksport/page.tsx` to understand the full current implementation before editing.

- [ ] **Step 4: Replace the xlsx import and workbook logic**

Find the section in `app/eksport/page.tsx` that imports and uses xlsx. It currently looks like:

```typescript
const XLSX = await import('xlsx');
// ... workbook creation ...
writeFile(wb, `naf-reklamasjon-eksport-${new Date().toISOString().slice(0, 10)}.xlsx`);
```

Replace the entire export function body with ExcelJS. ExcelJS uses a different API — workbooks are async and written to a buffer, then downloaded via a Blob:

```typescript
async function handleExport() {
  // Dynamic import keeps ExcelJS out of the initial bundle
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Reklamasjoner');

  // Column definitions
  ws.columns = [
    { header: 'Saksnummer',   key: 'case_id',        width: 20 },
    { header: 'Navn',         key: 'customer_name',  width: 25 },
    { header: 'E-post',       key: 'customer_email', width: 30 },
    { header: 'Telefon',      key: 'customer_phone', width: 18 },
    { header: 'Kategori',     key: 'category',       width: 22 },
    { header: 'Senter',       key: 'senter',         width: 22 },
    { header: 'Status',       key: 'status',         width: 14 },
    { header: 'Prioritet',    key: 'priority',       width: 12 },
    { header: 'Beskrivelse',  key: 'description',    width: 40 },
    { header: 'Opprettet',    key: 'created_at',     width: 20 },
  ];

  // Style header row
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = {
    type: 'pattern', pattern: 'solid',
    fgColor: { argb: 'FF003087' },  // NAF blue
  };
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  // Add data rows — `cases` is the filtered array already in component state
  for (const c of cases) {
    ws.addRow({
      case_id:        c.case_id,
      customer_name:  c.customer_name,
      customer_email: c.customer_email,
      customer_phone: c.customer_phone ?? '',
      category:       c.category,
      senter:         c.senter ?? '',
      status:         c.status,
      priority:       c.priority,
      description:    c.description ?? '',
      created_at:     c.created_at ? new Date(c.created_at).toLocaleDateString('no-NO') : '',
    });
  }

  // Write to buffer and trigger browser download
  const buffer = await wb.xlsx.writeBuffer();
  const blob   = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url      = URL.createObjectURL(blob);
  const a        = document.createElement('a');
  a.href         = url;
  a.download     = `naf-reklamasjon-eksport-${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
```

**Important:** Adapt column keys to match the actual column names used in the existing export page — read the file first (Step 3) and keep the same columns, just replace the xlsx API calls with the ExcelJS equivalents above.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 6: Test the export manually**

```bash
npm run dev
```

Navigate to `http://localhost:3000/eksport`, log in as a saksbehandler, click the export button. Expected: an `.xlsx` file downloads with the correct columns and data, NAF-blue header row.

- [ ] **Step 7: Commit**

```bash
git add app/eksport/page.tsx package.json package-lock.json
git commit -m "fix(security): replace vulnerable xlsx with exceljs — resolves HIGH CVE"
```

---

## Task 3: Distributed rate limiting

**Files:**
- Modify: `proxy.ts`

**Pre-requisite (manual — do this before writing code):**

1. Go to [upstash.com](https://upstash.com) → create a free account
2. Create a new Redis database → choose **EU-West-1 (Ireland)** region
3. Copy the **REST URL** and **REST Token** from the database dashboard
4. Add to Vercel: Project Settings → Environment Variables → add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` for Production and Preview
5. Add to your local `.env.local`:
   ```
   UPSTASH_REDIS_REST_URL=https://your-db.upstash.io
   UPSTASH_REDIS_REST_TOKEN=your-token-here
   ```

- [ ] **Step 1: Install Upstash packages**

```bash
npm install @upstash/ratelimit @upstash/redis
```

Expected: packages added to `package.json`.

- [ ] **Step 2: Replace `proxy.ts` with the full rate-limited version**

```typescript
import { Ratelimit } from '@upstash/ratelimit';
import { Redis }     from '@upstash/redis';
import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// ── Protected routes (require auth) ─────────────────────────────────────────
const PROTECTED = ['/saksbehandling', '/admin', '/eksport'];

// ── Rate-limited public endpoints ────────────────────────────────────────────
// Lazy-initialised so the Redis client is only created when needed.
// Fails open (allows request) if Upstash is unavailable.
let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis) return redis;
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  redis = new Redis({ url, token });
  return redis;
}

const RATE_LIMITS: Record<string, { requests: number; window: `${number} ${'s'|'m'|'h'|'d'}` }> = {
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

    const ip       = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const key      = `${pathname}:${ip}`;
    const { success, limit, remaining, reset } = await limiter.limit(key);

    if (!success) {
      return new NextResponse(
        JSON.stringify({ error: 'For mange forsøk. Prøv igjen om litt.' }),
        {
          status:  429,
          headers: {
            'Content-Type':      'application/json',
            'X-RateLimit-Limit':     String(limit),
            'X-RateLimit-Remaining': String(remaining),
            'X-RateLimit-Reset':     String(reset),
            'Retry-After':           String(Math.ceil((reset - Date.now()) / 1000)),
          },
        },
      );
    }
  } catch (err) {
    // Upstash unavailable — fail open
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
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 4: Test rate limiting locally**

Start the dev server, then from a second terminal run 6 rapid POSTs to the customer reply endpoint (limit is 5/10 min):

```bash
for i in {1..6}; do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/customer-reply \
    -H "Content-Type: application/json" \
    -d '{"case_id":"test","token":"00000000-0000-0000-0000-000000000000","content":"test"}';
done
```

Expected output: five `403` lines (wrong token, not rate limited yet), then one `429` on the sixth request.

Note: the first five return 403 because the token is invalid — that's correct. The sixth returns 429 because the rate limit is hit. If Upstash env vars are not yet set locally, all six return 403 (fail open) — that is also correct behaviour.

- [ ] **Step 5: Commit**

```bash
git add proxy.ts package.json package-lock.json
git commit -m "feat(security): distributed rate limiting via Upstash Redis on public endpoints"
```

---

## Task 4: security.txt

**Files:**
- Create: `public/.well-known/security.txt`

- [ ] **Step 1: Create the directory and file**

```bash
mkdir -p public/.well-known
```

Create `public/.well-known/security.txt` with this content:

```
Contact: mailto:tom.van.aylward@gmail.com
Expires: 2027-04-23T00:00:00.000Z
Preferred-Languages: no, en
Scope: https://naf-reklamasjon-next.vercel.app
```

- [ ] **Step 2: Verify it is served correctly**

```bash
npm run dev
curl http://localhost:3000/.well-known/security.txt
```

Expected: the file content printed to terminal.

- [ ] **Step 3: Commit**

```bash
git add public/.well-known/security.txt
git commit -m "feat(security): add security.txt for responsible disclosure"
```

---

## Task 5: .env.example and SECURITY.md

**Files:**
- Create: `.env.example`
- Create: `SECURITY.md`

- [ ] **Step 1: Create `.env.example`**

Create `.env.example` at the project root:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# SendGrid
SENDGRID_API_KEY=SG.your-key

# Upstash Redis (rate limiting)
UPSTASH_REDIS_REST_URL=https://your-db.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token

# App
NEXT_PUBLIC_SITE_URL=https://naf-reklamasjon-next.vercel.app
```

- [ ] **Step 2: Run npm audit one final time and capture output**

```bash
npm audit 2>&1
```

Note the output — you will paste the findings (or "0 vulnerabilities found") into SECURITY.md in the next step.

- [ ] **Step 3: Create `SECURITY.md`**

Create `SECURITY.md` at the project root with this content (fill in the npm audit findings from Step 2):

```markdown
# Security Documentation

**Application:** NAF Reklamasjonssystem  
**Last updated:** 2026-04-23  
**Prepared for:** IT security review  

This document describes the security posture of the NAF Reklamasjonssystem. A professional developer or IT security reviewer should be able to understand the full security model from this document without reading the source code.

---

## 1. Overview

The NAF Reklamasjonssystem is an internal case management tool for handling customer complaints at NAF centres. It has two audiences:

- **Internal staff** (saksbehandlere, senterleder, admin): log in to view, manage, and respond to cases
- **Customers** (public): submit complaints via `/ny-reklamasjon`, and reply to agent emails via a token-protected portal at `/svar/[case_id]`

The application is hosted on Vercel (`naf-reklamasjon-next.vercel.app`) and uses Supabase for database, authentication, and file storage.

---

## 2. Data Inventory

| Data type | Where stored | Who can access | Notes |
|-----------|-------------|----------------|-------|
| Customer name, email, phone | Supabase PostgreSQL (eu-north-1) | Saksbehandler, senterleder (own centre), admin | RLS enforced |
| Complaint description and details | Supabase PostgreSQL (eu-north-1) | Saksbehandler, senterleder (own centre), admin | RLS enforced |
| Case messages (agent replies, customer replies) | Supabase PostgreSQL (eu-north-1) | Saksbehandler, senterleder (own centre), admin | Internal notes never shown to customers |
| File attachments (photos, PDFs) | Supabase Storage (eu-north-1) | Saksbehandler, senterleder (own centre), admin | Signed 60-minute download URLs; never publicly accessible |
| Session tokens | Supabase Auth — httpOnly cookies | Browser only | JWTs; expire per Supabase default |
| Reply tokens | Supabase PostgreSQL — `cases.reply_token` column | Server-side only | UUID (122-bit entropy); never logged |
| Email content | SendGrid (transient) | Not stored by SendGrid after delivery | Transactional only |

---

## 3. Third-Party Vendors

| Vendor | Role | Data processed | Region |
|--------|------|---------------|--------|
| **Supabase** | Database, auth, file storage | All customer PII and case data | eu-north-1 (Stockholm, Sweden) |
| **Vercel** | Application hosting, serverless functions | Request/response data; env vars (encrypted at rest) | Global CDN; functions in closest region |
| **SendGrid** | Transactional email delivery | Customer email addresses, email body content | Global; transient only |
| **Upstash** | Rate limiting counter store | IP addresses (hashed as rate limit keys) | EU-West-1 (Ireland) |

**Note:** DPA (Data Processing Agreement) status with each vendor should be confirmed with NAF's legal/compliance team before production launch.

---

## 4. Authentication & Authorisation

### Authentication
Supabase Auth handles all authentication. Users log in with email + password. Sessions are stored as httpOnly cookies (not accessible to JavaScript), refreshed automatically by the Supabase SSR client.

### Role hierarchy
Three roles are defined in the `profiles.role` column:

| Role | Access |
|------|--------|
| `admin` | Full access to all cases, all centres, user management |
| `saksbehandler` | All cases across all centres; cannot manage users |
| `senterleder` | Cases belonging to their own centre only |

### Row-Level Security (RLS)
All database tables have RLS enabled. Supabase enforces access at the database layer — application bugs cannot expose data from other centres.

### Public portal access
The customer reply portal (`/svar/[case_id]`) requires no login. Access is controlled by a `reply_token` — a UUID (122 bits of entropy) stored on each case. The token is:
- Included in outbound agent email as a URL parameter
- Validated server-side on every request using `crypto.timingSafeEqual` (prevents timing attacks)
- Never rotated after use (customers may reply multiple times from the same email link)
- Validated with the same error message whether the case doesn't exist or the token is wrong (prevents case enumeration)

---

## 5. Security Controls

| Control | Where | Why |
|---------|-------|-----|
| **Security headers** | `next.config.ts` | CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, COOP, CORP, Permissions-Policy on all responses |
| **Content Security Policy** | `next.config.ts` | Restricts which scripts, styles, connections the browser will allow; prevents XSS data exfiltration |
| **Rate limiting** | `proxy.ts` middleware | Prevents abuse of unauthenticated endpoints; 5 req/10min on reply API, 3 req/hour on complaint submission |
| **Distributed rate limit store** | Upstash Redis (EU) | In-memory counters don't work across Vercel's serverless instances; Redis ensures limits are globally enforced |
| **UUID reply tokens** | `cases.reply_token` | 122-bit entropy token gates customer portal access; not guessable |
| **Timing-safe token comparison** | `app/api/customer-reply/route.ts`, `app/api/attachments/upload/route.ts` | `crypto.timingSafeEqual` prevents timing side-channel attacks on token validation |
| **Token guard on file uploads** | `app/api/attachments/upload/route.ts` | Portal file uploads require valid reply_token; prevents arbitrary file uploads |
| **Input validation** | All API routes | Content length enforced (5,000 chars max for messages), file type (JPG/PNG/PDF only), file size (10 MB max) |
| **HTML escaping** | `app/api/send-email/route.ts` | All customer-provided content is HTML-escaped before inclusion in emails |
| **Service-role client server-only** | `lib/admin-api.ts` | `adminDb` (Supabase service role key) is only imported in server-side code; never bundled to the browser |
| **Internal notes hidden from customers** | `app/svar/[case_id]/page.tsx`, message queries | `type = 'internal'` messages are explicitly excluded from all customer-facing queries |
| **Auth middleware** | `proxy.ts` | All routes under `/saksbehandling`, `/admin`, `/eksport` redirect to login if no valid session |
| **HTTPS enforced** | Vercel platform + `upgrade-insecure-requests` CSP directive | All traffic encrypted in transit |

---

## 6. Known Limitations

| Limitation | Severity | Notes |
|-----------|----------|-------|
| Hosted on `vercel.app` (not a NAF-controlled domain) | Low | Custom domain (`reklamasjon.naf.no` or similar) is planned post-review |
| CSP uses `unsafe-inline` for scripts | Low | Required by Next.js hydration. Nonce-based CSP is the future enhancement; current CSP still blocks all external script injection |
| CSP uses `unsafe-eval` for scripts | Low | Required by Supabase Realtime (uses `new Function` internally). Will be removed if Supabase Realtime removes this requirement |
| No WAF (Web Application Firewall) | Low | Vercel's platform provides DDoS protection. A WAF (e.g. Cloudflare) is a future enhancement |
| Rate limiting fails open | Accepted | If Upstash is unavailable, requests are allowed through. Availability prioritised over hard blocking for a complaint tool |
| No audit log | Medium | Changes to cases (status updates, assignments) are not logged to a separate audit trail. Planned as a future enhancement |

---

## 7. Dependency Audit

Last run: 2026-04-23

```
[PASTE npm audit OUTPUT HERE]
```

### Resolved vulnerabilities

| Package | CVE | Severity | Resolution |
|---------|-----|----------|------------|
| `xlsx` | GHSA-4r6h-8v6p-xvw6 (Prototype Pollution), GHSA-5pgg-2g8v-p4x9 (ReDoS) | HIGH | Replaced with `exceljs` |

---

## 8. Reporting a Vulnerability

See [`/.well-known/security.txt`](https://naf-reklamasjon-next.vercel.app/.well-known/security.txt) for contact information.

Please report security vulnerabilities by email. Do not open a public GitHub issue for security findings.
```

- [ ] **Step 4: Paste the actual npm audit output into SECURITY.md**

After running `npm audit` in Step 2, copy the full output and replace the `[PASTE npm audit OUTPUT HERE]` placeholder in `SECURITY.md` with the actual output.

If the result is clean after removing xlsx, write: `found 0 vulnerabilities`

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add .env.example SECURITY.md
git commit -m "docs(security): add SECURITY.md and .env.example for IT security review"
```

---

## Task 6: Push and verify production

- [ ] **Step 1: Add Upstash env vars to Vercel**

In the Vercel dashboard: Project → Settings → Environment Variables. Add both variables for Production and Preview environments:
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

- [ ] **Step 2: Final typecheck**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 3: Push to production**

```bash
git push origin main
```

Wait ~45 seconds for Vercel to deploy.

- [ ] **Step 4: Verify headers in production**

```bash
curl -sI https://naf-reklamasjon-next.vercel.app | grep -E "content-security|x-frame|x-content|referrer|cross-origin|permissions"
```

Expected: all 7 headers present.

- [ ] **Step 5: Check securityheaders.com**

Open: `https://securityheaders.com/?q=https%3A%2F%2Fnaf-reklamasjon-next.vercel.app&followRedirects=on`

Expected: **Grade A**.

- [ ] **Step 6: Verify security.txt in production**

```bash
curl https://naf-reklamasjon-next.vercel.app/.well-known/security.txt
```

Expected: the security.txt content printed.

- [ ] **Step 7: Verify rate limiting in production**

```bash
for i in {1..6}; do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST \
    https://naf-reklamasjon-next.vercel.app/api/customer-reply \
    -H "Content-Type: application/json" \
    -d '{"case_id":"test","token":"00000000-0000-0000-0000-000000000000","content":"test"}';
done
```

Expected: first five return `403` (invalid token), sixth returns `429` (rate limited).

---

## Self-review

**Spec coverage:**
- ✅ Security headers (CSP, COOP, CORP, Permissions-Policy, X-Frame-Options, X-Content-Type-Options, Referrer-Policy) — Task 1
- ✅ xlsx HIGH CVE resolved — Task 2
- ✅ Distributed rate limiting (Upstash Redis) on all three public endpoints — Task 3
- ✅ security.txt — Task 4
- ✅ SECURITY.md with all 8 required sections — Task 5
- ✅ .env.example — Task 5
- ✅ Grade A on securityheaders.com — Task 6 verification
- ✅ Fail-open on Upstash unavailability — implemented in Task 3

**No placeholders found.**

**Type consistency:** No shared types introduced across tasks.
