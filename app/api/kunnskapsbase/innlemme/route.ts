// app/api/kunnskapsbase/innlemme/route.ts
//
// Kalles fire-and-forget fra klienten når en sak settes til 'closed'.
// Feiler dette skal lukkingen IKKE påvirkes — feil logges som intern
// systemmelding på saken (audit-mønsteret).
import { NextRequest, NextResponse } from 'next/server';
import { adminDb, requireAuth } from '@/lib/admin-api';
import { anonymiserSak } from '@/lib/anonymisering';
import { embed, belopFraTekst, kunnskapsbaseAktiv } from '@/lib/kunnskapsbase';

export async function POST(req: NextRequest) {
  const caller = await requireAuth(req);
  if (!caller) return NextResponse.json({ error: 'Ikke autorisert' }, { status: 401 });
  if (!kunnskapsbaseAktiv()) return NextResponse.json({ aktiv: false });

  let payload: { caseId?: string };
  try { payload = await req.json(); } catch {
    return NextResponse.json({ error: 'Ugyldig forespørsel' }, { status: 400 });
  }
  const caseId = payload.caseId?.trim();
  if (!caseId) return NextResponse.json({ error: 'caseId er påkrevd' }, { status: 400 });

  try {
    const { data: sak, error } = await adminDb
      .from('cases')
      .select('id, description, customer_name, customer_email, customer_phone, reg_nr, company, senter, priority, status, cost_estimated, cost_actual, category, created_at, updated_at')
      .eq('id', caseId)
      .single();
    if (error || !sak?.description) throw new Error('Sak ikke funnet eller mangler beskrivelse');

    // Løsningstekst: siste agent-meldinger før lukking (MVP-valg fra spec).
    const { data: meldinger } = await adminDb
      .from('messages')
      .select('type, content')
      .eq('case_id', caseId)
      .eq('type', 'agent')
      .order('created_at', { ascending: false })
      .limit(2);
    const losningRaa = (meldinger ?? []).map((m) => m.content).reverse().join(' — ') || null;

    const { data: ansatte } = await adminDb.from('profiles').select('full_name');
    const kjenteNavn = [
      sak.customer_name, sak.customer_email, sak.customer_phone, sak.reg_nr, sak.company,
      ...(ansatte ?? []).map((a) => a.full_name),
    ];
    const beskrivelse = anonymiserSak(sak.description, kjenteNavn);
    const losning = losningRaa ? anonymiserSak(losningRaa, kjenteNavn) : null;

    let kostnad: number | null = sak.cost_actual ?? sak.cost_estimated ?? null;
    let kostnadKilde: 'felt' | 'tekst' | null = kostnad ? 'felt' : null;
    if (!kostnad) {
      kostnad = belopFraTekst(beskrivelse) ?? (losning ? belopFraTekst(losning) : null);
      kostnadKilde = kostnad ? 'tekst' : null;
    }

    const dager = sak.updated_at && sak.created_at
      ? Math.round((new Date(sak.updated_at).getTime() - new Date(sak.created_at).getTime()) / 86400000)
      : null;

    const embedding = await embed(beskrivelse);
    const { error: upsertError } = await adminDb.from('kunnskapsbase').upsert({
      kilde: 'app',
      kilde_ref: sak.id,
      senter: sak.senter,
      alvorlighet: sak.priority,
      status: 'Lukket',
      tid_til_lukking_dager: dager,
      tema: sak.category,
      beskrivelse_anonymisert: beskrivelse,
      losning_anonymisert: losning,
      kostnad,
      kostnad_kilde: kostnadKilde,
      embedding,
    }, { onConflict: 'kilde_ref' });
    if (upsertError) throw new Error(upsertError.message);

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'ukjent feil';
    console.error('Innlemming feilet:', msg);
    // Audit-mønster: logg som intern systemmelding, best effort.
    await adminDb.from('messages').insert({
      case_id: caseId,
      type: 'internal',
      sender_name: '🔁 System',
      content: `Kunne ikke legge saken i kunnskapsbasen: ${msg}. Kan re-kjøres senere.`,
      created_at: new Date().toISOString(),
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
