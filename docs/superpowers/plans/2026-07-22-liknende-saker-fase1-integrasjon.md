# «Liknende saker» Fase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatisk «Liknende saker»-panel i saksbildet i hovedappen, drevet av pgvector i Supabase og OpenAI-embeddings, med kunnskapsbase som fylles fra legacy-import og hver sak som lukkes.

**Architecture:** Ny tabell `kunnskapsbase` (pgvector, 1536-dim) + SQL-funksjon `match_kunnskapsbase` for cosinus-søk. To API-ruter etter `case-transfer`-mønsteret (requireAuth + adminDb): `liknende` (panel-oppslag) og `innlemme` (sak lukkes → inn i basen). Anonymisering i runtime = kjente-verdier-redaksjon (strukturerte PII-felter + profiles) + regex-mønstrene fra spiken. NER kjøres KUN i lokal legacy-opplasting. Panelet er en klientkomponent som erstatter dagens `similarCases`-visning i `app/saksbehandling/page.tsx`.

**Tech Stack:** Next.js 15 (eksisterende app), Supabase + pgvector, OpenAI `text-embedding-3-small` (lazy klient), vitest (nytt i hovedappen, kun for ren logikk), Tailwind (matcher appens stil).

**Viktige eksisterende mønstre (les før du koder):**
- `lib/admin-api.ts` — `adminDb` (service-role) + `requireAuth`
- `app/api/case-transfer/route.ts` — API-rute-mønsteret (auth, validering, audit-melding med `sender_name: '🔁 System'`)
- `app/saksbehandling/page.tsx:163` — `updateField` (hook-punkt for lukking), `:187-206` — klientens Bearer-token-mønster, `:442-444` — `similarCases` som skal erstattes, `:691` — der den rendres
- `liknende-saker/lib/anonymize.ts` — regex-mønstrene som porteres
- `liknende-saker/lib/retrieval.ts` — `prisspenn`-logikken som porteres

---

## Task 1: DB-migrasjon — kunnskapsbase + pgvector

**Files:**
- Create: `docs/migrations/2026-07-22-kunnskapsbase-pgvector.sql`

- [ ] **Step 1: Skriv migrasjonen** (idempotent, kjøres manuelt av Tom i Supabase SQL Editor):

```sql
-- Migrasjon: kunnskapsbase for «liknende saker» (Fase 1)
-- Krever: pgvector-utvidelsen (tilgjengelig i Supabase som 'vector')

BEGIN;

create extension if not exists vector;

create table if not exists kunnskapsbase (
  id uuid primary key default gen_random_uuid(),
  kilde text not null check (kilde in ('legacy', 'app')),
  kilde_ref text unique,
  senter text,
  alvorlighet text,
  status text,
  tid_til_lukking_dager int,
  tema text,
  beskrivelse_anonymisert text not null,
  losning_anonymisert text,
  kostnad numeric,
  kostnad_kilde text check (kostnad_kilde in ('felt','tekst','llm')),
  embedding vector(1536) not null,
  created_at timestamptz default now()
);

create index if not exists kunnskapsbase_embedding_idx
  on kunnskapsbase using hnsw (embedding vector_cosine_ops);

create table if not exists kunnskapsbase_feedback (
  id uuid primary key default gen_random_uuid(),
  case_id uuid,
  nyttig boolean not null,
  created_at timestamptz default now()
);

-- RLS: lesing for innloggede staff-roller, skriving kun via service-role
alter table kunnskapsbase enable row level security;
alter table kunnskapsbase_feedback enable row level security;

drop policy if exists kunnskapsbase_select on kunnskapsbase;
create policy kunnskapsbase_select on kunnskapsbase for select
  to authenticated
  using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and p.role in ('admin','overordnet','reklamasjonsansvarlig','senterleder')
    )
  );
-- Ingen insert/update/delete-policy: kun service-role (bypasser RLS) kan skrive.
-- kunnskapsbase_feedback: ingen policies — kun service-role leser/skriver.

-- Cosinus-søk. SECURITY INVOKER (default): kalles kun fra service-role i API-laget.
create or replace function match_kunnskapsbase(
  query_embedding vector(1536),
  match_count int default 8,
  terskel float default 0.35,
  ekskluder_ref text default null
)
returns table (
  id uuid, kilde text, kilde_ref text, senter text, alvorlighet text,
  status text, tid_til_lukking_dager int, tema text,
  beskrivelse_anonymisert text, losning_anonymisert text,
  kostnad numeric, kostnad_kilde text, likhet float
)
language sql stable as $$
  select
    k.id, k.kilde, k.kilde_ref, k.senter, k.alvorlighet, k.status,
    k.tid_til_lukking_dager, k.tema, k.beskrivelse_anonymisert,
    k.losning_anonymisert, k.kostnad, k.kostnad_kilde,
    1 - (k.embedding <=> query_embedding) as likhet
  from kunnskapsbase k
  where (ekskluder_ref is null or k.kilde_ref is distinct from ekskluder_ref)
    and 1 - (k.embedding <=> query_embedding) >= terskel
  order by k.embedding <=> query_embedding
  limit match_count;
$$;

COMMIT;

-- Verifiser:
-- SELECT count(*) FROM kunnskapsbase;                          -- 0 (tom, men finnes)
-- SELECT proname FROM pg_proc WHERE proname = 'match_kunnskapsbase';  -- én rad
```

- [ ] **Step 2: Commit**

```bash
git add docs/migrations/2026-07-22-kunnskapsbase-pgvector.sql
git commit -m "feat: migrasjon for kunnskapsbase med pgvector og match-funksjon"
```

**NB:** Migrasjonen kjøres av Tom manuelt — koden i senere tasks skal feile mykt til den er kjørt.

---

## Task 2: Anonymisering i hovedappen (TDD)

**Files:**
- Create: `lib/anonymisering.ts`, `lib/anonymisering.test.ts`, `vitest.config.ts` (repo-rot)
- Modify: `package.json` (legg til vitest + test-script)

- [ ] **Step 1: Legg vitest til hovedappen**

```bash
npm install --save-dev vitest
```

Opprett `vitest.config.ts` i repo-rot:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['lib/**/*.test.ts'] } });
```

Legg til i `package.json` scripts: `"test": "vitest run"`.

- [ ] **Step 2: Skriv failing test** `lib/anonymisering.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { redactPatterns, redactKnownValues, anonymiserSak } from './anonymisering';

describe('redactPatterns', () => {
  it('fjerner e-post, tlf, regnr, fnr, orgnr', () => {
    expect(redactPatterns('kontakt ola@naf.no eller 912 34 567 om EL12345'))
      .toBe('kontakt [E-POST] eller [TLF] om [REGNR]');
    expect(redactPatterns('fnr 01018012345 orgnr 912345678')).toBe('fnr [FNR] orgnr [ORGNR]');
  });
  it('beholder beløp', () => {
    expect(redactPatterns('kompensert 4 300 kr')).toBe('kompensert 4 300 kr');
  });
});

describe('redactKnownValues', () => {
  it('fjerner kjente navn case-insensitivt', () => {
    const ut = redactKnownValues('Kari Nordmann ringte. kari nordmann var misfornøyd.', ['Kari Nordmann']);
    expect(ut).toBe('[NAVN] ringte. [NAVN] var misfornøyd.');
  });
  it('tåler null/tomme verdier og korte strenger', () => {
    expect(redactKnownValues('tekst uten treff', ['', '  ', 'ab'])).toBe('tekst uten treff');
  });
  it('escaper regex-spesialtegn i verdier', () => {
    expect(redactKnownValues('se sak (VIP) her', ['(VIP)'])).toBe('se sak [NAVN] her');
  });
});

describe('anonymiserSak', () => {
  it('kombinerer kjente verdier og mønstre', () => {
    const ut = anonymiserSak('Ola Hansen (ola@naf.no) klager på EL12345', ['Ola Hansen']);
    expect(ut).toBe('[NAVN] ([E-POST]) klager på [REGNR]');
  });
});
```

- [ ] **Step 3: Kjør test, verifiser FAIL** — `npx vitest run lib/anonymisering.test.ts`

- [ ] **Step 4: Implementer** `lib/anonymisering.ts`:

```ts
// lib/anonymisering.ts
//
// Runtime-anonymisering for kunnskapsbasen. For appens egne saker kjenner vi
// PII-en strukturert (customer_name, customer_email, customer_phone, reg_nr
// på saken; ansattnavn i profiles) — kjente-verdier-redaksjon er derfor
// sterkere enn NER her. Regex-mønstrene (portert fra spiken) er sikkerhetsnett.
// NER kjøres kun i den lokale legacy-importen (liknende-saker/).

export function redactPatterns(text: string): string {
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[E-POST]')
    .replace(/\b\d{11}\b/g, '[FNR]')
    .replace(/\b\d{9}\b/g, '[ORGNR]')
    .replace(/\b[A-Z]{2}\s?\d{5}\b/g, '[REGNR]')
    .replace(/(\+47\s?)?\b\d{3}\s?\d{2}\s?\d{3}\b/g, '[TLF]');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Erstatter alle forekomster av kjente verdier (kundenavn, ansattnavn, …)
 * med [NAVN], case-insensitivt. Verdier under 3 tegn ignoreres (støy).
 */
export function redactKnownValues(text: string, values: (string | null | undefined)[]): string {
  let out = text;
  for (const v of values) {
    const trimmed = (v ?? '').trim();
    if (trimmed.length < 3) continue;
    out = out.replace(new RegExp(escapeRegex(trimmed), 'gi'), '[NAVN]');
  }
  return out;
}

/** Full runtime-anonymisering: kjente verdier først, deretter mønstre. */
export function anonymiserSak(text: string, kjenteNavn: (string | null | undefined)[]): string {
  return redactPatterns(redactKnownValues(text, kjenteNavn));
}
```

- [ ] **Step 5: Kjør test, verifiser PASS** — `npx vitest run lib/anonymisering.test.ts` (6 tester)

- [ ] **Step 6: Verifiser at hovedappen fortsatt bygger** — `npm run build`

- [ ] **Step 7: Commit**

```bash
git add lib/anonymisering.ts lib/anonymisering.test.ts vitest.config.ts package.json package-lock.json
git commit -m "feat: runtime-anonymisering med kjente-verdier-redaksjon og regex"
```

---

## Task 3: Kunnskapsbase-hjelpere (embeddings + prisspenn + typer)

**Files:**
- Create: `lib/kunnskapsbase.ts`, `lib/kunnskapsbase.test.ts`

- [ ] **Step 1: Failing test** `lib/kunnskapsbase.test.ts` (kun prisspenn — embed krever nøkkel):

```ts
import { describe, it, expect } from 'vitest';
import { prisspenn } from './kunnskapsbase';

describe('prisspenn', () => {
  it('median/min/max/antall', () => {
    expect(prisspenn([1800, 4300, 14500])).toEqual({ median: 4300, min: 1800, max: 14500, antall: 3 });
  });
  it('ignorerer null', () => {
    expect(prisspenn([null, 5000])).toEqual({ median: 5000, min: 5000, max: 5000, antall: 1 });
  });
  it('antall 0 uten kostnader', () => {
    expect(prisspenn([null]).antall).toBe(0);
  });
});
```

- [ ] **Step 2: Kjør, verifiser FAIL**, så implementer `lib/kunnskapsbase.ts`:

```ts
// lib/kunnskapsbase.ts
import OpenAI from 'openai';

export interface KunnskapsTreff {
  id: string;
  kilde: 'legacy' | 'app';
  kilde_ref: string | null;
  senter: string | null;
  alvorlighet: string | null;
  status: string | null;
  tid_til_lukking_dager: number | null;
  tema: string | null;
  beskrivelse_anonymisert: string;
  losning_anonymisert: string | null;
  kostnad: number | null;
  kostnad_kilde: 'felt' | 'tekst' | 'llm' | null;
  likhet: number;
}

export interface Prisspenn { median: number; min: number; max: number; antall: number; }

export function prisspenn(kostnader: (number | null)[]): Prisspenn {
  const tall = kostnader.filter((k): k is number => k !== null).sort((a, b) => a - b);
  if (tall.length === 0) return { median: 0, min: 0, max: 0, antall: 0 };
  const mid = Math.floor(tall.length / 2);
  const median = tall.length % 2 ? tall[mid] : Math.round((tall[mid - 1] + tall[mid]) / 2);
  return { median, min: tall[0], max: tall[tall.length - 1], antall: tall.length };
}

export function kunnskapsbaseAktiv(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

// Lazy singleton — modulnivå-konstruksjon knekker next build uten nøkkel.
let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

export const EMBEDDING_MODEL = 'text-embedding-3-small';

export async function embed(text: string): Promise<number[]> {
  const res = await getClient().embeddings.create({ model: EMBEDDING_MODEL, input: text });
  return res.data[0].embedding;
}

/** Beløp fra fritekst (portert fra spiken) — brukes når kostnadsfeltene er tomme. */
export function belopFraTekst(text: string): number | null {
  const m = text.match(/(?:kr\.?\s*)?(\d{1,3}(?:[ .]\d{3})+|\d{3,6})(?:,-|\s*kr)?/i);
  if (!m) return null;
  const n = parseInt(m[1].replace(/[ .]/g, ''), 10);
  return Number.isFinite(n) && n >= 100 ? n : null;
}
```

- [ ] **Step 3: Kjør alle tester + build** — `npx vitest run` (9 tester totalt) og `npm run build`

- [ ] **Step 4: Installer openai i hovedappen**

```bash
npm install openai
```

- [ ] **Step 5: Commit**

```bash
git add lib/kunnskapsbase.ts lib/kunnskapsbase.test.ts package.json package-lock.json
git commit -m "feat: kunnskapsbase-hjelpere — embeddings, prisspenn, beløp"
```

---

## Task 4: Legacy-opplasting (kjøres lokalt)

**Files:**
- Create: `liknende-saker/scripts/last-opp-supabase.ts`
- Modify: `liknende-saker/package.json` (nytt script `"last-opp": "tsx scripts/last-opp-supabase.ts"`)

Gjenbruker spikens ferdig-anonymiserte `data/korpus.json` (tekstene er allerede NER-vasket) —
men re-embedder med OpenAI (1536-dim) slik at hele basen er én modell.

- [ ] **Step 1: Skriv scriptet:**

```ts
// liknende-saker/scripts/last-opp-supabase.ts
//
// Leser spikens anonymiserte korpus.json, re-embedder med OpenAI (1536-dim)
// og upserter til kunnskapsbase i Supabase. Kjøres lokalt:
//   OPENAI_API_KEY=... NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run last-opp
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface SpikeSak {
  id: string; senter: string; alvorlighet: string; status: string;
  tid_til_lukking_dager: number | null; tema: string;
  beskrivelse_anonymisert: string; losning_anonymisert: string | null;
  kostnad: number | null; kostnad_kilde: string | null;
}

async function main() {
  const korpus: SpikeSak[] = JSON.parse(readFileSync('data/korpus.json', 'utf-8'));
  console.log(`Laster opp ${korpus.length} legacy-saker…`);
  let ok = 0;
  for (const sak of korpus) {
    const res = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: sak.beskrivelse_anonymisert,
    });
    const { error } = await supabase.from('kunnskapsbase').upsert({
      kilde: 'legacy',
      kilde_ref: `legacy-${sak.id}`,
      senter: sak.senter,
      alvorlighet: sak.alvorlighet,
      status: sak.status,
      tid_til_lukking_dager: sak.tid_til_lukking_dager,
      tema: sak.tema,
      beskrivelse_anonymisert: sak.beskrivelse_anonymisert,
      losning_anonymisert: sak.losning_anonymisert,
      kostnad: sak.kostnad,
      kostnad_kilde: sak.kostnad_kilde,
      embedding: res.data[0].embedding,
    }, { onConflict: 'kilde_ref' });
    if (error) throw new Error(`Feil på ${sak.id}: ${error.message}`);
    ok++;
    if (ok % 25 === 0) console.log(`${ok}/${korpus.length}…`);
  }
  console.log(`Ferdig: ${ok} saker lastet opp.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: `npm install @supabase/supabase-js` i `liknende-saker/`** og typecheck: `npx tsc --noEmit`

- [ ] **Step 3: Commit** (selve kjøringen skjer i Task 8 når nøkkel + migrasjon er klare)

```bash
git add liknende-saker/scripts/last-opp-supabase.ts liknende-saker/package.json liknende-saker/package-lock.json
git commit -m "feat: opplastingsscript legacy-korpus til kunnskapsbase"
```

---

## Task 5: API — `/api/kunnskapsbase/liknende` og `/feedback`

**Files:**
- Create: `app/api/kunnskapsbase/liknende/route.ts`, `app/api/kunnskapsbase/feedback/route.ts`

- [ ] **Step 1: liknende-ruten** (mønster: `case-transfer`):

```ts
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
```

- [ ] **Step 2: feedback-ruten:**

```ts
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
```

- [ ] **Step 3: Verifiser** — `npx tsc --noEmit && npm run build && npx vitest run`

- [ ] **Step 4: Commit**

```bash
git add app/api/kunnskapsbase/
git commit -m "feat: API for liknende saker-oppslag og feedback"
```

---

## Task 6: API — `/api/kunnskapsbase/innlemme` (sak lukkes → inn i basen)

**Files:**
- Create: `app/api/kunnskapsbase/innlemme/route.ts`

- [ ] **Step 1: Implementer:**

```ts
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
```

- [ ] **Step 2: Verifiser** — `npx tsc --noEmit && npm run build`

- [ ] **Step 3: Commit**

```bash
git add app/api/kunnskapsbase/innlemme/
git commit -m "feat: lukkede saker innlemmes anonymisert i kunnskapsbasen"
```

---

## Task 7: Panelkomponent `LiknendeSaker`

**Files:**
- Create: `components/LiknendeSaker.tsx`

- [ ] **Step 1: Implementer** (Tailwind i appens stil — se `components/SLABox.tsx` for tone):

```tsx
'use client';
import { useEffect, useState } from 'react';
import { db } from '@/lib/supabase';
import type { KunnskapsTreff, Prisspenn } from '@/lib/kunnskapsbase';

export default function LiknendeSaker({ caseId }: { caseId: string }) {
  const [treff, setTreff] = useState<KunnskapsTreff[]>([]);
  const [spenn, setSpenn] = useState<Prisspenn | null>(null);
  const [tilstand, setTilstand] = useState<'laster' | 'klar' | 'skjult' | 'feil'>('laster');
  const [visAlle, setVisAlle] = useState(false);
  const [feedbackGitt, setFeedbackGitt] = useState(false);

  useEffect(() => {
    let avbrutt = false;
    (async () => {
      setTilstand('laster'); setVisAlle(false); setFeedbackGitt(false);
      const { data: { session } } = await db.auth.getSession();
      if (!session) { setTilstand('skjult'); return; }
      try {
        const res = await fetch('/api/kunnskapsbase/liknende', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ caseId }),
        });
        const data = await res.json();
        if (avbrutt) return;
        if (!res.ok || data.aktiv === false) { setTilstand('skjult'); return; }
        setTreff(data.treff ?? []);
        setSpenn(data.prisspenn ?? null);
        setTilstand('klar');
      } catch { if (!avbrutt) setTilstand('feil'); }
    })();
    return () => { avbrutt = true; };
  }, [caseId]);

  async function giFeedback(nyttig: boolean) {
    setFeedbackGitt(true);
    const { data: { session } } = await db.auth.getSession();
    if (!session) return;
    fetch('/api/kunnskapsbase/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ caseId, nyttig }),
    }).catch(() => {});
  }

  if (tilstand === 'skjult') return null;

  return (
    <div className="bg-indigo-50/60 border border-indigo-200 rounded-xl p-3">
      <div className="text-[11px] font-bold uppercase tracking-wider text-indigo-900 mb-2">
        🔎 Liknende saker
      </div>

      {tilstand === 'laster' && <div className="text-[12px] text-gray-500">Søker…</div>}
      {tilstand === 'feil' && <div className="text-[12px] text-gray-500">Utilgjengelig akkurat nå.</div>}

      {tilstand === 'klar' && treff.length === 0 && (
        <div className="text-[12px] text-gray-500">Ingen sterkt liknende saker.</div>
      )}

      {tilstand === 'klar' && treff.length > 0 && (
        <>
          {spenn && spenn.antall > 0 && (
            <div className="bg-indigo-100 rounded-lg px-2.5 py-1.5 text-[12px] text-indigo-900 mb-2">
              <strong>Prisspenn:</strong> median {spenn.median.toLocaleString('nb-NO')} kr ·{' '}
              {spenn.min.toLocaleString('nb-NO')}–{spenn.max.toLocaleString('nb-NO')} kr · {spenn.antall} treff
            </div>
          )}
          {(visAlle ? treff : treff.slice(0, 3)).map((t) => (
            <div key={t.id} className="bg-white border border-gray-200 rounded-lg p-2.5 mb-1.5 text-[12px]">
              <div className="flex items-center justify-between gap-2 text-gray-500 mb-1">
                <span className="bg-emerald-500 text-white px-1.5 py-0.5 rounded-full text-[11px] font-semibold">
                  {Math.round(t.likhet * 100)}%
                </span>
                <span className="truncate">
                  {[t.tema, t.senter, t.tid_til_lukking_dager != null ? `${t.tid_til_lukking_dager} d` : null]
                    .filter(Boolean).join(' · ')}
                </span>
              </div>
              <p className="text-gray-800 line-clamp-2 m-0">{t.beskrivelse_anonymisert}</p>
              {t.losning_anonymisert && (
                <p className="text-gray-600 m-0 mt-1"><strong>Løsning:</strong> <span className="line-clamp-2">{t.losning_anonymisert}</span></p>
              )}
              <div className="text-gray-500 mt-1">
                <strong>Kostnad:</strong>{' '}
                {t.kostnad != null ? `${Number(t.kostnad).toLocaleString('nb-NO')} kr` : 'ikke oppgitt'}
              </div>
            </div>
          ))}
          {treff.length > 3 && (
            <button onClick={() => setVisAlle((v) => !v)}
              className="text-[12px] text-indigo-700 hover:underline cursor-pointer bg-transparent border-0 p-0">
              {visAlle ? 'Vis færre' : `Vis alle ${treff.length} treff`}
            </button>
          )}
          <div className="flex items-center gap-1.5 mt-2 text-[11px] text-gray-400">
            {feedbackGitt ? 'Takk for tilbakemeldingen!' : (
              <>Hjalp dette?
                <button onClick={() => giFeedback(true)} className="cursor-pointer bg-white border border-gray-200 rounded px-1.5 hover:border-emerald-400">👍</button>
                <button onClick={() => giFeedback(false)} className="cursor-pointer bg-white border border-gray-200 rounded px-1.5 hover:border-red-300">👎</button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verifiser** — `npx tsc --noEmit && npm run build`

- [ ] **Step 3: Commit**

```bash
git add components/LiknendeSaker.tsx
git commit -m "feat: LiknendeSaker-panelkomponent med prisspenn og feedback"
```

---

## Task 8: Koble inn i saksbildet + lukke-trigger

**Files:**
- Modify: `app/saksbehandling/page.tsx` (linje ~163 `updateField`, ~442 `similarCases`, ~691 render)

- [ ] **Step 1: Finn hvor `similarCases` rendres** (`grep -n "similarCases" app/saksbehandling/page.tsx`, prop på komponent ved ~691). Erstatt den gamle kategori-baserte visningen med `<LiknendeSaker caseId={activeCase.id} />`. Fjern `similarCases`-beregningen (linje 442–444) og prop-en fra mottakerkomponenten hvis den ikke brukes andre steder — sjekk mottakerkomponentens bruk før sletting; ellers behold prop-en som død og noter det.

- [ ] **Step 2: Lukke-trigger i `updateField`** — utvid funksjonen (linje 163):

```ts
  async function updateField(field: keyof Case, value: string | null) {
    if (!activeCase) return;
    await db.from('cases').update({ [field]: value, updated_at: new Date().toISOString() }).eq('id', activeCase.id);
    setActiveCase(prev => prev ? { ...prev, [field]: value } : prev);
    setAllCases(prev => prev.map(c => c.id === activeCase.id ? { ...c, [field]: value } : c));

    // Sak lukket → legg den (anonymisert) i kunnskapsbasen. Fire-and-forget:
    // feiler dette skal lukkingen ikke påvirkes (API-et logger feilen på saken).
    if (field === 'status' && value === 'closed') {
      const { data: { session } } = await db.auth.getSession();
      if (session) {
        fetch('/api/kunnskapsbase/innlemme', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ caseId: activeCase.id }),
        }).catch(() => {});
      }
    }
  }
```

- [ ] **Step 3: Importer komponenten** øverst i filen: `import LiknendeSaker from '@/components/LiknendeSaker';`

- [ ] **Step 4: Verifiser** — `npx tsc --noEmit && npm run build && npx vitest run`

- [ ] **Step 5: Commit**

```bash
git add app/saksbehandling/page.tsx
git commit -m "feat: liknende saker-panel i saksbildet, lukkede saker innlemmes"
```

---

## Task 9: Akseptanse (delvis Tom-avhengig)

**Forutsetninger (Tom):** (1) OpenAI-nøkkel opprettet; `OPENAI_API_KEY` i `.env.local` (repo-rot)
og i Vercel env. (2) Migrasjonen fra Task 1 kjørt i Supabase SQL Editor.

- [ ] **Step 1: Last opp legacy-korpus** (lokalt):

```bash
cd liknende-saker && set -a && source ../.env.local && set +a && npm run last-opp
```
Forventet: `Ferdig: 287 saker lastet opp.`

- [ ] **Step 2: GDPR-akseptanse mot tabellen** — kjør i Supabase SQL Editor:

```sql
select count(*) as pii_treff from kunnskapsbase
where beskrivelse_anonymisert ~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
   or beskrivelse_anonymisert ~ '\y[A-Z]{2} ?\d{5}\y'
   or beskrivelse_anonymisert ~ '\y\d{9,11}\y';
```
Forventet: `pii_treff = 0`.

- [ ] **Step 3: Manuell smoke-test lokalt** — `npm run dev`, åpne en sak i saksbehandling,
verifiser: panel vises med treff + prisspenn innen ~2 s, «vis alle» fungerer, 👍 gir «Takk».
Lukk en testsak → verifiser ny rad i `kunnskapsbase` med `kilde='app'` og at beskrivelse/løsning
er anonymisert (sjekk raden i Supabase).

- [ ] **Step 4: Terskel-kalibrering** — prøv 3–5 realistiske beskrivelser; hvis panelet viser
irrelevante treff, juster `terskel` i `liknende/route.ts` (0.35 → 0.4/0.45) til svake treff kuttes.

- [ ] **Step 5: Deploy** — `git push` (Vercel deployer), gjenta smoke-test i prod.

- [ ] **Step 6: Commit ev. kalibreringsjusteringer og oppdater SECURITY.md** med kunnskapsbase +
restrisiko-avsnittet (tredjepersoners navn i fritekst) til Torbjørn-dialogen.

```bash
git add -A && git commit -m "chore: terskel-kalibrering og SECURITY.md for kunnskapsbasen"
```

---

## Self-Review

**Spec-dekning:** pgvector-tabell + RLS (Task 1) ✅ · OpenAI lazy-klient (Task 3) ✅ · legacy
re-embed 1536 + lokal kjøring (Task 4) ✅ · kjente-verdier-redaksjon før embedding, både oppslag
og innlemming (Task 2, 5, 6) ✅ · panel topp 3 + vis alle + prisspenn + 👍/👎 (Task 7) ✅ ·
lukking blokkeres aldri av innlemming (Task 6 catch + Task 8 fire-and-forget) ✅ · feature-
detektering uten nøkkel (`kunnskapsbaseAktiv`, panel returnerer null) ✅ · terskel-kalibrering
(Task 9 Step 4, spec åpent punkt 1) ✅ · løsning fra agent-meldinger (Task 6, spec åpent punkt 2)
✅ · SECURITY.md/restrisiko (Task 9 Step 6) ✅

**Placeholder-skann:** ingen TBD/TODO; all kode komplett. Task 8 Step 1 krever et oppslag
(grep) i stor fil — bevisst, med eksakt kommando og fallback-instruks.

**Type-konsistens:** `KunnskapsTreff`/`Prisspenn` definert i Task 3, brukt i Task 5/7.
`anonymiserSak(text, kjenteNavn)` samme signatur i Task 2/5/6. `match_kunnskapsbase`-parametre
(Task 1) matcher rpc-kallet (Task 5). `embed()` uten kind-parameter — OpenAI trenger ikke
query/passage-prefiks (det var e5-spesifikt).
