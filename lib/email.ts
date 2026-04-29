// lib/email.ts
import sgMail from '@sendgrid/mail';
import { adminDb } from '@/lib/admin-api';

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

const FROM     = 'tom.van.aylward@gmail.com';
const BASE_URL = 'https://naf-reklamasjon-next.vercel.app';

function nafHeader(subtitle: string) {
  return `
    <div style="background:#003087;padding:16px 24px;border-radius:8px 8px 0 0">
      <span style="background:#E3000F;color:white;font-weight:700;font-size:12px;padding:3px 8px;border-radius:4px;margin-right:10px">NAF</span>
      <span style="color:white;font-weight:600;font-size:15px">${subtitle}</span>
    </div>`;
}

/** Notify all admin and overordnet users that a new registration is pending */
export async function sendRegistrationNotify(applicantName: string, applicantEmail: string, senter: string) {
  const { data: admins } = await adminDb
    .from('profiles')
    .select('email')
    .in('role', ['admin', 'overordnet']);
  const recipients = (admins || []).map((a: { email: string }) => a.email).filter(Boolean);
  if (recipients.length === 0) return;

  await sgMail.sendMultiple({
    to:      recipients,
    from:    FROM,
    subject: `🔔 Ny tilgangsforespørsel – ${applicantName} (${senter})`,
    html:    `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto">
        ${nafHeader('Reklamasjonssystem – Ny søknad')}
        <div style="background:#f0f4ff;border:1px solid #d0daf0;border-radius:0 0 8px 8px;padding:24px">
          <h2 style="margin:0 0 12px;color:#003087;font-size:18px">🔔 Ny tilgangsforespørsel</h2>
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <tr><td style="padding:6px 0;color:#6B7280;width:120px">Navn</td><td style="font-weight:600">${applicantName}</td></tr>
            <tr><td style="padding:6px 0;color:#6B7280">E-post</td><td>${applicantEmail}</td></tr>
            <tr><td style="padding:6px 0;color:#6B7280">Senter</td><td>${senter}</td></tr>
            <tr><td style="padding:6px 0;color:#6B7280">Tidspunkt</td><td>${new Date().toLocaleString('nb-NO')}</td></tr>
          </table>
          <div style="margin-top:20px">
            <a href="${BASE_URL}/admin" style="background:#003087;color:white;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;font-size:14px">Behandle søknad →</a>
          </div>
        </div>
      </div>`,
  });
}

/** Send welcome email with temp password to approved user */
export async function sendRegistrationApproved(to: string, applicantName: string, tempPassword: string) {
  await sgMail.send({
    to,
    from:    FROM,
    subject: `✅ Tilgang godkjent – NAF Reklamasjonssystem`,
    html:    `
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
            <a href="${BASE_URL}/login" style="background:#003087;color:white;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;font-size:14px">Logg inn →</a>
          </div>
        </div>
      </div>`,
  });
}

/** Send rejection email to applicant */
export async function sendRegistrationRejected(to: string, applicantName: string) {
  await sgMail.send({
    to,
    from:    FROM,
    subject: `Din tilgangsforespørsel – NAF Reklamasjonssystem`,
    html:    `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto">
        ${nafHeader('Reklamasjonssystem')}
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:0 0 8px 8px;padding:24px">
          <h2 style="margin:0 0 12px;color:#374151;font-size:18px">Din søknad er behandlet</h2>
          <p style="font-size:14px;color:#374151">Hei ${applicantName},</p>
          <p style="font-size:14px;color:#374151">Din søknad om tilgang til NAF Reklamasjonssystem er dessverre ikke godkjent.</p>
          <p style="font-size:14px;color:#374151">Ta kontakt med din leder for mer informasjon.</p>
        </div>
      </div>`,
  });
}

/** Send temporary password to user after admin reset */
export async function sendPasswordReset(to: string, tempPassword: string) {
  await sgMail.send({
    to,
    from:    FROM,
    subject: `🔑 Nytt midlertidig passord – NAF Reklamasjonssystem`,
    html:    `
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
            <a href="${BASE_URL}/login" style="background:#003087;color:white;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;font-size:14px">Logg inn →</a>
          </div>
        </div>
      </div>`,
  });
}
