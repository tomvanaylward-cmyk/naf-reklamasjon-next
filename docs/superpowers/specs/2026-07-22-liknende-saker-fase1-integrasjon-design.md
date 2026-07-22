# Design: «Liknende saker» Fase 1 — integrasjon i reklamasjonsappen

**Dato:** 2026-07-22
**Status:** Design godkjent (Tom valgte Flate A i visuell gjennomgang), klar for implementasjonsplan
**Bygger på:** `2026-05-25-liknende-saker-retrieval-design.md` (spiken, validert mot 287 ekte saker)

## Formål

Når en saksbehandler åpner en sak i `saksbehandling`, skal et panel automatisk vise de mest
liknende tidligere sakene med løsning, kostnad og prisspenn — uten at saksbehandleren gjør noe.
Dette er Flate A fra mockup-gjennomgangen; manuell søkeside (Flate B) er bevisst utsatt til
neste leveranse.

## Beslutninger (fra brainstorm 2026-07-22)

| Tema | Valg |
|---|---|
| Første flate | Automatisk panel i saksbildet (Flate A) |
| Vektorlagring | pgvector i eksisterende Supabase — ny tabell `kunnskapsbase` |
| Embeddings i prod | OpenAI `text-embedding-3-small` nå; bytte til Azure OpenAI senere er kun endepunkt/nøkkel |
| Legacy-import | Kjøres lokalt på Toms Mac (full NER), lastes opp ferdig anonymisert |
| Anonymisering av app-saker | Kjente-verdier-redaksjon (strukturerte PII-felter + profiles) + regex — IKKE NER i runtime |
| Feedback | 👍/👎 på panelet logges (grunnlag for ekspert-i-løkken senere) |
| Utsatt (YAGNI) | Flate B søkeside, LLM-tema, nightly re-prosessering, admin-flater |

## Hvorfor ikke NER i produksjon

Spikens NER-modell (~120 MB) kan ikke kjøre i Vercels serverless-funksjoner (kald-start/størrelse).
For appens egne saker er det heller ikke nødvendig: appen kjenner PII-en strukturert
(`customer_name`, `customer_email`, `customer_phone`, `reg_nr` på saken; ansattnavn i `profiles`).
Kjente-verdier-redaksjon er *sterkere* enn NER for denne kilden — vi vet fasiten.
NER beholdes i legacy-importen, som kjører lokalt.

**Restrisiko (dokumenteres til IT-sikkerhet):** tredjepersoners navn som kun nevnes i fritekst
(f.eks. «snakket med Kari hos leverandøren») fanges bare hvis regex/kjente verdier treffer.
Vurderes akseptabel for intern MVP; Azure OpenAI med DPA reduserer konsekvensen ytterligere.

## Datamodell — ny tabell `kunnskapsbase`

```sql
create extension if not exists vector;

create table kunnskapsbase (
  id uuid primary key default gen_random_uuid(),
  kilde text not null check (kilde in ('legacy', 'app')),
  kilde_ref text,                        -- app: cases.id; legacy: syntetisk 'sak-N'
  senter text,
  alvorlighet text,
  status text,
  tid_til_lukking_dager int,
  tema text,
  beskrivelse_anonymisert text not null,
  losning_anonymisert text,
  kostnad numeric,
  kostnad_kilde text check (kostnad_kilde in ('felt','tekst','llm')),
  embedding vector(1536) not null,       -- text-embedding-3-small
  created_at timestamptz default now()
);

create index on kunnskapsbase using hnsw (embedding vector_cosine_ops);
```

- RLS: SELECT for autentiserte staff-roller (`admin`, `overordnet`, `reklamasjonsansvarlig`,
  `senterleder`); INSERT/UPDATE/DELETE kun service-role (mønster fra `lib/admin-api.ts`).
- NB: legacy-korpuset i spiken har 384-dim (e5). Legacy-importen til prod **re-embeddes med
  OpenAI** (1536-dim) slik at hele basen er én modell. Kostnad: ~øre-nivå for 287 saker.

## Dataflyt

### A) Legacy-import (engangs, kjøres lokalt hos Tom)
1. Gjenbruk spikens pipeline (xlsx → anonymisering med regex + NER → beløp → tema-nøkkelord)
2. Embed med OpenAI (`text-embedding-3-small`) i stedet for lokal e5
3. Last opp til `kunnskapsbase` via service-role (upsert på `kilde_ref`)
4. GDPR-akseptanse gjentas mot tabellen: 0 PII-mønstre (samme sjekk som spiken)

### B) Ny app-sak lukkes → inn i kunnskapsbasen
1. Trigger: sak settes til `closed` i saksbehandlings-UI (samme kodeflyt som i dag)
2. `/api/kunnskapsbase/innlemme` (service-role): hent sakens beskrivelse + meldingshistorikkens
   løsningstekst, kjør kjente-verdier-redaksjon + regex, beregn kostnad (cost_actual > cost_estimated
   > regex på tekst), embed, insert
3. Feiler innlemming skal lukking IKKE blokkeres — logg feil som intern systemmelding på saken
   (eksisterende audit-mønster med `sender_name: '🔁 System'`)

### C) Panel i saksbildet
1. Saksbehandler åpner sak → klient kaller `/api/kunnskapsbase/liknende` med sakens id
2. Server (service-role): hent sakens beskrivelse, kjente-verdier-redaksjon + regex, embed spørringen,
   pgvector cosinus-søk (`<=>`), topp 8 over terskel, ekskluder saken selv (`kilde_ref != case.id`)
3. Panel viser topp 3 + «vis alle», prisspenn (median/min–maks), løsning per treff
4. 👍/👎 logges i enkel tabell `kunnskapsbase_feedback (case_id, nyttig boolean, created_at)`

## Gjenbruk fra spiken

- `lib/retrieval.ts` → prisspenn-logikk gjenbrukes; cosinus-søket erstattes av pgvector-spørring
- Regex-mønstrene fra `lib/anonymize.ts` → flyttes til hovedappens `lib/`
- UI-mønstre fra spike-siden → panelkomponent `components/LiknendeSaker.tsx`
- Spike-mappa `liknende-saker/` beholdes som lab (ikke slettes)

## Feilhåndtering

- OpenAI nede ved panel-oppslag → panelet viser «utilgjengelig», saksbildet fungerer som før
- OpenAI nede ved lukking → sak lukkes normalt, innlemming logges som feilet (kan re-kjøres)
- Tom terskel/ingen treff → «ingen sterkt liknende saker», aldri svake treff presentert som sterke
- Manglende `OPENAI_API_KEY` → panel skjules helt (feature-detektering, ikke krasj)

## Suksesskriterier

1. Saksbehandler åpner en sak → panel med relevante treff + prisspenn innen ~2 sekunder
2. `kunnskapsbase` inneholder 287 legacy-saker + nye lukkede saker, med 0 PII-mønstre (verifisert)
3. Lukking av sak fungerer selv når innlemming feiler
4. Restrisiko-notat klart til Torbjørn-dialogen
5. Ingen Vercel-spesifikke avhengigheter i forretningslogikken (Azure-portabilitet)

## Åpne punkter til implementasjonsstart

1. **Terskel for pgvector-cosinus med OpenAI-embeddings** må kalibreres på nytt (e5-terskelen er
   ugyldig). Startverdi settes empirisk mot legacy-korpuset i Task-løpet.
2. **Løsningstekst for app-saker:** appen har ikke eget «løsning»-felt — bruk siste agent-melding(er)
   før lukking som løsningskilde i MVP, og vurder eget felt som oppfølging.
3. **OpenAI-nøkkel:** Tom må opprette konto/nøkkel og legge den i Vercel env + lokal `.env.local`.
