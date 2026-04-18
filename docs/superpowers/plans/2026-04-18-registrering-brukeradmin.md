# Registrering, godkjenning og brukeradministrasjon — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let senterledere apply for access via a registration page; admins approve/reject via the admin panel, which also gains inline user editing (name, phone, password reset).

**Architecture:** Registration requests are stored in a `pending_registrations` table with no Supabase auth account yet — the applicant is completely blocked from login until an admin approves. On approval a server-side API route creates the auth user + profile and emails a temporary password. All admin API routes share a helper in `lib/admin-api.ts` that creates the service-role Supabase client and validates the caller is an admin.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase JS v2 (`@supabase/supabase-js`), SendGrid (`@sendgrid/mail`), Tailwind CSS v4.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `lib/types.ts` | Modify | Add `PendingRegistration` interface; add `phone` + `status` to `Profile` |
| `lib/admin-api.ts` | Create | Service-role Supabase client + `requireAdmin()` helper |
| `app/api/send-email/route.ts` | Modify | Add 4 new email types |
| `app/api/admin/register/route.ts` | Create | Public: insert pending registration + notify admins |
| `app/api/admin/approve-user/route.ts` | Create | Admin: create auth user + profile + welcome email |
| `app/api/admin/reject-user/route.ts` | Create | Admin: delete pending row + rejection email |
| `app/api/admin/update-user/route.ts` | Create | Admin: update full_name + phone on profiles |
| `app/api/admin/reset-password/route.ts` | Create | Admin: generate temp password + update auth + email |
| `app/registrer/bekreftet/page.tsx` | Create | Confirmation page after registration |
| `app/registrer/page.tsx` | Create | Registration form (name, email, senter) |
| `app/login/page.tsx` | Modify | Add "Søk om tilgang" link |
| `components/Navbar.tsx` | Modify | Add `pendingCount?: number` prop + red badge |
| `app/admin/page.tsx` | Modify | Pending section + inline user editing + pass pendingCount to Navbar |

---

## Task 1: SQL migration (USER ACTION REQUIRED)

**Files:** None — run SQL in Supabase SQL Editor.

- [ ] **Step 1: Open Supabase SQL Editor and run**

```sql
-- New table for pending registrations (no RLS — server-side only)
CREATE TABLE IF NOT EXISTS pending_registrations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name  text NOT NULL,
  email      text NOT NULL UNIQUE,
  senter     text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Add phone and status to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS status text
  NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'pending'));
```

- [ ] **Step 2: Verify**

Run `SELECT column_name FROM information_schema.columns WHERE table_name = 'profiles' ORDER BY column_name;` — confirm `phone` and `status` appear. Run `SELECT * FROM pending_registrations LIMIT 1;` — confirm table exists.

---

## Task 2: Update `lib/types.ts`

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Add `PendingRegistration` interface and extend `Profile`**

Replace the `Profile` interface and add `PendingRegistration` below it:

```typescript
// lib/types.ts
export type CaseStatus = 'ny' | 'open' | 'waiting' | 'eskalert' | 'closed';
export type CasePriority = 'low' | 'normal' | 'high' | 'critical';
export type MessageType = 'customer' | 'agent' | 'internal';
export type UserRole = 'admin' | 'saksbehandler' | 'senterleder';
export type CaseOutcome = 'approved' | 'partial' | 'rejected' | 'dropped';

export interface Case {
  id: string;
  case_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  customer_type: string | null;
  company: string | null;
  category: string;
  senter: string | null;
  description: string | null;
  desired_resolution: string | null;
  reg_nr: string | null;
  visit_date: string | null;
  order_number: string | null;
  status: CaseStatus;
  priority: CasePriority;
  assigned_to: string | null;
  outcome: CaseOutcome | null;
  cost_estimated: number | null;
  cost_actual: number | null;
  sla_deadline: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface Message {
  id: string;
  case_id: string;
  type: MessageType;
  sender_name: string;
  content: string;
  created_at: string;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  senter: string | null;
  phone: string | null;
  status: 'active' | 'pending';
}

export interface PendingRegistration {
  id: string;
  full_name: string;
  email: string;
  senter: string;
  created_at: string;
}

export interface Attachment {
  id: string;
  case_id: string;
  uploader_id: string | null;
  file_name: string;
  file_url: string;
  file_size: number;
  mime_type: string;
  created_at: string;
}

export interface Template {
  id: string;
  name: string;
  category: string | null;
  body: string;
  created_by: string | null;
  created_at: string;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/tomaylward/Documents/Claude/Reklamasjon/naf-reklamasjon-next
npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors (existing errors, if any, are pre-existing).

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat: add PendingRegistration type and extend Profile with phone/status"
```

---

## Task 3: Create `lib/admin-api.ts`

**Files:**
- Create: `lib/admin-api.ts`

This module is imported by all five admin API routes. It provides:
- `adminDb`: a Supabase client with the service role key (bypasses RLS, can call `auth.admin.*`)
- `requireAdmin(req)`: validates the Bearer token and confirms the caller has `role = 'admin'`

- [ ] **Step 1: Create the file**

```typescript
// lib/admin-api.ts
import { createClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';

export const adminDb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * Validates that the request Bearer token belongs to an admin user.
 * Returns { userId } on success, null on failure.
 */
export async function requireAdmin(req: NextRequest): Promise<{ userId: string } | null> {
  const auth  = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;

  const { data: { user }, error } = await adminDb.auth.getUser(token);
  if (error || !user) return null;

  const { data: profile } = await adminDb
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (!profile || profile.role !== 'admin') return null;
  return { userId: user.id };
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/admin-api.ts
git commit -m "feat: add adminDb client and requireAdmin helper"
```

---

## Task 4: Update `app/api/send-email/route.ts`

**Files:**
- Modify: `app/api/send-email/route.ts`

Add four new email types. The existing structure is a chain of `if / else if` blocks — add the four new blocks before the final `else`.

- [ ] **Step 1: Replace the file with the updated version**

```typescript
// app/api/send-email/route.ts
import { NextRequest, NextResponse } from 'next/server';
import sgMail from '@sendgrid/mail';
import { createClient } from '@supabase/supabase-js';

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

const FROM = 'tom.van.aylward@gmail.com';
const BASE_URL = 'https://naf-reklamasjon-next.vercel.app';

// Service role so RLS doesn't block fetching admin/saksbehandler email addresses
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

function nafHeader(subtitle: string) {
  return `
    <div style="background:#003087;padding:16px 24px;border-radius:8px 8px 0 0">
      <span style="background:#E3000F;color:white;font-weight:700;font-size:12px;padding:3px 8px;border-radius:4px;margin-right:10px">NAF</span>
      <span style="color:white;font-weight:600;font-size:15px">${subtitle}</span>
    </div>`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { type, to } = body;

    let subject = '';
    let html    = '';

    // ── Existing types ──────────────────────────────────────────────────────

    if (type === 'agent_reply') {
      const { caseId, replyContent, fromName } = body;
      subject = `Re: Din reklamasjon ${caseId} – NAF`;
      html    = `<p>Hei,</p><p>${replyContent}</p><p>Med vennlig hilsen,<br>${fromName}<br>NAF Reklamasjonsservice</p>`;
      await sgMail.send({ to, from: FROM, subject, html });

    } else if (type === 'case_received') {
      const { caseId } = body;
      subject = `Reklamasjon mottatt – ${caseId}`;
      html    = `<p>Hei,</p><p>Vi har mottatt din reklamasjon (${caseId}) og vil behandle den så snart som mulig.</p>`;
      await sgMail.send({ to, from: FROM, subject, html });

    } else if (type === 'escalation_notify') {
      const { caseId, caseName, category, senter, fromName } = body;
      const { data: handlers } = await db
        .from('profiles')
        .select('email')
        .in('role', ['saksbehandler', 'admin']);

      const recipients = (handlers || []).map((h: { email: string }) => h.email).filter(Boolean);
      if (recipients.length === 0) {
        return NextResponse.json({ ok: true, sent: false, reason: 'No saksbehandlere found' });
      }

      subject = `🔺 Sak eskalert – ${caseId}`;
      html    = `
        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto">
          ${nafHeader('Reklamasjonssystem – Eskalering')}
          <div style="background:#fff8f0;border:1px solid #fde8d0;border-radius:0 0 8px 8px;padding:24px">
            <h2 style="margin:0 0 12px;color:#92400E;font-size:18px">🔺 En sak er eskalert til saksbehandler</h2>
            <table style="width:100%;border-collapse:collapse;font-size:14px">
              <tr><td style="padding:6px 0;color:#6B7280;width:120px">Saksnummer</td><td style="font-weight:600;color:#003087;font-family:monospace">${caseId}</td></tr>
              <tr><td style="padding:6px 0;color:#6B7280">Kunde</td><td style="font-weight:600">${caseName || '–'}</td></tr>
              <tr><td style="padding:6px 0;color:#6B7280">Kategori</td><td>${category || '–'}</td></tr>
              <tr><td style="padding:6px 0;color:#6B7280">Senter</td><td>${senter || '–'}</td></tr>
              <tr><td style="padding:6px 0;color:#6B7280">Eskalert av</td><td>${fromName || '–'}</td></tr>
            </table>
            <div style="margin-top:20px">
              <a href="${BASE_URL}/saksbehandling"
                style="background:#003087;color:white;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;font-size:14px">
                Åpne saksbehandling →
              </a>
            </div>
          </div>
        </div>`;
      await sgMail.sendMultiple({ to: recipients, from: FROM, subject, html });

    // ── New types ────────────────────────────────────────────────────────────

    } else if (type === 'registration_notify') {
      // Sent to all admins when a new registration arrives
      const { applicantName, applicantEmail, senter: applicantSenter } = body;
      const { data: admins } = await db.from('profiles').select('email').eq('role', 'admin');
      const recipients = (admins || []).map((a: { email: string }) => a.email).filter(Boolean);
      if (recipients.length === 0) {
        return NextResponse.json({ ok: true, sent: false, reason: 'No admins found' });
      }
      subject = `🔔 Ny tilgangsforespørsel – ${applicantName} (${applicantSenter})`;
      html    = `
        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto">
          ${nafHeader('Reklamasjonssystem – Ny søknad')}
          <div style="background:#f0f4ff;border:1px solid #d0daf0;border-radius:0 0 8px 8px;padding:24px">
            <h2 style="margin:0 0 12px;color:#003087;font-size:18px">🔔 Ny tilgangsforespørsel</h2>
            <table style="width:100%;border-collapse:collapse;font-size:14px">
              <tr><td style="padding:6px 0;color:#6B7280;width:120px">Navn</td><td style="font-weight:600">${applicantName}</td></tr>
              <tr><td style="padding:6px 0;color:#6B7280">E-post</td><td>${applicantEmail}</td></tr>
              <tr><td style="padding:6px 0;color:#6B7280">Senter</td><td>${applicantSenter}</td></tr>
              <tr><td style="padding:6px 0;color:#6B7280">Tidspunkt</td><td>${new Date().toLocaleString('nb-NO')}</td></tr>
            </table>
            <div style="margin-top:20px">
              <a href="${BASE_URL}/admin"
                style="background:#003087;color:white;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;font-size:14px">
                Behandle søknad →
              </a>
            </div>
          </div>
        </div>`;
      await sgMail.sendMultiple({ to: recipients, from: FROM, subject, html });

    } else if (type === 'registration_approved') {
      // Sent to the approved applicant with their temporary password
      const { applicantName, tempPassword } = body;
      subject = `✅ Tilgang godkjent – NAF Reklamasjonssystem`;
      html    = `
        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto">
          ${nafHeader('Reklamasjonssystem')}
          <div style="background:#f0fff4;border:1px solid #c6f6d5;border-radius:0 0 8px 8px;padding:24px">
            <h2 style="margin:0 0 12px;color:#276749;font-size:18px">✅ Din tilgang er godkjent</h2>
            <p style="font-size:14px;color:#374151">Hei ${applicantName},</p>
            <p style="font-size:14px;color:#374151">Din søknad om tilgang til NAF Reklamasjonssystem er godkjent.</p>
            <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">
              <tr><td style="padding:6px 0;color:#6B7280;width:160px">E-post (brukernavn)</td><td style="font-weight:600">${to}</td></tr>
              <tr><td style="padding:6px 0;color:#6B7280">Midlertidig passord</td><td style="font-weight:700;font-family:monospace;font-size:16px">${tempPassword}</td></tr>
            </table>
            <p style="font-size:13px;color:#6B7280">Bytt passord etter første innlogging.</p>
            <div style="margin-top:20px">
              <a href="${BASE_URL}/login"
                style="background:#003087;color:white;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;font-size:14px">
                Logg inn →
              </a>
            </div>
          </div>
        </div>`;
      await sgMail.send({ to, from: FROM, subject, html });

    } else if (type === 'registration_rejected') {
      // Sent to the rejected applicant
      const { applicantName } = body;
      subject = `Din tilgangsforespørsel – NAF Reklamasjonssystem`;
      html    = `
        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto">
          ${nafHeader('Reklamasjonssystem')}
          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:0 0 8px 8px;padding:24px">
            <h2 style="margin:0 0 12px;color:#374151;font-size:18px">Din søknad er behandlet</h2>
            <p style="font-size:14px;color:#374151">Hei ${applicantName},</p>
            <p style="font-size:14px;color:#374151">Din søknad om tilgang til NAF Reklamasjonssystem er dessverre ikke godkjent.</p>
            <p style="font-size:14px;color:#374151">Ta kontakt med din leder for mer informasjon.</p>
          </div>
        </div>`;
      await sgMail.send({ to, from: FROM, subject, html });

    } else if (type === 'password_reset') {
      // Sent to a user after an admin resets their password
      const { tempPassword } = body;
      subject = `🔑 Nytt midlertidig passord – NAF Reklamasjonssystem`;
      html    = `
        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto">
          ${nafHeader('Reklamasjonssystem')}
          <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:0 0 8px 8px;padding:24px">
            <h2 style="margin:0 0 12px;color:#92400E;font-size:18px">🔑 Passord tilbakestilt</h2>
            <p style="font-size:14px;color:#374151">Ditt passord har blitt tilbakestilt av en administrator.</p>
            <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">
              <tr><td style="padding:6px 0;color:#6B7280;width:160px">Midlertidig passord</td><td style="font-weight:700;font-family:monospace;font-size:16px">${tempPassword}</td></tr>
            </table>
            <p style="font-size:13px;color:#6B7280">Bytt passord etter innlogging.</p>
            <div style="margin-top:20px">
              <a href="${BASE_URL}/login"
                style="background:#003087;color:white;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;font-size:14px">
                Logg inn →
              </a>
            </div>
          </div>
        </div>`;
      await sgMail.send({ to, from: FROM, subject, html });

    } else {
      return NextResponse.json({ error: 'Ukjent e-posttype' }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('SendGrid error:', err);
    return NextResponse.json({ error: 'E-postfeil' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Build check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/send-email/route.ts
git commit -m "feat: add registration and password-reset email types to send-email route"
```

---

## Task 5: Create `app/api/admin/register/route.ts`

**Files:**
- Create: `app/api/admin/register/route.ts`

Public endpoint — no auth required (the applicant has no account yet). Inserts into `pending_registrations`, then triggers a `registration_notify` email to all admins.

- [ ] **Step 1: Create the route**

```typescript
// app/api/admin/register/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/admin-api';

export async function POST(req: NextRequest) {
  try {
    const { full_name, email, senter } = await req.json();

    if (!full_name?.trim() || !email?.trim() || !senter?.trim()) {
      return NextResponse.json({ error: 'Alle felter er påkrevd' }, { status: 400 });
    }

    // Check for duplicate email in pending_registrations
    const { data: existing } = await adminDb
      .from('pending_registrations')
      .select('id')
      .eq('email', email.trim().toLowerCase())
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: 'Det finnes allerede en søknad for denne e-posten' }, { status: 409 });
    }

    // Insert pending registration
    const { error: insertError } = await adminDb
      .from('pending_registrations')
      .insert({ full_name: full_name.trim(), email: email.trim().toLowerCase(), senter });

    if (insertError) {
      console.error('Insert error:', insertError);
      return NextResponse.json({ error: 'Kunne ikke lagre søknad' }, { status: 500 });
    }

    // Notify admins via send-email route
    // Use internal URL — derive base from env or default to localhost
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    await fetch(`${baseUrl}/api/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'registration_notify',
        applicantName:  full_name.trim(),
        applicantEmail: email.trim().toLowerCase(),
        senter,
      }),
    }).catch(err => console.error('Email notify failed:', err));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Register error:', err);
    return NextResponse.json({ error: 'Serverfeil' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Add `NEXT_PUBLIC_SITE_URL` to `.env.local`**

Open `.env.local` and add:
```
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Also add this variable in Vercel → Settings → Environment Variables:
- Name: `NEXT_PUBLIC_SITE_URL`
- Value: `https://naf-reklamasjon-next.vercel.app`
- Environments: Production, Preview

- [ ] **Step 3: Build check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/register/route.ts
git commit -m "feat: add public register API route for pending registrations"
```

---

## Task 6: Create `app/api/admin/approve-user/route.ts`

**Files:**
- Create: `app/api/admin/approve-user/route.ts`

Admin-only. Generates a temp password, creates a Supabase auth user, upserts the profile (to handle potential trigger conflicts), sends a welcome email, then deletes the pending row.

- [ ] **Step 1: Create the route**

```typescript
// app/api/admin/approve-user/route.ts
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { adminDb, requireAdmin } from '@/lib/admin-api';

export async function POST(req: NextRequest) {
  const caller = await requireAdmin(req);
  if (!caller) {
    return NextResponse.json({ error: 'Ikke autorisert' }, { status: 401 });
  }

  try {
    const { id } = await req.json(); // id of the pending_registrations row

    // Fetch the pending registration
    const { data: pending, error: fetchError } = await adminDb
      .from('pending_registrations')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !pending) {
      return NextResponse.json({ error: 'Søknad ikke funnet' }, { status: 404 });
    }

    // Generate a secure temporary password
    const tempPassword = crypto.randomBytes(12).toString('base64url');

    // Create Supabase auth user
    const { data: authData, error: createError } = await adminDb.auth.admin.createUser({
      email:          pending.email,
      password:       tempPassword,
      email_confirm:  true,
      user_metadata:  { full_name: pending.full_name },
    });

    if (createError || !authData.user) {
      console.error('Create user error:', createError);
      return NextResponse.json({ error: 'Kunne ikke opprette bruker' }, { status: 500 });
    }

    // Upsert profile (Supabase trigger may have already created a bare row)
    const { error: profileError } = await adminDb
      .from('profiles')
      .upsert({
        id:        authData.user.id,
        email:     pending.email,
        full_name: pending.full_name,
        role:      'senterleder',
        senter:    pending.senter,
        status:    'active',
      }, { onConflict: 'id' });

    if (profileError) {
      console.error('Profile upsert error:', profileError);
      // Auth user was created — log the inconsistency but don't fail silently
      return NextResponse.json({ error: 'Bruker opprettet men profil feilet' }, { status: 500 });
    }

    // Delete the pending registration
    await adminDb.from('pending_registrations').delete().eq('id', id);

    // Send welcome email with temp password
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    await fetch(`${baseUrl}/api/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type:          'registration_approved',
        to:            pending.email,
        applicantName: pending.full_name,
        tempPassword,
      }),
    }).catch(err => console.error('Approval email failed:', err));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Approve error:', err);
    return NextResponse.json({ error: 'Serverfeil' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Build check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/approve-user/route.ts
git commit -m "feat: add approve-user API route"
```

---

## Task 7: Create `app/api/admin/reject-user/route.ts`

**Files:**
- Create: `app/api/admin/reject-user/route.ts`

- [ ] **Step 1: Create the route**

```typescript
// app/api/admin/reject-user/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { adminDb, requireAdmin } from '@/lib/admin-api';

export async function POST(req: NextRequest) {
  const caller = await requireAdmin(req);
  if (!caller) {
    return NextResponse.json({ error: 'Ikke autorisert' }, { status: 401 });
  }

  try {
    const { id } = await req.json(); // id of the pending_registrations row

    const { data: pending, error: fetchError } = await adminDb
      .from('pending_registrations')
      .select('email, full_name')
      .eq('id', id)
      .single();

    if (fetchError || !pending) {
      return NextResponse.json({ error: 'Søknad ikke funnet' }, { status: 404 });
    }

    // Delete the pending registration
    await adminDb.from('pending_registrations').delete().eq('id', id);

    // Send rejection email
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    await fetch(`${baseUrl}/api/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type:          'registration_rejected',
        to:            pending.email,
        applicantName: pending.full_name,
      }),
    }).catch(err => console.error('Rejection email failed:', err));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Reject error:', err);
    return NextResponse.json({ error: 'Serverfeil' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Build check + commit**

```bash
npx tsc --noEmit 2>&1 | head -30
git add app/api/admin/reject-user/route.ts
git commit -m "feat: add reject-user API route"
```

---

## Task 8: Create `app/api/admin/update-user/route.ts`

**Files:**
- Create: `app/api/admin/update-user/route.ts`

Updates `full_name` and/or `phone` on an existing profile. Only fields provided in the request body are updated.

- [ ] **Step 1: Create the route**

```typescript
// app/api/admin/update-user/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { adminDb, requireAdmin } from '@/lib/admin-api';

export async function POST(req: NextRequest) {
  const caller = await requireAdmin(req);
  if (!caller) {
    return NextResponse.json({ error: 'Ikke autorisert' }, { status: 401 });
  }

  try {
    const { userId, full_name, phone } = await req.json();

    if (!userId) {
      return NextResponse.json({ error: 'userId er påkrevd' }, { status: 400 });
    }

    const updates: Record<string, string | null> = {};
    if (full_name !== undefined) updates.full_name = full_name?.trim() || null;
    if (phone     !== undefined) updates.phone     = phone?.trim()     || null;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Ingen felter å oppdatere' }, { status: 400 });
    }

    const { error } = await adminDb
      .from('profiles')
      .update(updates)
      .eq('id', userId);

    if (error) {
      console.error('Update user error:', error);
      return NextResponse.json({ error: 'Kunne ikke oppdatere bruker' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Update user error:', err);
    return NextResponse.json({ error: 'Serverfeil' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Build check + commit**

```bash
npx tsc --noEmit 2>&1 | head -30
git add app/api/admin/update-user/route.ts
git commit -m "feat: add update-user API route for name/phone edits"
```

---

## Task 9: Create `app/api/admin/reset-password/route.ts`

**Files:**
- Create: `app/api/admin/reset-password/route.ts`

- [ ] **Step 1: Create the route**

```typescript
// app/api/admin/reset-password/route.ts
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { adminDb, requireAdmin } from '@/lib/admin-api';

export async function POST(req: NextRequest) {
  const caller = await requireAdmin(req);
  if (!caller) {
    return NextResponse.json({ error: 'Ikke autorisert' }, { status: 401 });
  }

  try {
    const { userId } = await req.json();

    if (!userId) {
      return NextResponse.json({ error: 'userId er påkrevd' }, { status: 400 });
    }

    // Fetch the user's email from profiles
    const { data: profile, error: profileError } = await adminDb
      .from('profiles')
      .select('email')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: 'Bruker ikke funnet' }, { status: 404 });
    }

    // Generate new temp password
    const tempPassword = crypto.randomBytes(12).toString('base64url');

    // Update auth user password
    const { error: updateError } = await adminDb.auth.admin.updateUserById(userId, {
      password: tempPassword,
    });

    if (updateError) {
      console.error('Password reset error:', updateError);
      return NextResponse.json({ error: 'Kunne ikke tilbakestille passord' }, { status: 500 });
    }

    // Send password reset email
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    await fetch(`${baseUrl}/api/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type:        'password_reset',
        to:          profile.email,
        tempPassword,
      }),
    }).catch(err => console.error('Password reset email failed:', err));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Reset password error:', err);
    return NextResponse.json({ error: 'Serverfeil' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Build check + commit**

```bash
npx tsc --noEmit 2>&1 | head -30
git add app/api/admin/reset-password/route.ts
git commit -m "feat: add reset-password API route"
```

---

## Task 10: Create registration pages

**Files:**
- Create: `app/registrer/bekreftet/page.tsx`
- Create: `app/registrer/page.tsx`

### Step A — Confirmation page first (no dependencies)

- [ ] **Step 1: Create `app/registrer/bekreftet/page.tsx`**

```typescript
// app/registrer/bekreftet/page.tsx
import Link from 'next/link';

export default function RegistrerBekreftetPage() {
  return (
    <div className="min-h-screen bg-[#F5F6FA] flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">
        <div className="flex items-center justify-center gap-3 mb-8">
          <span className="bg-[#E3000F] text-white font-bold text-xs px-2 py-1 rounded">NAF</span>
          <span className="font-semibold text-gray-800">Reklamasjonssystem</span>
        </div>
        <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center text-2xl mx-auto mb-4">
          ✅
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Søknad sendt</h1>
        <p className="text-sm text-gray-500 mb-6">
          Din forespørsel om tilgang er mottatt. Du vil få en e-post når en administrator har behandlet søknaden din.
        </p>
        <Link
          href="/login"
          className="text-sm font-semibold text-[#003087] hover:underline"
        >
          ← Tilbake til innlogging
        </Link>
      </div>
    </div>
  );
}
```

### Step B — Registration form

- [ ] **Step 2: Create `app/registrer/page.tsx`**

```typescript
// app/registrer/page.tsx
'use client';
import { useState } from 'react';
import type React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const SENTRE = [
  'NAF Senter Oslo',
  'NAF Senter Bergen',
  'NAF Senter Trondheim',
  'NAF Senter Stavanger',
  'NAF Senter Kristiansand',
  'NAF Senter Tromsø',
  'NAF Senter Drammen',
  'NAF Senter Fredrikstad',
  'NAF Senter Ålesund',
  'NAF Senter Bodø',
];

export default function RegistrerPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email,    setEmail]    = useState('');
  const [senter,   setSenter]   = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!senter) { setError('Velg et senter.'); return; }

    setLoading(true);
    try {
      const res = await fetch('/api/admin/register', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ full_name: fullName, email, senter }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Noe gikk galt. Prøv igjen.');
        return;
      }
      router.push('/registrer/bekreftet');
    } catch {
      setError('Noe gikk galt. Sjekk internettforbindelsen din.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F5F6FA] flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
        <div className="flex items-center gap-3 mb-8">
          <span className="bg-[#E3000F] text-white font-bold text-xs px-2 py-1 rounded">NAF</span>
          <span className="font-semibold text-gray-800">Reklamasjonssystem</span>
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-1">Søk om tilgang</h1>
        <p className="text-sm text-gray-400 mb-6">
          For senterledere. En administrator godkjenner søknaden din.
        </p>

        {error && (
          <div className="bg-red-50 text-red-700 border border-red-200 rounded-lg px-4 py-3 text-sm mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">Fullt navn</label>
            <input
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              required
              placeholder="Ola Nordmann"
              className="border-[1.5px] border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#003087] focus:ring-2 focus:ring-[#003087]/10"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">E-post</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="ola@naf.no"
              className="border-[1.5px] border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#003087] focus:ring-2 focus:ring-[#003087]/10"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">Senter</label>
            <select
              value={senter}
              onChange={e => setSenter(e.target.value)}
              required
              className="border-[1.5px] border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#003087] focus:ring-2 focus:ring-[#003087]/10 bg-white text-gray-800"
            >
              <option value="">Velg ditt senter…</option>
              {SENTRE.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="bg-[#003087] text-white font-semibold py-2.5 rounded-lg text-sm hover:bg-[#001f5c] transition-colors disabled:opacity-50 cursor-pointer mt-1"
          >
            {loading ? 'Sender søknad…' : 'Send søknad'}
          </button>
        </form>

        <p className="text-xs text-gray-400 text-center mt-5">
          Har du allerede tilgang?{' '}
          <Link href="/login" className="text-[#003087] font-semibold hover:underline">
            Logg inn
          </Link>
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add app/registrer/bekreftet/page.tsx app/registrer/page.tsx
git commit -m "feat: add registration form and confirmation pages"
```

---

## Task 11: Update `app/login/page.tsx`

**Files:**
- Modify: `app/login/page.tsx`

Add a "Søk om tilgang" link below the login form.

- [ ] **Step 1: Add the link**

The current file ends with `</div></div>`. Add an import for `Link` from `next/link` and a paragraph after the `</form>` closing tag:

The full updated file:

```typescript
// app/login/page.tsx
'use client';
import { useState } from 'react';
import type React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/supabase';

export default function LoginPage() {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const router = useRouter();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');
    const { error } = await db.auth.signInWithPassword({ email, password });
    if (error) { setError('Feil e-post eller passord.'); setLoading(false); return; }
    router.push('/saksbehandling');
  }

  return (
    <div className="min-h-screen bg-[#F5F6FA] flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
        <div className="flex items-center gap-3 mb-8">
          <span className="bg-[#E3000F] text-white font-bold text-xs px-2 py-1 rounded">NAF</span>
          <span className="font-semibold text-gray-800">Reklamasjonssystem</span>
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-1">Logg inn</h1>
        <p className="text-sm text-gray-400 mb-6">For saksbehandlere og administratorer</p>
        {error && (
          <div className="bg-red-50 text-red-700 border border-red-200 rounded-lg px-4 py-3 text-sm mb-4">
            {error}
          </div>
        )}
        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">E-post</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className="border-[1.5px] border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#003087] focus:ring-2 focus:ring-[#003087]/10" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">Passord</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
              className="border-[1.5px] border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#003087] focus:ring-2 focus:ring-[#003087]/10" />
          </div>
          <button type="submit" disabled={loading}
            className="bg-[#003087] text-white font-semibold py-2.5 rounded-lg text-sm hover:bg-[#001f5c] transition-colors disabled:opacity-50 cursor-pointer">
            {loading ? 'Logger inn...' : 'Logg inn'}
          </button>
        </form>

        <p className="text-xs text-gray-400 text-center mt-5">
          Senterleder uten tilgang?{' '}
          <Link href="/registrer" className="text-[#003087] font-semibold hover:underline">
            Søk om tilgang
          </Link>
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build check + commit**

```bash
npx tsc --noEmit 2>&1 | head -30
git add app/login/page.tsx
git commit -m "feat: add 'Søk om tilgang' link to login page"
```

---

## Task 12: Update `components/Navbar.tsx`

**Files:**
- Modify: `components/Navbar.tsx`

Add `pendingCount?: number` prop. When `pendingCount > 0` and the link is for `/admin`, render a red badge next to the label.

- [ ] **Step 1: Replace the file**

```typescript
// components/Navbar.tsx
'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { db } from '@/lib/supabase';
import type { UserRole } from '@/lib/types';

interface NavbarProps {
  userName:      string;
  role:          UserRole;
  pendingCount?: number;
}

export default function Navbar({ userName, role, pendingCount = 0 }: NavbarProps) {
  const pathname = usePathname();
  const router   = useRouter();

  async function logout() {
    try { await db.auth.signOut(); } catch { /* continue */ }
    router.push('/login');
  }

  const links = [
    { href: '/dashboard',      label: 'Dashboard',      roles: ['admin', 'saksbehandler', 'senterleder'] },
    { href: '/saksbehandling', label: 'Saksbehandling', roles: ['admin', 'saksbehandler', 'senterleder'] },
    { href: '/rapportering',   label: 'Rapportering',   roles: ['admin', 'saksbehandler'] },
    { href: '/eksport',        label: 'Eksport',        roles: ['admin', 'saksbehandler'] },
    { href: '/admin',          label: 'Adminpanel',     roles: ['admin'] },
  ].filter(l => l.roles.includes(role));

  return (
    <nav className="bg-[#003087] h-[58px] flex items-center px-7 gap-5 sticky top-0 z-50 shadow-[0_2px_16px_rgba(0,48,135,0.35)]">
      <Link href="/" className="flex items-center gap-3 font-semibold text-[14.5px] text-white no-underline">
        <span className="bg-[#E3000F] text-white font-bold text-xs px-2 py-0.5 rounded">NAF</span>
        Reklamasjonssystem
      </Link>
      <div className="flex gap-0.5 ml-auto">
        {links.map(l => (
          <Link key={l.href} href={l.href}
            className={`relative text-[13.5px] font-medium px-3.5 py-1.5 rounded-lg transition-colors no-underline
              ${pathname.startsWith(l.href)
                ? 'bg-white/15 text-white'
                : 'text-white/60 hover:bg-white/10 hover:text-white'}`}>
            {l.label}
            {l.href === '/admin' && pendingCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-[#E3000F] text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center leading-none">
                {pendingCount > 9 ? '9+' : pendingCount}
              </span>
            )}
          </Link>
        ))}
      </div>
      <div className="flex items-center gap-2 text-white/75 text-sm ml-3 pl-3 border-l border-white/15">
        <div aria-hidden="true" className="w-[30px] h-[30px] rounded-full bg-white/20 flex items-center justify-center text-xs font-semibold text-white">
          {(userName || '?')[0].toUpperCase()}
        </div>
        <span>{userName}</span>
        <button onClick={logout} className="text-white/50 text-xs px-2 py-1 rounded hover:bg-white/10 hover:text-white transition-colors cursor-pointer border-none bg-transparent">
          Logg ut
        </button>
      </div>
    </nav>
  );
}
```

- [ ] **Step 2: Build check + commit**

```bash
npx tsc --noEmit 2>&1 | head -30
git add components/Navbar.tsx
git commit -m "feat: add pendingCount badge to Navbar Adminpanel link"
```

---

## Task 13: Update `app/admin/page.tsx`

**Files:**
- Modify: `app/admin/page.tsx`

Three additions:
1. Fetch `pending_registrations` on load; pass count to Navbar
2. Render pending section above the existing users list
3. Add inline expand/collapse editing per user row (name, phone, reset password)

All API calls from this page send `Authorization: Bearer <token>` in the header using the current user's session token.

- [ ] **Step 1: Replace the full file**

```typescript
// app/admin/page.tsx
'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { db, getCurrentUser } from '@/lib/supabase';
import type { Profile, UserRole, PendingRegistration } from '@/lib/types';
import Navbar from '@/components/Navbar';

const SENTRE = [
  'NAF Senter Oslo',
  'NAF Senter Bergen',
  'NAF Senter Trondheim',
  'NAF Senter Stavanger',
  'NAF Senter Kristiansand',
  'NAF Senter Tromsø',
  'NAF Senter Drammen',
  'NAF Senter Fredrikstad',
  'NAF Senter Ålesund',
  'NAF Senter Bodø',
];

const ROLE_LABEL: Record<UserRole, string> = {
  senterleder:   'Senterleder',
  saksbehandler: 'Saksbehandler',
  admin:         'Administrator',
};

const ROLE_COLORS: Record<UserRole, string> = {
  senterleder:   'bg-sky-100 text-sky-700',
  saksbehandler: 'bg-emerald-100 text-emerald-700',
  admin:         'bg-purple-100 text-purple-700',
};

const ROLE_CYCLE: Record<UserRole, UserRole> = {
  senterleder:   'saksbehandler',
  saksbehandler: 'admin',
  admin:         'senterleder',
};

export default function AdminPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser]   = useState<Profile | null>(null);
  const [profiles,    setProfiles]       = useState<Profile[]>([]);
  const [pending,     setPending]        = useState<PendingRegistration[]>([]);
  const [updating,    setUpdating]       = useState<string | null>(null);
  const [message,     setMessage]        = useState('');
  const [expandedId,  setExpandedId]     = useState<string | null>(null);
  // Edit form state per user
  const [editName,  setEditName]  = useState('');
  const [editPhone, setEditPhone] = useState('');

  // Get current session token for admin API calls
  async function getToken(): Promise<string> {
    const { data: { session } } = await db.auth.getSession();
    return session?.access_token ?? '';
  }

  const loadData = useCallback(async () => {
    const [{ data: profileData }, { data: pendingData }] = await Promise.all([
      db.from('profiles').select('id, email, full_name, role, senter, phone, status').order('full_name'),
      db.from('pending_registrations').select('*').order('created_at'),
    ]);
    setProfiles((profileData as Profile[]) || []);
    setPending((pendingData as PendingRegistration[]) || []);
  }, []);

  useEffect(() => {
    (async () => {
      const user = await getCurrentUser();
      if (!user)                    { router.push('/login');           return; }
      if (user.role !== 'admin')    { router.push('/saksbehandling'); return; }
      setCurrentUser(user);
      await loadData();
    })();
  }, [router, loadData]);

  // ── Existing role + senter functions ─────────────────────────────────────

  async function cycleRole(profile: Profile) {
    const newRole = ROLE_CYCLE[profile.role];
    setUpdating(profile.id);
    setMessage('');
    try {
      const { error } = await db.from('profiles').update({ role: newRole }).eq('id', profile.id);
      if (error) { setMessage(`Feil: ${error.message}`); }
      else        { setMessage(`${profile.full_name || profile.email} er nå ${ROLE_LABEL[newRole]}`); await loadData(); }
    } finally { setUpdating(null); }
  }

  async function updateSenter(profile: Profile, senter: string) {
    setUpdating(profile.id);
    try {
      await db.from('profiles').update({ senter: senter || null }).eq('id', profile.id);
      await loadData();
    } finally { setUpdating(null); }
  }

  // ── New: pending registration actions ────────────────────────────────────

  async function approveUser(reg: PendingRegistration) {
    setUpdating(reg.id);
    setMessage('');
    try {
      const token = await getToken();
      const res = await fetch('/api/admin/approve-user', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body:    JSON.stringify({ id: reg.id }),
      });
      const data = await res.json();
      if (!res.ok) { setMessage(`Feil: ${data.error}`); }
      else          { setMessage(`${reg.full_name} er godkjent og har fått velkomst-e-post.`); await loadData(); }
    } finally { setUpdating(null); }
  }

  async function rejectUser(reg: PendingRegistration) {
    if (!confirm(`Avvis søknad fra ${reg.full_name}?`)) return;
    setUpdating(reg.id);
    setMessage('');
    try {
      const token = await getToken();
      const res = await fetch('/api/admin/reject-user', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body:    JSON.stringify({ id: reg.id }),
      });
      const data = await res.json();
      if (!res.ok) { setMessage(`Feil: ${data.error}`); }
      else          { setMessage(`Søknad fra ${reg.full_name} er avvist.`); await loadData(); }
    } finally { setUpdating(null); }
  }

  // ── New: inline user editing ─────────────────────────────────────────────

  function toggleExpand(profile: Profile) {
    if (expandedId === profile.id) {
      setExpandedId(null);
    } else {
      setExpandedId(profile.id);
      setEditName(profile.full_name  || '');
      setEditPhone(profile.phone     || '');
    }
  }

  async function saveUserEdits(profile: Profile) {
    setUpdating(profile.id);
    setMessage('');
    try {
      const token = await getToken();
      const res = await fetch('/api/admin/update-user', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body:    JSON.stringify({ userId: profile.id, full_name: editName, phone: editPhone }),
      });
      const data = await res.json();
      if (!res.ok) { setMessage(`Feil: ${data.error}`); }
      else          { setMessage('Brukerinformasjon oppdatert.'); setExpandedId(null); await loadData(); }
    } finally { setUpdating(null); }
  }

  async function resetPassword(profile: Profile) {
    if (!confirm(`Tilbakestill passord for ${profile.full_name || profile.email}? Et nytt midlertidig passord sendes på e-post.`)) return;
    setUpdating(profile.id);
    setMessage('');
    try {
      const token = await getToken();
      const res = await fetch('/api/admin/reset-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body:    JSON.stringify({ userId: profile.id }),
      });
      const data = await res.json();
      if (!res.ok) { setMessage(`Feil: ${data.error}`); }
      else          { setMessage(`Nytt passord sendt til ${profile.email}.`); }
    } finally { setUpdating(null); }
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-[#f5f6fa] flex items-center justify-center text-gray-500">
        Laster...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f6fa] flex flex-col">
      <Navbar
        userName={currentUser.full_name || currentUser.email}
        role={currentUser.role}
        pendingCount={pending.length}
      />

      <div className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <h1 className="text-2xl font-bold text-[#003087] mb-6">Adminpanel — Brukere</h1>

          {message && (
            <div className="mb-4 px-4 py-2.5 bg-emerald-50 border border-emerald-100 rounded-lg text-sm text-emerald-700">
              {message}
            </div>
          )}

          {/* ── Pending registrations ── */}
          {pending.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-amber-200 overflow-hidden mb-6">
              <div className="px-5 py-4 border-b border-amber-100 bg-amber-50 flex items-center gap-2">
                <span className="text-amber-600 font-bold text-lg">🔔</span>
                <div>
                  <h2 className="text-sm font-semibold text-amber-800">
                    Ventende søknader ({pending.length})
                  </h2>
                  <p className="text-xs text-amber-600 mt-0.5">
                    Disse brukerne venter på godkjenning for tilgang.
                  </p>
                </div>
              </div>
              <div className="divide-y divide-amber-50">
                {pending.map(reg => (
                  <div key={reg.id} className="flex items-center gap-4 px-5 py-3.5">
                    <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center text-sm font-semibold text-amber-700 flex-shrink-0">
                      {reg.full_name[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800">{reg.full_name}</p>
                      <p className="text-xs text-gray-400">{reg.email} · {reg.senter}</p>
                      <p className="text-xs text-gray-300">
                        {new Date(reg.created_at).toLocaleDateString('nb-NO', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => approveUser(reg)}
                        disabled={updating === reg.id}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        {updating === reg.id ? '…' : '✅ Godkjenn'}
                      </button>
                      <button
                        onClick={() => rejectUser(reg)}
                        disabled={updating === reg.id}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-50 text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        {updating === reg.id ? '…' : '❌ Avvis'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Existing users ── */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700">Brukere ({profiles.length})</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Klikk på en bruker for å redigere. Klikk på rollen for å endre den.
              </p>
            </div>
            <div className="divide-y divide-gray-50">
              {profiles.map(profile => (
                <div key={profile.id}>
                  {/* Main row */}
                  <div
                    className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors cursor-pointer"
                    onClick={() => toggleExpand(profile)}
                  >
                    <div className="w-9 h-9 rounded-full bg-[#003087]/10 flex items-center justify-center text-sm font-semibold text-[#003087] flex-shrink-0">
                      {(profile.full_name || profile.email)[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">
                        {profile.full_name || '(intet navn)'}
                      </p>
                      <p className="text-xs text-gray-400 truncate">{profile.email}</p>
                    </div>
                    <select
                      value={profile.senter || ''}
                      onChange={e => { e.stopPropagation(); updateSenter(profile, e.target.value); }}
                      onClick={e => e.stopPropagation()}
                      disabled={updating === profile.id}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none bg-white text-gray-600 cursor-pointer hover:border-[#003087] transition-colors w-48"
                    >
                      <option value="">Ikke tilordnet senter</option>
                      {SENTRE.map(s => (
                        <option key={s} value={s}>{s.replace('NAF Senter ', '')}</option>
                      ))}
                    </select>
                    <button
                      onClick={e => { e.stopPropagation(); cycleRole(profile); }}
                      disabled={updating === profile.id || profile.id === currentUser.id}
                      title={profile.id === currentUser.id ? 'Kan ikke endre din egen rolle' : `Klikk for å endre til ${ROLE_LABEL[ROLE_CYCLE[profile.role]]}`}
                      className={`text-xs font-semibold px-3 py-1.5 rounded-full cursor-pointer transition-all border-2 border-transparent hover:border-gray-300
                        ${ROLE_COLORS[profile.role]}
                        ${profile.id === currentUser.id ? 'opacity-40 cursor-not-allowed' : ''}
                        ${updating === profile.id ? 'opacity-50' : ''}`}
                    >
                      {updating === profile.id ? '...' : ROLE_LABEL[profile.role]}
                    </button>
                    <span className="text-gray-300 text-xs">{expandedId === profile.id ? '▲' : '▼'}</span>
                  </div>

                  {/* Inline edit panel */}
                  {expandedId === profile.id && (
                    <div className="px-5 pb-4 pt-2 bg-gray-50 border-t border-gray-100">
                      <div className="flex gap-3 flex-wrap items-end">
                        <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
                          <label className="text-xs font-semibold text-gray-500">Fullt navn</label>
                          <input
                            type="text"
                            value={editName}
                            onChange={e => setEditName(e.target.value)}
                            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-[#003087] bg-white"
                          />
                        </div>
                        <div className="flex flex-col gap-1 flex-1 min-w-[140px]">
                          <label className="text-xs font-semibold text-gray-500">Telefonnummer</label>
                          <input
                            type="tel"
                            value={editPhone}
                            onChange={e => setEditPhone(e.target.value)}
                            placeholder="+47 000 00 000"
                            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-[#003087] bg-white"
                          />
                        </div>
                        <button
                          onClick={() => saveUserEdits(profile)}
                          disabled={updating === profile.id}
                          className="text-xs font-semibold px-4 py-2 rounded-lg bg-[#003087] text-white hover:bg-[#001f5c] transition-colors disabled:opacity-50 cursor-pointer"
                        >
                          {updating === profile.id ? '…' : 'Lagre'}
                        </button>
                        <button
                          onClick={() => resetPassword(profile)}
                          disabled={updating === profile.id}
                          className="text-xs font-semibold px-4 py-2 rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors disabled:opacity-50 cursor-pointer"
                        >
                          🔑 Tilbakestill passord
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {profiles.length === 0 && (
                <div className="px-5 py-8 text-center text-sm text-gray-400">
                  Ingen brukere funnet
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Full build + push**

```bash
npm run build && git add -A && git commit -m "feat: registration approval flow + inline user editing in admin panel" && git push origin main
```

---

## Task 14: Smoke test (USER ACTION)

- [ ] **Step 1: Add `NEXT_PUBLIC_SITE_URL` to Vercel** (if not already done in Task 5)

Vercel → Settings → Environment Variables → Add:
- Name: `NEXT_PUBLIC_SITE_URL`
- Value: `https://naf-reklamasjon-next.vercel.app`
- Environments: Production + Preview

- [ ] **Step 2: Wait for Vercel deploy** (~1 min after git push)

- [ ] **Step 3: Test registration flow**

1. Open `https://naf-reklamasjon-next.vercel.app/login` — confirm "Søk om tilgang" link is visible
2. Click it → `/registrer` — fill in name, a test email, senter → Submit
3. Confirm redirect to `/registrer/bekreftet`
4. Confirm admin email notification arrives at `tom.van.aylward@gmail.com`

- [ ] **Step 4: Test approval flow**

1. Log in as admin → `/admin`
2. Confirm red badge on "Adminpanel" nav link
3. Confirm pending section shows the test registration
4. Click ✅ Godkjenn
5. Confirm welcome email arrives at the test email with a temp password
6. Log in with that temp password — confirm access to saksbehandling with senterleder role

- [ ] **Step 5: Test rejection flow**

1. Submit another test registration
2. In admin panel click ❌ Avvis
3. Confirm rejection email arrives

- [ ] **Step 6: Test inline user editing**

1. Click a user row — confirm it expands with name/phone fields
2. Edit name → Lagre — confirm success message
3. Click 🔑 Tilbakestill passord — confirm email arrives with new temp password
