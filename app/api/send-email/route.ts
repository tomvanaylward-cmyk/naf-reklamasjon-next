import { NextRequest, NextResponse } from 'next/server';
import sgMail from '@sendgrid/mail';

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { type, to, caseId, replyContent, fromName } = body;

    let subject = '', html = '';

    if (type === 'agent_reply') {
      subject = `Re: Din reklamasjon ${caseId} – NAF`;
      html = `<p>Hei,</p><p>${replyContent}</p><p>Med vennlig hilsen,<br>${fromName}<br>NAF Reklamasjonsservice</p>`;
    } else if (type === 'case_received') {
      subject = `Reklamasjon mottatt – ${caseId}`;
      html = `<p>Hei,</p><p>Vi har mottatt din reklamasjon (${caseId}) og vil behandle den så snart som mulig.</p>`;
    }

    if (!subject) return NextResponse.json({ error: 'Ukjent e-posttype' }, { status: 400 });

    await sgMail.send({ to, from: 'tom.van.aylward@gmail.com', subject, html });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('SendGrid error:', err);
    return NextResponse.json({ error: 'E-postfeil' }, { status: 500 });
  }
}
