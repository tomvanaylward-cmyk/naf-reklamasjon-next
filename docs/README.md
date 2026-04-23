# NAF Reklamasjonssystem — Documentation

This folder contains all design specs and implementation plans for the project.
Each feature goes through: **spec → plan → implementation**.

---

## Features built

### 1. Roles, RLS & Escalation
**Spec:** [`specs/2026-04-17-feature-gap-skalerbarhet-design.md`](superpowers/specs/2026-04-17-feature-gap-skalerbarhet-design.md)
**Plan:** [`plans/2026-04-17-roller-rls-eskalering.md`](superpowers/plans/2026-04-17-roller-rls-eskalering.md)

Role hierarchy (admin → saksbehandler → senterleder), Supabase RLS policies scoping data per centre, escalation notifications, case search, pagination, reply templates, and basic reporting.

---

### 2. User Registration & Admin
**Spec:** [`specs/2026-04-18-registrering-brukeradmin-design.md`](superpowers/specs/2026-04-18-registrering-brukeradmin-design.md)
**Plan:** [`plans/2026-04-18-registrering-brukeradmin.md`](superpowers/plans/2026-04-18-registrering-brukeradmin.md)

Self-service registration flow with a pending approval step. Admins approve/reject new saksbehandlere. `pending_registrations` table, email notifications, `/admin` management page.

---

### 3. File Attachments
**Spec:** [`specs/2026-04-19-vedlegg-design.md`](superpowers/specs/2026-04-19-vedlegg-design.md)
**Plan:** [`plans/2026-04-19-vedlegg.md`](superpowers/plans/2026-04-19-vedlegg.md)

Customers and saksbehandlere can attach JPG, PNG, and PDF files (max 10 MB each, max 5 per upload). Files stored in Supabase Storage. Signed 60-minute download URLs. RLS policies on the `attachments` table.

---

### 4. Customer Reply Portal
**Spec:** [`specs/2026-04-23-customer-reply-portal-design.md`](superpowers/specs/2026-04-23-customer-reply-portal-design.md)
**Plan:** [`plans/2026-04-23-customer-reply-portal.md`](superpowers/plans/2026-04-23-customer-reply-portal.md)

Outbound agent emails include a "Svar på reklamasjonen →" button linking to a public portal page (`/svar/[case_id]?token=<UUID>`). Customers write a reply (+ optional file) without logging in. The reply appears in the case timeline in real-time and triggers an email notification to the assigned saksbehandler. Token validated server-side with timing-safe comparison.

---

### 5. Security Hardening *(in progress)*
**Spec:** [`specs/2026-04-23-security-hardening-design.md`](superpowers/specs/2026-04-23-security-hardening-design.md)
**Plan:** *(to be written)*

Security headers matching NAF.no standards (CSP, HSTS, X-Frame-Options, etc.), distributed rate limiting on public endpoints via Upstash Redis, dependency audit, `security.txt`, and a `SECURITY.md` document for IT security review.

---

## Infrastructure

| Service | Role | Region |
|---------|------|--------|
| Vercel | Application hosting, serverless functions | Auto (EU preferred) |
| Supabase | PostgreSQL database, Auth, Storage | `eu-north-1` (Stockholm) |
| SendGrid | Transactional email | Global |

---

## Security

See [`../SECURITY.md`](../SECURITY.md) *(created during security hardening sprint)* for the full security posture document intended for IT security review.

---

## Development workflow

1. **Brainstorm** — design spec written to `docs/superpowers/specs/`
2. **Plan** — implementation plan written to `docs/superpowers/plans/`
3. **Implement** — subagent-driven development with spec + code quality review per task
4. **Deploy** — push to `main` → Vercel auto-deploys to production
