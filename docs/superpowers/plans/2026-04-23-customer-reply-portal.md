# Customer Reply Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let customers reply to agent emails via a secure public web page, with replies appearing in the case timeline and an email notification sent to the assigned saksbehandler.

**Architecture:** A UUID `reply_token` on every case is embedded in a link added to outbound agent emails. The link opens a public Next.js RSC page (`/svar/[case_id]`) that validates the token server-side, renders context messages, and passes case data to a client-side form. The form POSTs to `/api/customer-reply` which inserts a `customer` message and fires a notification email via SendGrid directly (no internal HTTP round-trip).

**Tech Stack:** Next.js 16 App Router (RSC + Client Components), TypeScript, Tailwind CSS v4, Supabase (adminDb / service role), SendGrid (`@sendgrid/mail`)

---

## File map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `lib/types.ts` | Add `reply_token` to `Case` interface |
| Create | `app/api/customer-reply/route.ts` | Validate token, insert message, notify saksbehandler |
| Modify | `app/api/send-email/route.ts` | Add reply link to `agent_reply` email |
| Create | `app/svar/[case_id]/page.tsx` | RSC: fetch case, validate token, render page states |
| Create | `app/svar/[case_id]/ReplyForm.tsx` | Client component: form, file upload, success state |
| SQL | Run in Supabase SQL Editor | Add `reply_token` column, backfill existing rows |

---

## Task 1: SQL migration + type update

**Files:**
- Modify: `lib/types.ts`
- SQL: run in Supabase SQL Editor

- [ ] **Step 1: Run the SQL migration in Supabase**

Open Supabase → SQL Editor → New query. Paste and run:

```sql
ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS reply_token UUID NOT NULL DEFAULT gen_random_uuid();

UPDATE public.cases
  SET reply_token = gen_random_uuid()
  WHERE reply_token IS NULL;

NOTIFY pgrst, 'reload schema';
```

Expected: "Success. No rows returned."

- [ ] **Step 2: Verify the column exists**

Run in Supabase SQL Editor:

```sql
SELECT case_id, reply_token FROM public.cases LIMIT 3;
```

Expected: three rows each with a UUID in `reply_token`.

- [ ] **Step 3: Add `reply_token` to the `Case` TypeScript interface**

Open `lib/types.ts`. The current `Case` interface ends at `updated_at`. Add one line:

```typescript
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
  reply_token: string | null;   // ← ADD THIS LINE
  created_at: string;
  updated_at: string | null;
}
```

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no output (clean).

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts
git commit -m "feat: add reply_token to Case type (SQL migration run separately)"
```

---

## Task 2: Customer reply API route

**Files:**
- Create: `app/api/customer-reply/route.ts`

- [ ] **Step 1: Create the file**

Create `app/api/customer-reply/route.ts` with this full content:

```typescript
// app/api/customer-reply/route.ts
import { NextRequest, NextResponse } from 'next/server';
import sgMail from '@sendgrid/mail';
import { adminDb } from '@/lib/admin-api';

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

const FROM     = 'tom.van.aylward@gmail.com';
const BASE_URL = 'https://naf-reklamasjon-next.vercel.app';

function esc(s: string | null | undefined): string {
  if (!s) return '–';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { case_id, token, content } = body;

    // Basic presence check
    if (!case_id || !token || !content) {
      return NextResponse.json({ error: 'Mangler felt' }, { status: 400 });
    }

    // Content length guard
    if (typeof content !== 'string' || content.trim().length === 0 || content.length > 5000) {
      return NextResponse.json(
        { error: 'Meldingen er for lang (maks 5 000 tegn)' },
        { status: 400 },
      );
    }

    // Token must look like a UUID (36 chars: 8-4-4-4-12 with hyphens)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
      return NextResponse.json({ error: 'Ugyldig lenke' }, { status: 403 });
    }

    // Look up case
    const { data: caseRow } = await adminDb
      .from('cases')
      .select('id, case_id, status, reply_token, customer_name, assigned_to, category, senter')
      .eq('case_id', case_id)
      .single();

    if (!caseRow) {
      return NextResponse.json({ error: 'Sak ikke funnet' }, { status: 404 });
    }

    // Timing-safe token comparison (both buffers are always 36 bytes — UUID is fixed length)
    const tokenA = Buffer.from(token);
    const tokenB = Buffer.from(caseRow.reply_token ?? '');
    const valid =
      tokenA.length === tokenB.length &&
      tokenB.length === 36 &&
      crypto.timingSafeEqual(tokenA, tokenB);

    if (!valid) {
      return NextResponse.json({ error: 'Ugyldig lenke' }, { status: 403 });
    }

    // Reject if case is closed
    if (caseRow.status === 'closed') {
      return NextResponse.json({ error: 'Saken er avsluttet' }, { status: 409 });
    }

    // Insert customer message
    const { error: insertError } = await adminDb.from('messages').insert({
      case_id:     caseRow.id,
      type:        'customer',
      sender_name: caseRow.customer_name,
      content:     content.trim(),
      created_at:  new Date().toISOString(),
    });

    if (insertError) {
      console.error('customer-reply insert error:', insertError);
      return NextResponse.json({ error: 'Noe gikk galt' }, { status: 500 });
    }

    // Notify saksbehandler — fire and forget
    notifySaksbehandler(caseRow, content.trim()).catch(err =>
      console.error('customer-reply notify error:', err),
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('customer-reply route error:', err);
    return NextResponse.json({ error: 'Noe gikk galt' }, { status: 500 });
  }
}

async function notifySaksbehandler(
  caseRow: {
    assigned_to: string | null;
    customer_name: string;
    case_id: string;
    category: string;
    senter: string | null;
  },
  content: string,
) {
  let recipients: string[] = [];

  if (caseRow.assigned_to) {
    const { data: agent } = await adminDb
      .from('profiles')
      .select('email')
      .eq('id', caseRow.assigned_to)
      .single();
    if (agent?.email) recipients = [agent.email];
  }

  if (recipients.length === 0) {
    const { data: handlers } = await adminDb
      .from('profiles')
      .select('email')
      .in('role', ['saksbehandler', 'admin']);
    recipients = ((handlers ?? []) as { email: string }[])
      .map(h => h.email)
      .filter(Boolean);
  }

  if (recipients.length === 0) return;

  const subject = `Ny melding fra ${caseRow.customer_name} – ${caseRow.case_id}`;
  const html = `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#003087;padding:16px 24px;border-radius:8px 8px 0 0">
        <span style="background:#E3000F;color:white;font-weight:700;font-size:12px;
                     padding:3px 8px;border-radius:4px;margin-right:10px">NAF</span>
        <span style="color:white;font-weight:600;font-size:15px">Reklamasjonssystem</span>
      </div>
      <div style="background:#f0f4ff;border:1px solid #d0daf0;border-radius:0 0 8px 8px;padding:24px">
        <h2 style="margin:0 0 12px;color:#003087;font-size:18px">Ny melding fra kunde</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:16px">
          <tr>
            <td style="padding:6px 0;color:#6B7280;width:120px">Kunde</td>
            <td style="font-weight:600">${esc(caseRow.customer_name)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B7280">Saksnummer</td>
            <td style="font-weight:600;color:#003087;font-family:monospace">${esc(caseRow.case_id)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6B7280">Kategori</td>
            <td>${esc(caseRow.category)}</td>
          </tr>
        </table>
        <div style="background:white;border:1px solid #E5E7EB;border-radius:8px;
                    padding:16px;font-size:14px;color:#374151;line-height:1.6;white-space:pre-wrap">
          ${esc(content)}
        </div>
        <div style="margin-top:20px">
          <a href="${BASE_URL}/saksbehandling"
             style="background:#003087;color:white;text-decoration:none;
                    padding:10px 20px;border-radius:8px;font-weight:600;font-size:14px">
            Åpne saken →
          </a>
        </div>
      </div>
    </div>`;

  if (recipients.length === 1) {
    await sgMail.send({ to: recipients[0], from: FROM, subject, html });
  } else {
    await sgMail.sendMultiple({ to: recipients, from: FROM, subject, html });
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 3: Manual smoke test — valid token**

First get a real case_id and its reply_token from Supabase SQL Editor:

```sql
SELECT case_id, reply_token FROM public.cases LIMIT 1;
```

Then test with curl (replace values):

```bash
curl -X POST http://localhost:3000/api/customer-reply \
  -H "Content-Type: application/json" \
  -d '{"case_id":"NAF-202604-8440","token":"<reply_token_here>","content":"Hei, dette er en test"}'
```

Expected: `{"ok":true}`

- [ ] **Step 4: Smoke test — wrong token**

```bash
curl -X POST http://localhost:3000/api/customer-reply \
  -H "Content-Type: application/json" \
  -d '{"case_id":"NAF-202604-8440","token":"00000000-0000-0000-0000-000000000000","content":"test"}'
```

Expected: `{"error":"Ugyldig lenke"}` with status 403.

- [ ] **Step 5: Smoke test — missing fields**

```bash
curl -X POST http://localhost:3000/api/customer-reply \
  -H "Content-Type: application/json" \
  -d '{"case_id":"NAF-202604-8440"}'
```

Expected: `{"error":"Mangler felt"}` with status 400.

- [ ] **Step 6: Commit**

```bash
git add app/api/customer-reply/route.ts
git commit -m "feat: customer reply API route with token validation and saksbehandler notification"
```

---

## Task 3: Add reply link to outbound agent email

**Files:**
- Modify: `app/api/send-email/route.ts` (the `agent_reply` block, currently lines 73–77)

- [ ] **Step 1: Replace the `agent_reply` block**

Find this block in `app/api/send-email/route.ts`:

```typescript
    if (type === 'agent_reply') {
      const { caseId, replyContent, fromName } = body;
      subject = `Re: Din reklamasjon ${esc(caseId)} – NAF`;
      html    = `<p>Hei,</p><p>${esc(replyContent)}</p><p>Med vennlig hilsen,<br>${esc(fromName)}<br>NAF Reklamasjonsservice</p>`;
      await sgMail.send({ to, from: FROM, subject, html });
```

Replace the entire `if (type === 'agent_reply')` block with:

```typescript
    if (type === 'agent_reply') {
      const { caseId, replyContent, fromName } = body;

      // Fetch reply_token so we can include the reply portal link
      const { data: caseRow } = await adminDb
        .from('cases')
        .select('reply_token')
        .eq('case_id', caseId)
        .single();

      const replyUrl = caseRow?.reply_token
        ? `${BASE_URL}/svar/${encodeURIComponent(caseId)}?token=${caseRow.reply_token}`
        : null;

      subject = `Re: Din reklamasjon ${esc(caseId)} – NAF`;
      html    = `
        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto">
          ${nafHeader('Reklamasjonssystem')}
          <div style="background:white;border:1px solid #E5E7EB;border-radius:0 0 8px 8px;padding:24px">
            <p style="font-size:14px;color:#374151;line-height:1.6;white-space:pre-wrap">${esc(replyContent)}</p>
            <p style="font-size:14px;color:#6B7280;margin-top:16px">
              Med vennlig hilsen,<br>
              <strong>${esc(fromName)}</strong><br>
              NAF Reklamasjonsservice
            </p>
            ${replyUrl ? `
            <hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0">
            <p style="font-size:13px;color:#6B7280;margin:0 0 12px">Vil du svare på denne meldingen?</p>
            <a href="${replyUrl}"
               style="background:#003087;color:white;text-decoration:none;
                      padding:10px 20px;border-radius:8px;font-weight:600;font-size:14px">
              Svar på reklamasjonen →
            </a>
            <p style="font-size:11px;color:#9CA3AF;margin:16px 0 0">
              Lenken er personlig og gjelder kun for denne saken.
            </p>` : ''}
          </div>
        </div>`;
      await sgMail.send({ to, from: FROM, subject, html });
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add app/api/send-email/route.ts
git commit -m "feat: add reply portal link to outbound agent reply emails"
```

---

## Task 4: Reply portal RSC page

**Files:**
- Create: `app/svar/[case_id]/page.tsx`

- [ ] **Step 1: Create the directory and file**

```bash
mkdir -p app/svar/\[case_id\]
```

Create `app/svar/[case_id]/page.tsx` with this full content:

```typescript
// app/svar/[case_id]/page.tsx
import { adminDb } from '@/lib/admin-api';
import type { Message } from '@/lib/types';
import ReplyForm from './ReplyForm';

interface Props {
  params:       Promise<{ case_id: string }>;
  searchParams: Promise<{ token?: string }>;
}

export default async function SvarPage({ params, searchParams }: Props) {
  const { case_id }  = await params;
  const { token }    = await searchParams;

  const { data: caseRow } = await adminDb
    .from('cases')
    .select('id, case_id, status, reply_token, customer_name, category, senter')
    .eq('case_id', case_id)
    .single();

  // Invalid case or token mismatch — show same generic error for both (don't reveal which)
  if (!caseRow || !token || token !== caseRow.reply_token) {
    return <InvalidState />;
  }

  if (caseRow.status === 'closed') {
    return <ClosedState />;
  }

  const { data: msgs } = await adminDb
    .from('messages')
    .select('id, type, sender_name, content, created_at')
    .eq('case_id', caseRow.id)
    .not('type', 'eq', 'internal')   // never show internal notes to customers
    .order('created_at', { ascending: false })
    .limit(3);

  const contextMessages = ((msgs ?? []) as Pick<Message, 'id' | 'type' | 'sender_name' | 'content' | 'created_at'>[]).reverse();

  return (
    <div className="min-h-screen bg-[#F5F6FA]">
      <header className="bg-[#003087] px-6 py-4 flex items-center gap-3">
        <span className="bg-[#E3000F] text-white font-bold text-xs px-2 py-1 rounded">NAF</span>
        <span className="text-white font-semibold text-[15px]">Reklamasjonssystem</span>
      </header>
      <main className="max-w-xl mx-auto px-4 py-8">
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <div className="bg-[#F8F9FC] border-b border-gray-200 px-6 py-4">
            <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
              Din reklamasjon
            </div>
            <div className="text-[16px] font-bold text-gray-900 font-mono">{caseRow.case_id}</div>
            <div className="text-[13px] text-gray-500 mt-0.5">
              {caseRow.category}
              {caseRow.senter ? ` · ${caseRow.senter.replace('NAF ', '')}` : ''}
            </div>
          </div>
          <ReplyForm
            caseId={caseRow.case_id}
            caseUuid={caseRow.id}
            customerName={caseRow.customer_name}
            messages={contextMessages}
          />
        </div>
      </main>
    </div>
  );
}

function InvalidState() {
  return (
    <div className="min-h-screen bg-[#F5F6FA] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl border border-gray-200 p-8 max-w-md text-center shadow-sm">
        <div className="text-4xl mb-4">🔒</div>
        <h1 className="text-[16px] font-bold text-gray-900 mb-2">Ugyldig lenke</h1>
        <p className="text-[13px] text-gray-500 leading-relaxed">
          Lenken er ugyldig eller utløpt. Ta kontakt med oss direkte.
        </p>
      </div>
    </div>
  );
}

function ClosedState() {
  return (
    <div className="min-h-screen bg-[#F5F6FA] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl border border-gray-200 p-8 max-w-md text-center shadow-sm">
        <div className="text-4xl mb-4">✅</div>
        <h1 className="text-[16px] font-bold text-gray-900 mb-2">Saken er avsluttet</h1>
        <p className="text-[13px] text-gray-500 leading-relaxed">
          Denne saken er ferdigbehandlet. Har du nye spørsmål? Ta kontakt med oss direkte.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no output (ReplyForm doesn't exist yet so this may error — that's fine, proceed to Task 5).

- [ ] **Step 3: Commit**

```bash
git add "app/svar/[case_id]/page.tsx"
git commit -m "feat: reply portal RSC page with token validation and three page states"
```

---

## Task 5: ReplyForm client component

**Files:**
- Create: `app/svar/[case_id]/ReplyForm.tsx`

- [ ] **Step 1: Create the file**

Create `app/svar/[case_id]/ReplyForm.tsx` with this full content:

```typescript
// app/svar/[case_id]/ReplyForm.tsx
'use client';
import { useState } from 'react';
import type { Message } from '@/lib/types';
import { formatDate } from '@/lib/supabase';
import { validateFile, formatFileSize } from '@/lib/attachments';

interface Props {
  caseId:       string;   // human-readable e.g. "NAF-202604-8440"
  caseUuid:     string;   // UUID for file upload route
  customerName: string;
  messages:     Pick<Message, 'id' | 'type' | 'sender_name' | 'content' | 'created_at'>[];
}

export default function ReplyForm({ caseId, caseUuid: _caseUuid, customerName: _customerName, messages }: Props) {
  const [content,    setContent]    = useState('');
  const [file,       setFile]       = useState<File | null>(null);
  const [fileError,  setFileError]  = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done,       setDone]       = useState(false);
  const [error,      setError]      = useState('');

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    e.target.value = '';
    if (!f) return;
    const err = validateFile(f);
    if (err) { setFileError(err); return; }
    setFileError('');
    setFile(f);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setSubmitting(true);
    setError('');

    // Read token from query string (it was validated server-side, but we need it for the POST)
    const token = new URLSearchParams(window.location.search).get('token') ?? '';

    // 1. Submit text reply
    const res = await fetch('/api/customer-reply', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ case_id: caseId, token, content }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError((data as { error?: string }).error ?? 'Noe gikk galt. Prøv igjen.');
      setSubmitting(false);
      return;
    }

    // 2. Upload file if selected — fire and forget, don't block success message
    if (file) {
      const fd = new FormData();
      fd.append('case_id', caseId);
      fd.append('files', file);
      fetch('/api/attachments/upload', { method: 'POST', body: fd }).catch(() => {});
    }

    setDone(true);
    setSubmitting(false);
  }

  // ── Success state ────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="px-6 py-12 text-center">
        <div className="text-4xl mb-4">✅</div>
        <h2 className="text-[16px] font-bold text-gray-900 mb-2">Takk for svaret ditt!</h2>
        <p className="text-[13px] text-gray-500 leading-relaxed">
          Vi behandler meldingen og kommer tilbake til deg så snart som mulig.
        </p>
      </div>
    );
  }

  // ── Form ─────────────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} className="p-6">

      {/* Previous messages for context */}
      {messages.length > 0 && (
        <div className="mb-5">
          <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">
            Tidligere meldinger
          </div>
          <div className="flex flex-col gap-2">
            {messages.map(m => (
              <div
                key={m.id}
                className={`text-[12px] rounded-lg px-3 py-2.5 ${
                  m.type === 'customer'
                    ? 'bg-gray-50 text-gray-700'
                    : 'bg-blue-50 text-[#003087]'
                }`}
              >
                <div className="font-semibold mb-0.5 text-[11px]">
                  {m.sender_name} · {formatDate(m.created_at)}
                </div>
                <div className="leading-relaxed line-clamp-3">{m.content}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reply textarea */}
      <div className="mb-4">
        <label className="block text-[12px] font-semibold text-gray-700 mb-1.5">
          Din melding til NAF <span className="text-red-500">*</span>
        </label>
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder="Skriv din melding her…"
          required
          maxLength={5000}
          rows={5}
          className="w-full text-[13.5px] border-[1.5px] border-gray-200 rounded-xl px-3.5 py-2.5
                     resize-none outline-none leading-relaxed
                     focus:border-[#003087] focus:ring-2 focus:ring-[#003087]/10"
        />
        <div className="text-[11px] text-gray-400 text-right mt-0.5">
          {content.length}/5000
        </div>
      </div>

      {/* Optional file attachment */}
      <div className="mb-5">
        <div className="text-[12px] font-semibold text-gray-700 mb-1.5">
          Vedlegg <span className="text-gray-400 font-normal">(valgfritt)</span>
        </div>
        {file ? (
          <div className="flex items-center gap-2 text-[12.5px] text-gray-700
                          bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
            <span className="text-base">{file.type.startsWith('image/') ? '🖼' : '📄'}</span>
            <span className="flex-1 truncate">{file.name}</span>
            <span className="text-gray-400 flex-shrink-0">{formatFileSize(file.size)}</span>
            <button
              type="button"
              onClick={() => setFile(null)}
              className="text-gray-400 hover:text-red-600 cursor-pointer bg-transparent border-none"
              aria-label="Fjern vedlegg"
            >
              ✕
            </button>
          </div>
        ) : (
          <label className="flex items-center gap-2 text-[12.5px] font-semibold text-[#003087]
                            border-[1.5px] border-[#003087]/30 rounded-lg px-3 py-2
                            hover:bg-blue-50 cursor-pointer w-fit transition-colors">
            📎 Legg til fil
            <span className="text-gray-400 font-normal text-[11.5px]">JPG, PNG, PDF · maks 10 MB</span>
            <input
              type="file"
              accept=".jpg,.jpeg,.png,.pdf"
              className="hidden"
              onChange={handleFileChange}
            />
          </label>
        )}
        {fileError && (
          <p className="text-red-600 text-[11px] mt-1">{fileError}</p>
        )}
      </div>

      {/* Submit error */}
      {error && (
        <div className="mb-4 text-[12.5px] text-red-700 bg-red-50
                        border border-red-200 rounded-lg px-3 py-2.5">
          {error}
        </div>
      )}

      {/* Submit button */}
      <button
        type="submit"
        disabled={submitting || !content.trim()}
        className="w-full bg-[#003087] text-white font-semibold text-[14px] py-3
                   rounded-xl hover:bg-[#001f5c] transition-colors cursor-pointer
                   disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.99]"
      >
        {submitting ? 'Sender…' : 'Send svar →'}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no output (clean).

- [ ] **Step 3: Run the dev server and test the portal manually**

```bash
npm run dev
```

Get a real `case_id` and `reply_token` from Supabase SQL Editor:

```sql
SELECT case_id, reply_token FROM public.cases WHERE status != 'closed' LIMIT 1;
```

Open in browser:

```
http://localhost:3000/svar/<case_id>?token=<reply_token>
```

Verify:
1. Page loads with case reference header
2. Context messages show (if any exist on the case)
3. Typing in the textarea shows character count
4. Submitting creates a new message — check Supabase Table Editor → messages
5. Success state shows after submit
6. Navigate to `/saksbehandling`, open the same case — the customer message appears in the timeline

Test invalid token:
```
http://localhost:3000/svar/<case_id>?token=00000000-0000-0000-0000-000000000000
```
Expected: "Ugyldig lenke" state.

- [ ] **Step 4: Commit**

```bash
git add "app/svar/[case_id]/ReplyForm.tsx"
git commit -m "feat: reply portal client form with file upload and success state"
```

---

## Task 6: End-to-end test + push

- [ ] **Step 1: Full flow test**

1. Open `/saksbehandling`, pick any open case
2. Write a reply in the compose box, click "Send →"
3. Check your email — the agent reply email should now contain a "Svar på reklamasjonen →" button at the bottom
4. Click the button — portal page opens with the case context and reply form
5. Write a reply in the portal, submit
6. Check `/saksbehandling` — the customer reply appears in the timeline in real-time
7. Check email — saksbehandler notification email received with the customer message and "Åpne saken →" button

- [ ] **Step 2: Test closed case**

In Supabase SQL Editor, temporarily close a case:
```sql
UPDATE public.cases SET status = 'closed' WHERE case_id = '<your_test_case>';
```

Navigate to the portal URL for that case — should show "Saken er avsluttet" with no form.

Restore:
```sql
UPDATE public.cases SET status = 'open' WHERE case_id = '<your_test_case>';
```

- [ ] **Step 3: Final typecheck**

```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 4: Push**

```bash
git push origin main
```

Wait ~45s for Vercel to deploy, then repeat the full flow test on the production URL.

---

## Self-review checklist

**Spec coverage:**
- ✅ `reply_token` on cases — Task 1
- ✅ Token validation (timing-safe) — Task 2
- ✅ Insert `customer` message — Task 2
- ✅ Notify saksbehandler (assigned → all if none) — Task 2
- ✅ Reply link in outbound agent email — Task 3
- ✅ Portal page: valid / invalid / closed states — Task 4
- ✅ Context messages (internal notes excluded) — Task 4
- ✅ Form with textarea + file upload — Task 5
- ✅ Success state — Task 5
- ✅ File upload reuses existing `/api/attachments/upload` route — Task 5
- ✅ End-to-end verification — Task 6

**Type consistency:**
- `caseId` (human-readable string) used consistently across Tasks 2, 4, 5
- `caseUuid` (UUID) passed to ReplyForm but only used by file upload (currently unused since upload uses `case_id` string — route resolves it server-side)
- `Message` pick type identical in page.tsx and ReplyForm.tsx props
