// app/api/customer-reply/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
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
      return NextResponse.json({ error: 'Ugyldig lenke' }, { status: 403 });
    }

    // Timing-safe token comparison. Both are 36 bytes when reply_token is a valid UUID.
    // The length check below guards against a null/empty reply_token in the database.
    const tokenA = Buffer.from(token);
    const tokenB = Buffer.from(caseRow.reply_token ?? '');
    const valid =
      tokenA.length === tokenB.length &&
      tokenB.length === 36 &&
      timingSafeEqual(tokenA, tokenB);

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

    // Notify reklamasjonsansvarlig — fire and forget
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
      .in('role', ['reklamasjonsansvarlig', 'overordnet', 'admin']);
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
