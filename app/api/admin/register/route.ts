// app/api/admin/register/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/admin-api';

export async function POST(req: NextRequest) {
  try {
    const { full_name, email, senter } = await req.json();

    if (!full_name?.trim() || !email?.trim() || !senter?.trim()) {
      return NextResponse.json({ error: 'Alle felter er påkrevd' }, { status: 400 });
    }

    if (!email.includes('@') || !email.includes('.')) {
      return NextResponse.json({ error: 'Ugyldig e-postadresse' }, { status: 400 });
    }

    const { data: existing } = await adminDb
      .from('pending_registrations')
      .select('id')
      .eq('email', email.trim().toLowerCase())
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: 'Det finnes allerede en søknad for denne e-posten' }, { status: 409 });
    }

    // Also check if a profile already exists for this email
    const { data: existingProfile } = await adminDb
      .from('profiles')
      .select('id')
      .eq('email', email.trim().toLowerCase())
      .maybeSingle();

    if (existingProfile) {
      return NextResponse.json({ error: 'En bruker med denne e-posten finnes allerede' }, { status: 409 });
    }

    const { error: insertError } = await adminDb
      .from('pending_registrations')
      .insert({ full_name: full_name.trim(), email: email.trim().toLowerCase(), senter: senter.trim() });

    if (insertError) {
      console.error('Insert error:', insertError);
      return NextResponse.json({ error: 'Kunne ikke lagre søknad' }, { status: 500 });
    }

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
