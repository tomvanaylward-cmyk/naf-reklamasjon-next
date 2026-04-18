import { NextRequest, NextResponse } from 'next/server';
import sgMail from '@sendgrid/mail';
import { createClient } from '@supabase/supabase-js';

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

// Use service role key so RLS doesn't block fetching saksbehandler email addresses
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { type, to, caseId, replyContent, fromName, caseName, category, senter } = body;

    let subject = '';
    let html    = '';

    if (type === 'agent_reply') {
      subject = `Re: Din reklamasjon ${caseId} – NAF`;
      html    = `<p>Hei,</p><p>${replyContent}</p><p>Med vennlig hilsen,<br>${fromName}<br>NAF Reklamasjonsservice</p>`;
      await sgMail.send({ to, from: 'tom.van.aylward@gmail.com', subject, html });

    } else if (type === 'case_received') {
      subject = `Reklamasjon mottatt – ${caseId}`;
      html    = `<p>Hei,</p><p>Vi har mottatt din reklamasjon (${caseId}) og vil behandle den så snart som mulig.</p>`;
      await sgMail.send({ to, from: 'tom.van.aylward@gmail.com', subject, html });

    } else if (type === 'escalation_notify') {
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
          <div style="background:#003087;padding:16px 24px;border-radius:8px 8px 0 0">
            <span style="background:#E3000F;color:white;font-weight:700;font-size:12px;padding:3px 8px;border-radius:4px;margin-right:10px">NAF</span>
            <span style="color:white;font-weight:600;font-size:15px">Reklamasjonssystem – Eskalering</span>
          </div>
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
              <a href="https://naf-reklamasjon-next.vercel.app/saksbehandling"
                style="background:#003087;color:white;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;font-size:14px">
                Åpne saksbehandling →
              </a>
            </div>
          </div>
        </div>`;

      await sgMail.sendMultiple({
        to:      recipients,
        from:    'tom.van.aylward@gmail.com',
        subject,
        html,
      });

    } else {
      return NextResponse.json({ error: 'Ukjent e-posttype' }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('SendGrid error:', err);
    return NextResponse.json({ error: 'E-postfeil' }, { status: 500 });
  }
}
