// app/api/kunnskapsbase/liknende/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { adminDb, requireAuth } from '@/lib/admin-api';
import { anonymiserSak } from '@/lib/anonymisering';
import { embed, prisspenn, kunnskapsbaseAktiv, type KunnskapsTreff } from '@/lib/kunnskapsbase';

export async function POST(req: NextRequest) {
  const caller = await requireAuth(req);
  if (!caller) return NextResponse.json({ error: 'Ikke autorisert' }, { status: 401 });
  if (!kunnskapsbaseAktiv()) return NextResponse.json({ aktiv: false, treff: [] });

  let payload: { caseId?: string };
  try { payload = await req.json(); } catch {
    return NextResponse.json({ error: 'Ugyldig forespørsel' }, { status: 400 });
  }
  const caseId = payload.caseId?.trim();
  if (!caseId) return NextResponse.json({ error: 'caseId er påkrevd' }, { status: 400 });

  const { data: sak, error } = await adminDb
    .from('cases')
    .select('id, description, customer_name, customer_email, customer_phone, reg_nr, company')
    .eq('id', caseId)
    .single();
  if (error || !sak?.description) {
    return NextResponse.json({ error: 'Sak ikke funnet eller mangler beskrivelse' }, { status: 404 });
  }

  // Anonymiser spørringen FØR den sendes til embedding-API-et.
  const { data: ansatte } = await adminDb.from('profiles').select('full_name');
  const kjenteNavn = [
    sak.customer_name, sak.customer_email, sak.customer_phone, sak.reg_nr, sak.company,
    ...(ansatte ?? []).map((a) => a.full_name),
  ];
  const anonym = anonymiserSak(sak.description, kjenteNavn);

  const queryVec = await embed(anonym);
  const { data: treff, error: matchError } = await adminDb.rpc('match_kunnskapsbase', {
    query_embedding: queryVec,
    match_count: 8,
    terskel: 0.35,
    ekskluder_ref: caseId,
  });
  if (matchError) {
    console.error('match_kunnskapsbase feilet:', matchError);
    return NextResponse.json({ error: 'Søket feilet — er migrasjonen kjørt?' }, { status: 503 });
  }

  const hits = (treff ?? []) as KunnskapsTreff[];
  return NextResponse.json({ aktiv: true, treff: hits, prisspenn: prisspenn(hits.map((t) => t.kostnad)) });
}
