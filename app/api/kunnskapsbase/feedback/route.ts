// app/api/kunnskapsbase/feedback/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { adminDb, requireAuth } from '@/lib/admin-api';

export async function POST(req: NextRequest) {
  const caller = await requireAuth(req);
  if (!caller) return NextResponse.json({ error: 'Ikke autorisert' }, { status: 401 });
  let payload: { caseId?: string; nyttig?: boolean };
  try { payload = await req.json(); } catch {
    return NextResponse.json({ error: 'Ugyldig forespørsel' }, { status: 400 });
  }
  if (!payload.caseId || typeof payload.nyttig !== 'boolean') {
    return NextResponse.json({ error: 'caseId og nyttig er påkrevd' }, { status: 400 });
  }
  const { error } = await adminDb.from('kunnskapsbase_feedback').insert({
    case_id: payload.caseId,
    nyttig: payload.nyttig,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
