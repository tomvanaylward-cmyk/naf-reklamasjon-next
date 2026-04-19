// app/api/admin/register/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/admin-api';
import { sendRegistrationNotify } from '@/lib/email';

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

    await sendRegistrationNotify(full_name.trim(), email.trim().toLowerCase(), senter.trim())
      .catch(err => console.error('Registration notify email failed:', err));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Register error:', err);
    return NextResponse.json({ error: 'Serverfeil' }, { status: 500 });
  }
}
