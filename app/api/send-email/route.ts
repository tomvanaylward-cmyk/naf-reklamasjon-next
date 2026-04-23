// app/api/send-email/route.ts
import { NextRequest, NextResponse } from 'next/server';
import sgMail from '@sendgrid/mail';
import { adminDb } from '@/lib/admin-api';

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

const FROM     = 'tom.van.aylward@gmail.com';
const BASE_URL = 'https://naf-reklamasjon-next.vercel.app';

/** HTML-escape user-supplied strings to prevent email injection / stored XSS. */
function esc(s: string | null | undefined): string {
  if (!s) return '–';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/** Require a valid Supabase Bearer token. Returns the user or null. */
async function requireAuth(req: NextRequest) {
  const auth  = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const { data: { user }, error } = await adminDb.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

function nafHeader(subtitle: string) {
  return `
    <div style="background:#003087;padding:16px 24px;border-radius:8px 8px 0 0">
      <span style="background:#E3000F;color:white;font-weight:700;font-size:12px;padding:3px 8px;border-radius:4px;margin-right:10px">NAF</span>
      <span style="color:white;font-weight:600;font-size:15px">${esc(subtitle)}</span>
    </div>`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { type, to } = body;

    // ── case_received ────────────────────────────────────────────────────────
    // Public: called from the complaint form without auth.
    // Guard: verify caseId actually exists in DB (prevents spam relay).
    if (type === 'case_received') {
      const { caseId } = body;
      const { data: caseRow } = await adminDb
        .from('cases')
        .select('id')
        .eq('case_id', caseId)
        .single();
      if (!caseRow) {
        return NextResponse.json({ error: 'Ugyldig saksnummer' }, { status: 400 });
      }
      const subject = `Reklamasjon mottatt – ${esc(caseId)}`;
      const html    = `<p>Hei,</p><p>Vi har mottatt din reklamasjon (${esc(caseId)}) og vil behandle den så snart som mulig.</p>`;
      await sgMail.send({ to, from: FROM, subject, html });
      return NextResponse.json({ ok: true });
    }

    // ── All other types require a valid Supabase session ─────────────────────
    const user = await requireAuth(req);
    if (!user) {
      return NextResponse.json({ error: 'Ikke autorisert' }, { status: 401 });
    }

    let subject = '';
    let html    = '';

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

    } else if (type === 'escalation_notify') {
      const { caseId, caseName, category, senter, fromName } = body;
      const { data: handlers } = await adminDb
        .from('profiles')
        .select('email')
        .in('role', ['saksbehandler', 'admin']);

      const recipients = (handlers || []).map((h: { email: string }) => h.email).filter(Boolean);
      if (recipients.length === 0) {
        return NextResponse.json({ ok: true, sent: false, reason: 'No saksbehandlere found' });
      }

      subject = `🔺 Sak eskalert – ${esc(caseId)}`;
      html    = `
        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto">
          ${nafHeader('Reklamasjonssystem – Eskalering')}
          <div style="background:#fff8f0;border:1px solid #fde8d0;border-radius:0 0 8px 8px;padding:24px">
            <h2 style="margin:0 0 12px;color:#92400E;font-size:18px">🔺 En sak er eskalert til saksbehandler</h2>
            <table style="width:100%;border-collapse:collapse;font-size:14px">
              <tr><td style="padding:6px 0;color:#6B7280;width:120px">Saksnummer</td><td style="font-weight:600;color:#003087;font-family:monospace">${esc(caseId)}</td></tr>
              <tr><td style="padding:6px 0;color:#6B7280">Kunde</td><td style="font-weight:600">${esc(caseName)}</td></tr>
              <tr><td style="padding:6px 0;color:#6B7280">Kategori</td><td>${esc(category)}</td></tr>
              <tr><td style="padding:6px 0;color:#6B7280">Senter</td><td>${esc(senter)}</td></tr>
              <tr><td style="padding:6px 0;color:#6B7280">Eskalert av</td><td>${esc(fromName)}</td></tr>
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

    } else if (type === 'registration_notify') {
      const { applicantName, applicantEmail, senter: applicantSenter } = body;
      const { data: admins } = await adminDb.from('profiles').select('email').eq('role', 'admin');
      const recipients = (admins || []).map((a: { email: string }) => a.email).filter(Boolean);
      if (recipients.length === 0) {
        return NextResponse.json({ ok: true, sent: false, reason: 'No admins found' });
      }
      subject = `🔔 Ny tilgangsforespørsel – ${esc(applicantName)} (${esc(applicantSenter)})`;
      html    = `
        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto">
          ${nafHeader('Reklamasjonssystem – Ny søknad')}
          <div style="background:#f0f4ff;border:1px solid #d0daf0;border-radius:0 0 8px 8px;padding:24px">
            <h2 style="margin:0 0 12px;color:#003087;font-size:18px">🔔 Ny tilgangsforespørsel</h2>
            <table style="width:100%;border-collapse:collapse;font-size:14px">
              <tr><td style="padding:6px 0;color:#6B7280;width:120px">Navn</td><td style="font-weight:600">${esc(applicantName)}</td></tr>
              <tr><td style="padding:6px 0;color:#6B7280">E-post</td><td>${esc(applicantEmail)}</td></tr>
              <tr><td style="padding:6px 0;color:#6B7280">Senter</td><td>${esc(applicantSenter)}</td></tr>
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
      const { applicantName, tempPassword } = body;
      subject = `✅ Tilgang godkjent – NAF Reklamasjonssystem`;
      html    = `
        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto">
          ${nafHeader('Reklamasjonssystem')}
          <div style="background:#f0fff4;border:1px solid #c6f6d5;border-radius:0 0 8px 8px;padding:24px">
            <h2 style="margin:0 0 12px;color:#276749;font-size:18px">✅ Din tilgang er godkjent</h2>
            <p style="font-size:14px;color:#374151">Hei ${esc(applicantName)},</p>
            <p style="font-size:14px;color:#374151">Din søknad om tilgang til NAF Reklamasjonssystem er godkjent.</p>
            <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">
              <tr><td style="padding:6px 0;color:#6B7280;width:160px">E-post (brukernavn)</td><td style="font-weight:600">${esc(to)}</td></tr>
              <tr><td style="padding:6px 0;color:#6B7280">Midlertidig passord</td><td style="font-weight:700;font-family:monospace;font-size:16px">${esc(tempPassword)}</td></tr>
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
      const { applicantName } = body;
      subject = `Din tilgangsforespørsel – NAF Reklamasjonssystem`;
      html    = `
        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto">
          ${nafHeader('Reklamasjonssystem')}
          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:0 0 8px 8px;padding:24px">
            <h2 style="margin:0 0 12px;color:#374151;font-size:18px">Din søknad er behandlet</h2>
            <p style="font-size:14px;color:#374151">Hei ${esc(applicantName)},</p>
            <p style="font-size:14px;color:#374151">Din søknad om tilgang til NAF Reklamasjonssystem er dessverre ikke godkjent.</p>
            <p style="font-size:14px;color:#374151">Ta kontakt med din leder for mer informasjon.</p>
          </div>
        </div>`;
      await sgMail.send({ to, from: FROM, subject, html });

    } else if (type === 'password_reset') {
      const { tempPassword } = body;
      subject = `🔑 Nytt midlertidig passord – NAF Reklamasjonssystem`;
      html    = `
        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto">
          ${nafHeader('Reklamasjonssystem')}
          <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:0 0 8px 8px;padding:24px">
            <h2 style="margin:0 0 12px;color:#92400E;font-size:18px">🔑 Passord tilbakestilt</h2>
            <p style="font-size:14px;color:#374151">Ditt passord har blitt tilbakestilt av en administrator.</p>
            <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">
              <tr><td style="padding:6px 0;color:#6B7280;width:160px">Midlertidig passord</td><td style="font-weight:700;font-family:monospace;font-size:16px">${esc(tempPassword)}</td></tr>
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
