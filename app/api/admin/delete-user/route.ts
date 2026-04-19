// app/api/admin/delete-user/route.ts
import { NextRequest, NextResponse } from 'next/server';
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

    if (userId === caller.userId) {
      return NextResponse.json({ error: 'Kan ikke slette deg selv' }, { status: 400 });
    }

    const { error } = await adminDb.auth.admin.deleteUser(userId);

    if (error) {
      console.error('Delete user error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Delete user error:', err);
    return NextResponse.json({ error: 'Serverfeil' }, { status: 500 });
  }
}
