import { NextRequest, NextResponse } from 'next/server';
import sgMail from '@sendgrid/mail';
import { createClient } from '@supabase/supabase-js';

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

// Recipients stored in env var: NOTIFY_RECIPIENTS=a@b.no,c@d.no
const NOTIFY_RECIPIENTS = (process.env.NOTIFY_RECIPIENTS ?? '')
  .split(',')
  .map(e => e.trim())
  .filter(Boolean);

// Server-only client — never falls back to anon key
const db = createClient(
  (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim(),
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function GET(req: NextRequest) {
  // Require a CRON_SECRET header to prevent unauthenticated triggering
  const secret = req.headers.get('x-cron-secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (NOTIFY_RECIPIENTS.length === 0) {
    return NextResponse.json({ error: 'NOTIFY_RECIPIENTS env var ikke satt' }, { status: 500 });
  }

  const now = new Date().toISOString();
  const { data: hangingCases, error } = await db
    .from('cases')
    .select('case_id, customer_name, company, category, senter, status, sla_deadline, created_at, assigned_to')
    .neq('status', 'closed')
    .lt('sla_deadline', now)
    .order('sla_deadline', { ascending: true });

  if (error) {
    console.error('Supabase error:', error);
    return NextResponse.json({ error: 'Databasefeil' }, { status: 500 });
  }

  if (!hangingCases || hangingCases.length === 0) {
    return NextResponse.json({ sent: false, reason: 'No hanging cases' });
  }

  const count   = hangingCases.length;
  const nowDate = new Date();

  const tableRows = hangingCases.map(c => {
    const deadline  = new Date(c.sla_deadline);
    const hoursOver = Math.round((nowDate.getTime() - deadline.getTime()) / 3600000);
    return `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-family:monospace;font-size:13px;color:#003087;font-weight:700">${c.case_id}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px">${c.customer_name}${c.company ? ` (${c.company})` : ''}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px">${c.category}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px">${c.senter || '–'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#E3000F;font-weight:600">${hoursOver}t over fristen</td>
      </tr>`;
  }).join('');

  const html = `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:700px;margin:0 auto">
      <div style="background:#003087;padding:16px 24px;border-radius:8px 8px 0 0">
        <span style="background:#E3000F;color:white;font-weight:700;font-size:12px;padding:3px 8px;border-radius:4px;margin-right:10px">NAF</span>
        <span style="color:white;font-weight:600;font-size:15px">Reklamasjonssystem – Varsel</span>
      </div>
      <div style="background:#fff8f0;border:1px solid #fde8d0;border-radius:0 0 8px 8px;padding:24px">
        <h2 style="margin:0 0 8px;color:#92400E;font-size:18px">
          ⚠️ ${count} sak${count > 1 ? 'er' : ''} henger over SLA-fristen
        </h2>
        <p style="color:#6B7280;font-size:14px;margin:0 0 20px">
          Varseltidspunkt: ${nowDate.toLocaleString('nb-NO', { timeZone: 'Europe/Oslo', dateStyle: 'full', timeStyle: 'short' })}
        </p>
        <table style="width:100%;border-collapse:collapse;background:white;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb">
          <thead>
            <tr style="background:#F5F6FA">
              <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#9CA3AF">Saksnr</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#9CA3AF">Kunde</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#9CA3AF">Kategori</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#9CA3AF">Senter</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#9CA3AF">Over frist</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
        <div style="margin-top:20px;padding-top:16px;border-top:1px solid #e5e7eb">
          <a href="https://naf-reklamasjon-next.vercel.app/saksbehandling"
            style="background:#003087;color:white;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;font-size:14px">
            Åpne saksbehandling →
          </a>
        </div>
      </div>
    </div>`;

  const subject = `⚠️ ${count} sak${count > 1 ? 'er henger' : ' henger'} over SLA – NAF Reklamasjon`;

  await sgMail.sendMultiple({ to: NOTIFY_RECIPIENTS, from: 'tom.van.aylward@gmail.com', subject, html });

  return NextResponse.json({ sent: true, count });
}
