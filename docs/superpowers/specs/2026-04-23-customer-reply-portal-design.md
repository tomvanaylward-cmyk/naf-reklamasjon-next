# Customer Reply Portal — Design Spec

**Goal:** Allow customers to reply to agent emails via a secure web portal, with replies appearing instantly in the case timeline and a notification sent to the assigned saksbehandler.

**Background:** Outbound emails to customers are already sent via SendGrid. Without MX record control, true email threading (customer hits Reply → lands in tool) is not possible. Instead, every outbound agent email includes a "Svar på reklamasjonen →" button linking to a lightweight public web page where the customer writes and submits their reply.

**Tech stack:** Next.js 16 App Router, TypeScript, Tailwind CSS v4, Supabase (auth + database + storage), SendGrid

---

## Architecture

Four components work together:

```
Agent sends reply in tool
        ↓
send-email route includes reply portal link in email body
        ↓
Customer clicks "Svar på reklamasjonen →" in email
        ↓
/svar/[case_id]?token=<reply_token> — public portal page
        ↓
Customer writes reply (+ optional file) → submits
        ↓
POST /api/customer-reply validates token, inserts message, uploads file
        ↓
├── Timeline updates in real-time (Supabase Realtime already works)
└── Email notification → assigned saksbehandler (or all saksbehandlere if unassigned)
```

---

## Section 1: Database

### New column on `cases`

```sql
ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS reply_token UUID NOT NULL DEFAULT gen_random_uuid();

-- Backfill existing rows (they get NULL until this runs)
UPDATE public.cases SET reply_token = gen_random_uuid() WHERE reply_token IS NULL;
```

`reply_token` is a UUID — 122 bits of entropy, not guessable. It does not rotate after each reply; it is stable for the lifetime of the case. This means the same link works for all replies on a given case, which is the correct UX (customer may reply days later from the same email).

### RLS

No new RLS policy needed. The `/api/customer-reply` route uses `adminDb` (service role) to insert messages, bypassing RLS — exactly like the existing `/api/attachments/upload` route. The token is the access control mechanism.

---

## Section 2: Reply portal page

**Route:** `app/svar/[case_id]/page.tsx`  
**Auth:** None (public page — any visitor with the correct token can submit)

### URL format

```
https://naf-reklamasjon-next.vercel.app/svar/NAF-202604-8440?token=550e8400-e29b-41d4-a716-446655440000
```

### Page states

**Valid token + open case:** Show the reply form.

**Invalid token or case_id not found:** Show a generic error — *"Lenken er ugyldig eller utløpt. Ta kontakt med oss direkte."* Do not reveal whether the case_id exists.

**Case is `closed`:** Show — *"Denne saken er avsluttet. Har du flere spørsmål? Kontakt oss på [FROM email]."* No form rendered.

### Form layout

```
┌─ NAF logo ──────────────────────────────────────────┐
│  Din reklamasjon NAF-202604-8440                    │
│  [category] · [senter]                              │
├─────────────────────────────────────────────────────┤
│  Siste meldinger (maks 3, nyeste øverst):           │
│  ┌─────────────────────────────────────────────┐    │
│  │ NAF — 22. apr: "Vi ser på saken din..."     │    │
│  └─────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────┤
│  Din melding til NAF *                              │
│  ┌─────────────────────────────────────────────┐    │
│  │                                             │    │
│  │                                             │    │
│  └─────────────────────────────────────────────┘    │
│  Vedlegg (valgfritt) — JPG, PNG, PDF · maks 10 MB  │
│  [+ Legg til fil]                                   │
│                       [Send svar →]                 │
└─────────────────────────────────────────────────────┘
```

### After submission

Replace the form with a confirmation message — no redirect:

> **Takk for svaret ditt!**  
> Vi behandler meldingen og kommer tilbake til deg så snart som mulig.

No confirmation email is sent to the customer (keeps the flow simple; the saksbehandler's next reply will serve as acknowledgement).

### Data fetched server-side (RSC)

The page is a React Server Component. On load it:
1. Looks up `case_id` in `cases` (using `adminDb`) — returns 404 if not found
2. Validates `?token` matches `cases.reply_token` — shows invalid-token state if not
3. Fetches the last 3 messages for context display
4. Passes `{ case, messages }` to a client component that renders the form

Using RSC means no token is exposed to the browser in JS — the validation happens server-side.

---

## Section 3: Customer reply API route

**Route:** `app/api/customer-reply/route.ts`  
**Method:** `POST`  
**Auth:** None (validated by token in body)

### Request body

```typescript
{
  case_id:     string;   // human-readable e.g. "NAF-202604-8440"
  token:       string;   // reply_token UUID
  content:     string;   // customer's message text (max 5 000 chars)
}
```

File uploads are handled separately: after the text message is created, the client calls the existing `/api/attachments/upload` route with the new message's `case_id`. No change needed to that route.

### Validation

1. `case_id` and `token` must be present — 400 if missing
2. `content` must be 1–5 000 characters — 400 if outside range
3. Look up case by `case_id` using `adminDb` — 404 if not found
4. Compare `token` to `cases.reply_token` using `crypto.timingSafeEqual` — 403 if mismatch
5. If `cases.status === 'closed'` — 409 with message "Saken er avsluttet"

### On success

```typescript
// 1. Insert customer message
await adminDb.from('messages').insert({
  case_id:     caseRow.id,       // UUID
  type:        'customer',
  sender_name: caseRow.customer_name,
  content:     content.trim(),
  created_at:  new Date().toISOString(),
});

// 2. Send notification email (fire-and-forget, errors are logged not thrown)
await notifySaksbehandler(caseRow);

// 3. Return success
return NextResponse.json({ ok: true });
```

### Error responses

| Condition | Status | Body |
|-----------|--------|------|
| Missing fields | 400 | `{ error: 'Mangler felt' }` |
| Content too long | 400 | `{ error: 'Meldingen er for lang (maks 5 000 tegn)' }` |
| Case not found | 404 | `{ error: 'Sak ikke funnet' }` |
| Token mismatch | 403 | `{ error: 'Ugyldig lenke' }` |
| Case closed | 409 | `{ error: 'Saken er avsluttet' }` |
| Unexpected error | 500 | `{ error: 'Noe gikk galt' }` (no internal details) |

---

## Section 4: Saksbehandler notification email

Add new email type `customer_reply_notify` to `app/api/send-email/route.ts`.

This is called internally from the customer-reply route (not from the browser), so no auth header is needed — it uses `adminDb` directly within the same server process.

### Email content

**Subject:** `Ny melding fra [customer_name] – [case_id]`

**Body:**
- NAF header (reuse `nafHeader()` helper already in the file)
- "Du har mottatt en ny melding fra [customer_name] på sak [case_id]"
- Quoted message (the customer's text, HTML-escaped)
- CTA button: "Åpne saken →" linking to `BASE_URL/saksbehandling`

**Recipients:**
- If `cases.assigned_to` is set → send to that agent's email (look up in `profiles`)
- If `cases.assigned_to` is null → send to all `saksbehandler` and `admin` profiles (same pattern as `escalation_notify`)

### Extract to helper

The notification logic lives in a `notifySaksbehandler(caseRow)` function inside `customer-reply/route.ts`. It calls `sgMail.send()` directly (not via the `/api/send-email` route) to avoid an internal HTTP round-trip.

---

## Section 5: Outbound email — add reply link

Update the `agent_reply` case in `app/api/send-email/route.ts`.

The route needs `reply_token` when building the email. Fetch it from the DB:

```typescript
const { data: caseRow } = await adminDb
  .from('cases')
  .select('id, reply_token')
  .eq('case_id', caseId)
  .single();

const replyUrl = `${BASE_URL}/svar/${esc(caseId)}?token=${caseRow?.reply_token ?? ''}`;
```

Append to the email HTML, after the main reply content:

```html
<hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0">
<p style="font-size:13px;color:#6B7280;margin:0 0 12px">
  Vil du svare på denne meldingen?
</p>
<a href="${replyUrl}"
   style="background:#003087;color:white;text-decoration:none;
          padding:10px 20px;border-radius:8px;font-weight:600;font-size:14px">
  Svar på reklamasjonen →
</a>
<p style="font-size:11px;color:#9CA3AF;margin:16px 0 0">
  Lenken er personlig og gjelder kun for denne saken.
</p>
```

---

## Section 6: File attachment in portal

The portal form includes an optional file input (JPG, PNG, PDF, max 10 MB — matching existing limits).

After the text reply is successfully submitted (step 3 returns `{ ok: true }`), the client calls `POST /api/attachments/upload` with:
- `case_id`: the human-readable case ID (route already resolves to UUID)
- `files`: the selected file(s)

No auth header is sent (the existing upload route allows `uploader_id: null` for anonymous uploads — already the case for customer submissions in `ny-reklamasjon`).

This reuses the existing upload infrastructure with zero changes to that route.

---

## Security summary

| Threat | Mitigation |
|--------|-----------|
| Guessing a case's reply URL | UUID token — 2^122 combinations |
| Timing attack on token comparison | `crypto.timingSafeEqual` |
| Submitting to a closed case | 409 response, no message created |
| Message spam / flooding | Max 5 000 chars per submission; Vercel rate limits apply |
| XSS via customer content | All content HTML-escaped before display and in emails |
| Internal error disclosure | 500 responses return generic message only |
| Token harvesting from URL logs | Token in query string (acceptable — same pattern used by Supabase magic links, Calendly, etc.) |

---

## Files created / modified

| Action | File |
|--------|------|
| Create | `app/svar/[case_id]/page.tsx` |
| Create | `app/svar/[case_id]/ReplyForm.tsx` (client component) |
| Create | `app/api/customer-reply/route.ts` |
| Modify | `app/api/send-email/route.ts` — add reply link to `agent_reply`, add `notifySaksbehandler` helper |
| SQL | Add `reply_token` column + backfill |

---

## SQL to run in Supabase

```sql
ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS reply_token UUID NOT NULL DEFAULT gen_random_uuid();

UPDATE public.cases SET reply_token = gen_random_uuid() WHERE reply_token IS NULL;

NOTIFY pgrst, 'reload schema';
```
