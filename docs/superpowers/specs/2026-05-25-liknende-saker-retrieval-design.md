# Design: «Liknende saker» — retrieval-verktøy for reklamasjoner

**Dato:** 2026-05-25
**Status:** Design godkjent, klar for implementasjonsplan
**Eier:** Tom Aylward

## Formål

Når en saksbehandler får en ny reklamasjon, skal verktøyet vise de mest liknende tidligere sakene — med løsning, kostnad og et foreslått prisspenn — slik at vurdering og prising blir raskere og mer konsistent på tvers av de 44 NAF-sentrene.

Bygger på YTD-analysen (juni 2026, 287 saker fra legacy avvikslogg). Analysen konkluderte: **retrieval (semantisk søk), ikke prediksjonsmodell** — 287 rader er for lite for pålitelig prediksjon, og retrieval er mer transparent og blir bedre per ny sak.

## Avgrensning

- **Fase 1 (denne spec-en):** frittstående retrieval-spike for å validere kvaliteten på de 287 sakene. Ikke integrert i reklamasjons-appen ennå.
- **Senere (egen spec):** integrasjon i `naf-reklamasjon-next`, og kobling mot Pakke C (benchmarking).
- Kjernen `lib/retrieval.ts` skrives portabelt slik at den kan løftes rett inn i appen.

## Beslutninger

| Tema | Valg |
|---|---|
| Teknikk | Semantisk søk (embeddings + cosinus), ikke prediksjon |
| Plassering | Frittstående Next.js-app først, integreres senere |
| Korpus-kilde | Periodisk re-import av xlsx → `korpus.json` |
| Vektorlagring | Flat fil (`korpus.json`), in-memory cosinus — 287 saker trenger ingen vektor-DB |
| Embeddings | OpenAI `text-embedding-3` (portabel til Azure OpenAI senere) |
| Generering/uttrekk | Anthropic, via `lib/llm.ts`-abstraksjon |
| Beløp-uttrekk | Regex først, LLM-fallback (åpent punkt — se under) |
| Navngjenkjenning | Lokal/offline NER — rå PII forlater aldri maskinen |
| Personvern | Anonymisering ved import, før lagring og før eksterne API-kall |

## Arkitektur

```
liknende-saker-spike/  (frittstående Next.js)
├── data/
│   ├── kilde.xlsx              # legacy-eksporten (287 saker), gitignored
│   └── korpus.json             # generert: anonymiserte saker + embeddings
├── scripts/import.ts           # xlsx → korpus.json (kjøres ved behov)
├── lib/
│   ├── anonymize.ts            # regex + lokal NER → redigert tekst
│   ├── llm.ts                  # Anthropic-abstraksjon (beløp/tema)
│   ├── embeddings.ts           # OpenAI text-embedding-3
│   └── retrieval.ts            # cosinus-søk + filter — PORTABEL til appen
└── app/page.tsx                # søke-UI
```

## Dataflyt — import (kjøres sjelden)

1. Les xlsx (287 rader), valider forventede kolonner — feil høylytt ved kolonnedrift.
2. **Dropp strukturerte PII-kolonner helt:** kundenavn, e-post, telefon, reg.nr, ordrenr, firma kommer aldri inn i korpuset.
3. **Anonymiser fritekst** (`anonymize.ts`):
   - Regex (deterministisk, offline): e-post, norske telefonnr, reg.nr/bilskilt (`AB 12345`), org.nr, fødselsnr → `[E-POST]`, `[TLF]`, `[REGNR]`, `[ORGNR]`, `[FNR]`.
   - Lokal NER (offline norsk modell): personnavn → `[NAVN]`.
   - Beløp beholdes (ikke PII).
4. **Beløp-uttrekk:** regex på redigert tekst → LLM-fallback hvis tom → bruk kostnadsfelt hvis utfylt. Lagre `kostnad` + `kostnad_kilde` ∈ {felt, tekst, llm}.
5. **Tema-klassifisering** (LLM): {dekk/felg/hjul, service, PKK/EU-kontroll, lakk/karosseri, faktura/pris, annet}.
6. **Embedding** (OpenAI) på redigert tekst, cachet på innholds-hash — re-import re-embedder ikke uendrede saker.
7. Skriv `korpus.json` — **null direkte identifikatorer**.

## Dataflyt — søk (interaktivt)

1. Saksbehandler limer inn ny beskrivelse + valgfritt filter (senter, alvorlighet).
2. Embed spørringen (OpenAI).
3. Cosinus mot alle korpus-embeddings, sorter synkende.
4. Filtrer på senter/alvorlighet hvis valgt, ta topp 5–10.
5. Vis per treff: likhet-%, tema, alvorlighet, status, tid-til-lukking, anonymisert utdrag, kostnad + kilde-merking.
6. **Prisspenn:** aggreger kostnad fra treffene → median + min–maks + antall treff.
7. Ingen treff over likhetsterskel → vis «ingen sterkt liknende saker» heller enn å tvinge svake treff.

## Datamodell — `korpus.json` (per sak)

```ts
{
  id: string;                 // syntetisk, ikke legacy-saksnr hvis det er identifiserende
  senter: string;             // én av de 44
  alvorlighet: 'Lav' | 'Middels' | 'Høy';
  status: string;             // åpen / lukket
  tid_til_lukking_dager: number | null;
  tema: string;               // klassifisert kategori
  beskrivelse_anonymisert: string;
  kostnad: number | null;
  kostnad_kilde: 'felt' | 'tekst' | 'llm' | null;
  embedding: number[];        // OpenAI text-embedding-3
}
```

## Personvern (hard krav)

- Ingenting i `korpus.json` eller UI kan identifisere en person.
- Anonymisering skjer før lagring og før noe sendes til eksterne API (OpenAI embeddings, Anthropic).
- Navngjenkjenning kjøres lokalt — rå tekst med navn forlater aldri maskinen.
- `kilde.xlsx` er gitignored og lagres ikke i repoet.

## Feilhåndtering

- Kolonnedrift i xlsx → import avbryter med tydelig melding om hvilke kolonner som mangler.
- Embedding-API nede → retry med backoff; cache gjør at delvis import kan gjenopptas.
- Manglende/tom beskrivelse → hopp over saken, logg antall hoppet over.
- Ingen treff over terskel → eksplisitt tom-tilstand i UI.

## Åpne punkter (avklares ved implementasjonsstart)

1. **«Løsning» som felt:** Analysen viste at *Årsaksanalyse* (14/287) og *Risikovurderinger* (0/287) er nær tomme. Løsningen ligger trolig i selve beskrivelsen. Må bekreftes mot de faktiske xlsx-kolonnene — Tom legger `Filnavn202606230814.xlsx` i `data/kilde.xlsx`.
2. **Beløp-uttrekk regex vs LLM:** Valgt regex-først. For kun 287 saker er LLM-på-alt nesten gratis og mer robust på norsk beløpsnotasjon. Revurderes hvis regex-treffraten er svak på første testkjøring.
3. **OpenAI dataresidens:** Selv anonymisert tekst sendes til OpenAI for embedding. Bekreft EU-residens / ingen-trening, knytt til Azure/Torbjørn-sporet.

## Suksesskriterier

- Import av 287 saker produserer `korpus.json` med 0 gjenværende direkte identifikatorer (verifisert med stikkprøve).
- For en realistisk testbeskrivelse returnerer verktøyet treff som en saksbehandler vurderer som relevante (kvalitativ vurdering med Tom).
- Prisspenn vises når minst ett treff har kostnad.
- Verktøyet er demobart for konsernledelsen.
