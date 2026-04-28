// app/api/case-transfer/route.ts
//
// Flytter en sak til et annet senter.
//
// RLS på cases_update er senter-bevisst — det viste seg å skape et hjørne
// hvor senterleder ikke fikk skrive en oppdatering som endret cases.senter.
// I stedet for å bruke en mer permissiv WITH CHECK gjør vi flyttingen via
// service-role-klienten her, slik at RLS bypasses for selve UPDATE-en, og
// vi gjør autorisasjons-sjekken eksplisitt i app-laget.
//
// Audit-meldingen logges i samme transaksjon (best effort).

import { NextRequest, NextResponse } from 'next/server';
import { adminDb, requireAuth } from '@/lib/admin-api';
import { NAF_SENTRE } from '@/lib/sentre';

const ALLOWED_ROLES = new Set(['admin', 'overordnet', 'reklamasjonsansvarlig', 'senterleder']);

export async function POST(req: NextRequest) {
  const caller = await requireAuth(req);
  if (!caller || !ALLOWED_ROLES.has(caller.role)) {
    return NextResponse.json({ error: 'Ikke autorisert' }, { status: 401 });
  }

  let payload: { caseId?: string; toSenter?: string; reason?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Ugyldig forespørsel' }, { status: 400 });
  }

  const caseId   = payload.caseId?.trim();
  const toSenter = payload.toSenter?.trim();
  const reason   = (payload.reason ?? '').trim().slice(0, 500);

  if (!caseId || !toSenter) {
    return NextResponse.json({ error: 'caseId og toSenter er påkrevd' }, { status: 400 });
  }

  if (!(NAF_SENTRE as readonly string[]).includes(toSenter)) {
    return NextResponse.json({ error: 'Ukjent senter' }, { status: 400 });
  }

  // Hent saken via service-role for å sjekke nåværende eier og at saken finnes.
  const { data: existingCase, error: fetchError } = await adminDb
    .from('cases')
    .select('id, senter')
    .eq('id', caseId)
    .single();

  if (fetchError || !existingCase) {
    return NextResponse.json({ error: 'Sak ikke funnet' }, { status: 404 });
  }

  if (existingCase.senter === toSenter) {
    return NextResponse.json({ error: 'Saken er allerede på dette senteret' }, { status: 400 });
  }

  // Senterleder kan bare flytte saker fra eget senter.
  if (caller.role === 'senterleder' && existingCase.senter !== caller.senter) {
    return NextResponse.json({ error: 'Du kan kun flytte saker fra ditt eget senter' }, { status: 403 });
  }

  // Hent navn til actor for audit.
  const { data: actorProfile } = await adminDb
    .from('profiles')
    .select('full_name, email')
    .eq('id', caller.userId)
    .single();
  const actor = actorProfile?.full_name || actorProfile?.email || 'Ukjent';

  // Oppdater senter via service-role (bypasser RLS).
  const { error: updateError } = await adminDb
    .from('cases')
    .update({ senter: toSenter, updated_at: new Date().toISOString() })
    .eq('id', caseId);

  if (updateError) {
    console.error('Case transfer update error:', updateError);
    return NextResponse.json({ error: `Kunne ikke flytte saken: ${updateError.message}` }, { status: 500 });
  }

  // Skriv audit-melding (best effort — feiler ikke hele kallet hvis loggen feiler).
  const auditContent = reason
    ? `Saken ble flyttet fra ${existingCase.senter || '–'} til ${toSenter} av ${actor}. Begrunnelse: ${reason}`
    : `Saken ble flyttet fra ${existingCase.senter || '–'} til ${toSenter} av ${actor}.`;

  const { error: msgError } = await adminDb.from('messages').insert({
    case_id:     caseId,
    type:        'internal',
    sender_name: '🔁 System',
    content:     auditContent,
    created_at:  new Date().toISOString(),
  });

  if (msgError) {
    console.error('Audit message insert failed:', msgError);
  }

  return NextResponse.json({ ok: true, fromSenter: existingCase.senter, toSenter });
}
