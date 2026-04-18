// app/api/admin/update-user/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { adminDb, requireAdmin } from '@/lib/admin-api';

export async function POST(req: NextRequest) {
  const caller = await requireAdmin(req);
  if (!caller) {
    return NextResponse.json({ error: 'Ikke autorisert' }, { status: 401 });
  }

  try {
    const { userId, full_name, phone } = await req.json();

    if (!userId) {
      return NextResponse.json({ error: 'userId er påkrevd' }, { status: 400 });
    }

    const updates: Record<string, string | null> = {};
    if (full_name !== undefined) updates.full_name = full_name?.trim() || null;
    if (phone     !== undefined) updates.phone     = phone?.trim()     || null;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Ingen felter å oppdatere' }, { status: 400 });
    }

    const { error } = await adminDb
      .from('profiles')
      .update(updates)
      .eq('id', userId);

    if (error) {
      console.error('Update user error:', error);
      return NextResponse.json({ error: 'Kunne ikke oppdatere bruker' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Update user error:', err);
    return NextResponse.json({ error: 'Serverfeil' }, { status: 500 });
  }
}
