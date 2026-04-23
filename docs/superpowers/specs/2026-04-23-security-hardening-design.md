# Security Hardening Design Spec

**Goal:** Bring the NAF Reklamasjonssystem up to NAF.no security standards so it is ready for IT security review, despite being hosted on an external domain (Vercel).

**Background:** The tool handles customer PII (names, emails, vehicle details, complaint descriptions) and runs on `naf-reklamasjon-next.vercel.app`. A NAF IT security review requires demonstrable, documented security controls. This sprint implements the full set of technical protections and produces documentation a professional developer or IT security reviewer can audit in 15 minutes.

**Reference:** NAF.no headers were inspected on 2026-04-23. All headers implemented here match or closely follow that standard.

---

## Architecture

Five independent components, all addable without breaking existing functionality:

```
next.config.ts          ← Security headers on all responses
proxy.ts (middleware)   ← Rate limiting on public endpoints
Upstash Redis           ← Distributed counter store for rate limits
public/.well-known/     ← security.txt for responsible disclosure
SECURITY.md             ← Human-readable security documentation
```

---

## Section 1: Security Headers

Configured in `next.config.ts` under `headers()`. Applied to all routes (`source: '/(.*)'`).

### Headers to add

```
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
Referrer-Policy: strict-origin-when-cross-origin
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-site
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), display-capture=()
Content-Security-Policy: (see below)
```

### Content Security Policy

```
default-src 'self';
script-src 'self' 'unsafe-inline';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self';
connect-src 'self' https://*.supabase.co wss://*.supabase.co;
media-src 'none';
object-src 'none';
frame-src 'none';
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
upgrade-insecure-requests;
```

**Notes:**
- `unsafe-inline` on `script-src` is required for Next.js client-side hydration. Removing it would require nonce injection in middleware — a future enhancement.
- `connect-src` includes Supabase REST API and Realtime WebSocket endpoint.
- `frame-ancestors 'none'` prevents clickjacking — stricter than `X-Frame-Options: SAMEORIGIN` and takes precedence in modern browsers.

### Expected result

Grade **A** on [securityheaders.com](https://securityheaders.com). Achieving **A+** requires nonce-based CSP (future enhancement, noted in SECURITY.md).

---

## Section 2: Rate Limiting

### Why distributed rate limiting

Vercel runs serverless functions across multiple edge instances. An in-memory counter resets on every cold start and is invisible to other instances — it provides no real protection. A distributed Redis store is required.

### Store: Upstash Redis

- Free tier: 10,000 commands/day (sufficient for this tool's volume)
- EU region available (data stays in Europe)
- No infrastructure to manage — managed service
- Standard Vercel integration: `@upstash/ratelimit` + `@upstash/redis`

Two environment variables added: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.

### Rate limits

| Endpoint | Limit | Window | Rationale |
|----------|-------|--------|-----------|
| `POST /api/customer-reply` | 5 requests | 10 minutes | One case generates a handful of exchanges |
| `POST /api/attachments/upload` | 10 requests | 10 minutes | Slightly higher — multiple files per case |
| `POST /ny-reklamasjon` | 3 requests | 1 hour | Complaint submission; abuse is low-value but should be bounded |

### Implementation

Rate limiting logic added to `proxy.ts` (the existing Next.js middleware file). When a limit is exceeded, return `429 Too Many Requests` with Norwegian error message: `"For mange forsøk. Prøv igjen om litt."`.

Authenticated routes (`/saksbehandling`, `/admin`, `/eksport`) are excluded — they are already protected by session auth.

### Failure mode

If Upstash is unavailable, the middleware fails **open** (allows the request through) rather than failing closed. This prioritises availability for legitimate users. The failure is logged to the console for Vercel log monitoring.

---

## Section 3: Dependency Audit

Run `npm audit` and address findings:

- **Critical / High**: Fix or replace the dependency. No exceptions.
- **Moderate**: Document the finding, the exposure (is it reachable in production?), and the decision.
- **Low**: Acknowledged, logged in SECURITY.md, no action required unless trivially fixable.

Findings and decisions are recorded in `SECURITY.md` under "Dependency audit".

---

## Section 4: security.txt

File at `public/.well-known/security.txt`, served at `/.well-known/security.txt`.

Content:
```
Contact: mailto:tom.van.aylward@gmail.com
Expires: 2027-04-23T00:00:00.000Z
Preferred-Languages: no, en
Scope: https://naf-reklamasjon-next.vercel.app
```

This is a standard responsible disclosure file. IT security teams check for its presence as a signal of security maturity. Update `Contact` to an official NAF security address if/when available.

---

## Section 5: SECURITY.md

A human-readable security document at the root of the repository. Written for a professional developer or IT security reviewer with no prior knowledge of the codebase.

### Sections

**1. Overview**
What the application does, who uses it, what data it handles.

**2. Data inventory**
| Data type | Where stored | Retention | Notes |
- Customer PII (name, email, phone) → Supabase PostgreSQL
- Complaint content → Supabase PostgreSQL
- File attachments (photos, PDFs) → Supabase Storage
- Session tokens → Supabase Auth (httpOnly cookies)
- Email delivery → SendGrid (transient, not stored)

**3. Third-party vendors**
| Vendor | Role | Data processed | DPA |
- Supabase (database, auth, storage)
- Vercel (application hosting, serverless functions)
- SendGrid (transactional email)

**4. Authentication & authorisation**
- How Supabase Auth works (JWT, httpOnly cookies)
- Role hierarchy (admin → saksbehandler → senterleder)
- RLS policies: what each role can read/write
- How the public reply portal is secured (UUID token, timing-safe comparison)

**5. Security controls implemented**
Each control with a one-sentence explanation of why it exists:
- Security headers (CSP, HSTS, X-Frame-Options, etc.)
- Rate limiting (Upstash Redis, limits per endpoint)
- Token validation (reply portal, attachment upload)
- Input validation (content length, file type/size)
- HTML escaping in emails
- Service-role DB client never exposed to browser
- Internal notes never shown to customers

**6. Known limitations**
- Hosted on `vercel.app` (not a NAF-controlled domain)
- CSP uses `unsafe-inline` for scripts (nonce-based CSP is a future enhancement)
- No WAF (Web Application Firewall) — relies on Vercel's platform-level protection

**7. Dependency audit**
Results of `npm audit` with decisions on findings.

**8. How to report a vulnerability**
Link to security.txt.

---

## Files created / modified

| Action | File |
|--------|------|
| Modify | `next.config.ts` — add `headers()` config |
| Modify | `proxy.ts` — add rate limiting logic |
| Create | `public/.well-known/security.txt` |
| Create | `SECURITY.md` |
| Create | `.env.example` — document new Upstash env vars |
| Install | `@upstash/ratelimit`, `@upstash/redis` |

---

## Environment variables

```
UPSTASH_REDIS_REST_URL=   # Upstash Redis REST endpoint
UPSTASH_REDIS_REST_TOKEN= # Upstash Redis REST token
```

Add to Vercel project settings under Environment Variables (Production + Preview).
