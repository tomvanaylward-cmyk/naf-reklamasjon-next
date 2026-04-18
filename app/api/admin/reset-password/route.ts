// app/api/admin/reset-password/route.ts
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { adminDb, requireAdmin } from '@/lib/admin-api';

export async function POST(req: NextRequest) {
  const caller = await requireAdmin(req);
  if (!caller) {
    return NextResponse.json({ error: 'Ikke autorisert' }, { status: 401 });
  }

  try {
    const { userId } = await req.json();

    if (!userId) {
      return NextResponse.json({ error: 'userId er påkrevd' }, { status: 400 });
    }

    const { data: profile, error: profileError } = await adminDb
      .from('profiles')
      .select('email')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: 'Bruker ikke funnet' }, { status: 404 });
    }

    const tempPassword = crypto.randomBytes(12).toString('base64url');

    const { error: updateError } = await adminDb.auth.admin.updateUserById(userId, {
      password: tempPassword,
    });

    if (updateError) {
      console.error('Password reset error:', updateError);
      return NextResponse.json({ error: 'Kunne ikke tilbakestille passord' }, { status: 500 });
    }

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    await fetch(`${baseUrl}/api/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type:        'password_reset',
        to:          profile.email,
        tempPassword,
      }),
    }).catch(err => console.error('Password reset email failed:', err));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Reset password error:', err);
    return NextResponse.json({ error: 'Serverfeil' }, { status: 500 });
  }
}
