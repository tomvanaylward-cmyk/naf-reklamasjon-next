// app/api/admin/approve-user/route.ts
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { adminDb, requireAdmin } from '@/lib/admin-api';
import { sendRegistrationApproved } from '@/lib/email';

export async function POST(req: NextRequest) {
  const caller = await requireAdmin(req);
  if (!caller) {
    return NextResponse.json({ error: 'Ikke autorisert' }, { status: 401 });
  }

  try {
    const { id } = await req.json();

    const { data: pending, error: fetchError } = await adminDb
      .from('pending_registrations')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !pending) {
      return NextResponse.json({ error: 'Søknad ikke funnet' }, { status: 404 });
    }

    const tempPassword = crypto.randomBytes(12).toString('base64url');

    const { data: authData, error: createError } = await adminDb.auth.admin.createUser({
      email:         pending.email,
      password:      tempPassword,
      email_confirm: true,
      user_metadata: { full_name: pending.full_name },
    });

    if (createError || !authData.user) {
      console.error('Create user error:', createError);
      return NextResponse.json({ error: `Kunne ikke opprette bruker: ${createError?.message ?? 'ukjent feil'}` }, { status: 500 });
    }

    const { error: profileError } = await adminDb
      .from('profiles')
      .upsert({
        id:        authData.user.id,
        email:     pending.email,
        full_name: pending.full_name,
        role:      'senterleder',
        senter:    pending.senter,
        status:    'active',
      }, { onConflict: 'id' });

    if (profileError) {
      console.error('Profile upsert error:', profileError);
      await adminDb.auth.admin.deleteUser(authData.user.id).catch(e =>
        console.error('Failed to clean up auth user after profile failure:', e)
      );
      return NextResponse.json({ error: 'Bruker opprettet men profil feilet — forsøk igjen' }, { status: 500 });
    }

    await adminDb.from('pending_registrations').delete().eq('id', id);

    await sendRegistrationApproved(pending.email, pending.full_name, tempPassword)
      .catch(err => console.error('Approval email failed:', err));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Approve error:', err);
    return NextResponse.json({ error: 'Serverfeil' }, { status: 500 });
  }
}
