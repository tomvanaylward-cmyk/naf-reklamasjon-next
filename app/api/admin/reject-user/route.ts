// app/api/admin/reject-user/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { adminDb, requireAdmin } from '@/lib/admin-api';

export async function POST(req: NextRequest) {
  const caller = await requireAdmin(req);
  if (!caller) {
    return NextResponse.json({ error: 'Ikke autorisert' }, { status: 401 });
  }

  try {
    const { id } = await req.json();

    const { data: pending, error: fetchError } = await adminDb
      .from('pending_registrations')
      .select('email, full_name')
      .eq('id', id)
      .single();

    if (fetchError || !pending) {
      return NextResponse.json({ error: 'Søknad ikke funnet' }, { status: 404 });
    }

    await adminDb.from('pending_registrations').delete().eq('id', id);

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    await fetch(`${baseUrl}/api/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type:          'registration_rejected',
        to:            pending.email,
        applicantName: pending.full_name,
      }),
    }).catch(err => console.error('Rejection email failed:', err));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Reject error:', err);
    return NextResponse.json({ error: 'Serverfeil' }, { status: 500 });
  }
}
