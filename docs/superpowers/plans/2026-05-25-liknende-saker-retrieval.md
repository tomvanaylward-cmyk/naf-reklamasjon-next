# «Liknende saker» Retrieval — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bygg en frittstående Next.js-spike som tar en ny reklamasjonsbeskrivelse og viser de mest liknende tidligere sakene (tema, kostnad, prisspenn), basert på semantisk søk over 287 anonymiserte legacy-saker.

**Architecture:** Egen mini-app i `liknende-saker/` med eget `package.json`. En import-pipeline (`scripts/import.ts`) anonymiserer xlsx-en, trekker ut beløp/tema, embedder med OpenAI, og skriver `korpus.json`. En API-rute embedder spørringen og rangerer korpuset med cosinus in-memory. UI matcher den godkjente mockupen.

**Tech Stack:** Next.js 15 (App Router), TypeScript, vitest, `xlsx` (parsing), `@xenova/transformers` (lokal NER, offline), `openai` (embeddings), `@anthropic-ai/sdk` (tema + beløp-fallback).

**GDPR (hardt krav):** Anonymisering skjer før lagring og før eksterne API-kall. Rå tekst med navn går kun til lokal NER-modell. `korpus.json` inneholder null direkte identifikatorer.

---

## Filstruktur

```
liknende-saker/
├── package.json
├── tsconfig.json
├── next.config.mjs
├── vitest.config.ts
├── .env.local                 # OPENAI_API_KEY, ANTHROPIC_API_KEY (gitignored)
├── .gitignore                 # data/, .env.local, .next/, node_modules/
├── types.ts                   # CorpusCase, SearchHit
├── data/
│   ├── kilde.xlsx             # legacy-eksport (gitignored, Tom legger inn)
│   └── korpus.json            # generert (gitignored)
├── lib/
│   ├── anonymize.ts           # regex + lokal NER
│   ├── anonymize.test.ts
│   ├── belop.ts               # beløp: regex + LLM-fallback
│   ├── belop.test.ts
│   ├── tema.ts                # LLM tema-klassifisering
│   ├── llm.ts                 # Anthropic-wrapper (portabel abstraksjon)
│   ├── embeddings.ts          # OpenAI text-embedding-3-small
│   ├── retrieval.ts           # cosinus + filter + prisspenn
│   └── retrieval.test.ts
├── scripts/
│   └── import.ts              # orkestrerer pipelinen → korpus.json
└── app/
    ├── page.tsx               # søke-UI (matcher mockup)
    └── api/search/route.ts    # embed query + retrieval
```

---

## Task 0: Scaffold standalone spike

**Files:**
- Create: `liknende-saker/package.json`, `tsconfig.json`, `next.config.mjs`, `vitest.config.ts`, `.gitignore`, `.env.local`

- [ ] **Step 1: Opprett mappe og package.json**

```json
{
  "name": "liknende-saker-spike",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3100",
    "build": "next build",
    "test": "vitest run",
    "import": "tsx scripts/import.ts"
  },
  "dependencies": {
    "next": "15.1.0",
    "react": "19.0.0",
    "react-dom": "19.0.0",
    "openai": "^4.77.0",
    "@anthropic-ai/sdk": "^0.32.0",
    "@xenova/transformers": "^2.17.2",
    "xlsx": "^0.18.5"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "tsx": "^4.19.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "paths": { "@/*": ["./*"] }
  },
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: next.config.mjs og vitest.config.ts**

`next.config.mjs`:
```js
/** @type {import('next').NextConfig} */
export default { serverExternalPackages: ['@xenova/transformers'] };
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node' } });
```

- [ ] **Step 4: .gitignore**

```
node_modules/
.next/
.env.local
data/kilde.xlsx
data/korpus.json
```

- [ ] **Step 5: Installer og verifiser**

Run: `cd liknende-saker && npm install && npx tsc --noEmit`
Expected: Ingen typefeil (ingen kildefiler ennå, kun config).

- [ ] **Step 6: Commit**

```bash
git add liknende-saker/package.json liknende-saker/tsconfig.json liknende-saker/next.config.mjs liknende-saker/vitest.config.ts liknende-saker/.gitignore
git commit -m "chore: scaffold liknende-saker spike"
```

---

## Task 1: Typer

**Files:**
- Create: `liknende-saker/types.ts`

- [ ] **Step 1: Definer CorpusCase og SearchHit**

```ts
export type Alvorlighet = 'Lav' | 'Middels' | 'Høy';
export type KostnadKilde = 'felt' | 'tekst' | 'llm';

export interface CorpusCase {
  id: string;                       // syntetisk løpenummer, ikke legacy-saksnr
  senter: string;                   // én av de 44 NAF-sentrene
  alvorlighet: Alvorlighet;
  status: string;                   // 'Lukket' | 'Åpen'
  tid_til_lukking_dager: number | null;
  tema: string;
  beskrivelse_anonymisert: string;
  kostnad: number | null;
  kostnad_kilde: KostnadKilde | null;
  embedding: number[];
}

export interface SearchHit {
  sak: Omit<CorpusCase, 'embedding'>;
  likhet: number;                   // 0..1 cosinus
}

export interface Prisspenn {
  median: number;
  min: number;
  max: number;
  antall: number;                   // antall treff med kostnad
}
```

- [ ] **Step 2: Commit**

```bash
git add liknende-saker/types.ts
git commit -m "feat: typer for korpus og søketreff"
```

---

## Task 2: Anonymisering — regex (TDD)

**Files:**
- Create: `liknende-saker/lib/anonymize.ts`, `liknende-saker/lib/anonymize.test.ts`

- [ ] **Step 1: Skriv failing test**

```ts
// lib/anonymize.test.ts
import { describe, it, expect } from 'vitest';
import { redactPatterns } from './anonymize';

describe('redactPatterns', () => {
  it('fjerner e-post', () => {
    expect(redactPatterns('kontakt ola@example.no i dag')).toBe('kontakt [E-POST] i dag');
  });
  it('fjerner norsk telefonnummer', () => {
    expect(redactPatterns('ring 912 34 567')).toBe('ring [TLF]');
    expect(redactPatterns('ring +47 91234567')).toBe('ring [TLF]');
  });
  it('fjerner bilskilt', () => {
    expect(redactPatterns('bil EL12345')).toBe('bil [REGNR]');
    expect(redactPatterns('bil DT 98765')).toBe('bil [REGNR]');
  });
  it('fjerner fødselsnummer og orgnr', () => {
    expect(redactPatterns('fnr 01018012345')).toBe('fnr [FNR]');
    expect(redactPatterns('orgnr 912345678')).toBe('orgnr [ORGNR]');
  });
  it('beholder beløp', () => {
    expect(redactPatterns('kostnad 4 300 kr')).toBe('kostnad 4 300 kr');
  });
});
```

- [ ] **Step 2: Kjør test, verifiser fail**

Run: `cd liknende-saker && npx vitest run lib/anonymize.test.ts`
Expected: FAIL — `redactPatterns is not a function`.

- [ ] **Step 3: Implementer redactPatterns**

Rekkefølgen er viktig: fnr (11 siffer) før orgnr (9 siffer) før telefon (8 siffer), ellers spises lange tall av kortere mønstre.

```ts
// lib/anonymize.ts
export function redactPatterns(text: string): string {
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[E-POST]')
    .replace(/\b\d{11}\b/g, '[FNR]')
    .replace(/\b\d{9}\b/g, '[ORGNR]')
    .replace(/\b[A-Z]{2}\s?\d{5}\b/g, '[REGNR]')
    .replace(/(\+47\s?)?\b\d{3}\s?\d{2}\s?\d{3}\b/g, '[TLF]');
}
```

- [ ] **Step 4: Kjør test, verifiser pass**

Run: `cd liknende-saker && npx vitest run lib/anonymize.test.ts`
Expected: PASS (5 tester).

- [ ] **Step 5: Commit**

```bash
git add liknende-saker/lib/anonymize.ts liknende-saker/lib/anonymize.test.ts
git commit -m "feat: regex-anonymisering av strukturert PII"
```

---

## Task 3: Anonymisering — lokal NER for navn

**Files:**
- Modify: `liknende-saker/lib/anonymize.ts`

Lokal NER kjøres offline med transformers.js. Modellen lastes ned én gang til lokal cache; deretter går rå tekst kun til lokal modell.

- [ ] **Step 1: Legg til anonymize()-funksjon**

```ts
// lib/anonymize.ts (legg til)
import { pipeline, env } from '@xenova/transformers';

env.allowRemoteModels = true; // tillat nedlasting av vekter første gang
let nerPromise: Promise<any> | null = null;

function getNer() {
  if (!nerPromise) {
    nerPromise = pipeline('token-classification', 'Xenova/bert-base-multilingual-cased-ner-hrl');
  }
  return nerPromise;
}

export async function redactNames(text: string): Promise<string> {
  const ner = await getNer();
  const ents = await ner(text, { ignore_labels: [] });
  // Samle person-spans (PER), erstatt fra slutten for å bevare indekser.
  const persons = ents
    .filter((e: any) => e.entity?.includes('PER'))
    .map((e: any) => e.word.replace(/^##/, ''));
  let out = text;
  for (const name of persons) {
    if (name.length > 1) out = out.split(name).join('[NAVN]');
  }
  return out;
}

export async function anonymize(text: string): Promise<string> {
  return redactNames(redactPatterns(text));
}
```

- [ ] **Step 2: Manuell verifisering (NER krever modellnedlasting, ikke enhetstest)**

Run:
```bash
cd liknende-saker && npx tsx -e "import('./lib/anonymize.ts').then(async m => console.log(await m.anonymize('Snakket med Kari Nordmann om bil EL12345')))"
```
Expected: `Snakket med [NAVN] om bil [REGNR]` (navnegjenkjenning kan variere — noter avvik).

- [ ] **Step 3: Commit**

```bash
git add liknende-saker/lib/anonymize.ts
git commit -m "feat: lokal NER fjerner personnavn offline"
```

---

## Task 4: Beløp-uttrekk — regex + LLM-fallback (TDD på regex)

**Files:**
- Create: `liknende-saker/lib/belop.ts`, `liknende-saker/lib/belop.test.ts`

- [ ] **Step 1: Skriv failing test for regex-delen**

```ts
// lib/belop.test.ts
import { describe, it, expect } from 'vitest';
import { belopFraTekst } from './belop';

describe('belopFraTekst', () => {
  it('leser tusenskille med mellomrom', () => {
    expect(belopFraTekst('kostnad ble 4 300 kr')).toBe(4300);
  });
  it('leser punktum-tusenskille og komma', () => {
    expect(belopFraTekst('beløp 14.500,- totalt')).toBe(14500);
  });
  it('leser kr-prefiks', () => {
    expect(belopFraTekst('kr 5000 for jobben')).toBe(5000);
  });
  it('returnerer null når ingen beløp', () => {
    expect(belopFraTekst('ingen kostnad oppgitt')).toBeNull();
  });
});
```

- [ ] **Step 2: Kjør test, verifiser fail**

Run: `cd liknende-saker && npx vitest run lib/belop.test.ts`
Expected: FAIL — `belopFraTekst is not a function`.

- [ ] **Step 3: Implementer belopFraTekst**

```ts
// lib/belop.ts
// Matcher beløp nær 'kr' eller etterfulgt av ',-'. Fjerner tusenskille (mellomrom/punktum).
export function belopFraTekst(text: string): number | null {
  const m = text.match(/(?:kr\.?\s*)?(\d{1,3}(?:[ .]\d{3})+|\d{3,6})(?:,-|\s*kr)?/i);
  if (!m) return null;
  const n = parseInt(m[1].replace(/[ .]/g, ''), 10);
  return Number.isFinite(n) && n >= 100 ? n : null;
}
```

- [ ] **Step 4: Kjør test, verifiser pass**

Run: `cd liknende-saker && npx vitest run lib/belop.test.ts`
Expected: PASS (4 tester).

- [ ] **Step 5: Legg til LLM-fallback**

```ts
// lib/belop.ts (legg til)
import { llmExtract } from './llm';
import type { KostnadKilde } from '../types';

export async function hentKostnad(
  beskrivelse: string,
  kostnadsfelt: number | null
): Promise<{ kostnad: number | null; kilde: KostnadKilde | null }> {
  if (kostnadsfelt && kostnadsfelt > 0) return { kostnad: kostnadsfelt, kilde: 'felt' };
  const regex = belopFraTekst(beskrivelse);
  if (regex !== null) return { kostnad: regex, kilde: 'tekst' };
  const llm = await llmExtract(beskrivelse);
  return llm !== null ? { kostnad: llm, kilde: 'llm' } : { kostnad: null, kilde: null };
}
```

- [ ] **Step 6: Commit**

```bash
git add liknende-saker/lib/belop.ts liknende-saker/lib/belop.test.ts
git commit -m "feat: beløp-uttrekk med regex og LLM-fallback"
```

---

## Task 5: LLM-wrapper (Anthropic)

**Files:**
- Create: `liknende-saker/lib/llm.ts`

Portabel abstraksjon — én fil å bytte ved Azure-migrasjon.

- [ ] **Step 1: Implementer llm.ts**

```ts
// lib/llm.ts
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-3-5-haiku-20241022';

async function ask(prompt: string): Promise<string> {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 64,
    messages: [{ role: 'user', content: prompt }],
  });
  const block = res.content[0];
  return block.type === 'text' ? block.text.trim() : '';
}

export async function llmExtract(beskrivelse: string): Promise<number | null> {
  const out = await ask(
    `Hva er den totale kostnaden i kroner som nevnes i denne reklamasjonsteksten? ` +
    `Svar KUN med et heltall uten mellomrom, eller "null" hvis ingen kostnad nevnes.\n\n${beskrivelse}`
  );
  const n = parseInt(out.replace(/\D/g, ''), 10);
  return Number.isFinite(n) && n >= 100 ? n : null;
}

export async function llmTema(beskrivelse: string, kategorier: string[]): Promise<string> {
  const out = await ask(
    `Klassifiser denne reklamasjonen i nøyaktig én av kategoriene: ${kategorier.join(', ')}. ` +
    `Svar KUN med kategorinavnet.\n\n${beskrivelse}`
  );
  const match = kategorier.find((k) => out.toLowerCase().includes(k.toLowerCase()));
  return match ?? 'annet';
}
```

- [ ] **Step 2: Verifiser typecheck**

Run: `cd liknende-saker && npx tsc --noEmit`
Expected: Ingen feil.

- [ ] **Step 3: Commit**

```bash
git add liknende-saker/lib/llm.ts
git commit -m "feat: Anthropic LLM-wrapper for uttrekk og klassifisering"
```

---

## Task 6: Tema-klassifisering

**Files:**
- Create: `liknende-saker/lib/tema.ts`

- [ ] **Step 1: Implementer tema.ts**

```ts
// lib/tema.ts
import { llmTema } from './llm';

export const KATEGORIER = [
  'dekk/felg/hjul',
  'service',
  'PKK/EU-kontroll',
  'lakk/karosseri',
  'faktura/pris',
  'annet',
];

export function klassifiserTema(beskrivelse: string): Promise<string> {
  return llmTema(beskrivelse, KATEGORIER);
}
```

- [ ] **Step 2: Commit**

```bash
git add liknende-saker/lib/tema.ts
git commit -m "feat: tema-klassifisering med fast kategoriliste"
```

---

## Task 7: Embeddings (OpenAI)

**Files:**
- Create: `liknende-saker/lib/embeddings.ts`

- [ ] **Step 1: Implementer embeddings.ts med innholds-hash-cache**

```ts
// lib/embeddings.ts
import OpenAI from 'openai';
import { createHash } from 'node:crypto';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = 'text-embedding-3-small';
const cache = new Map<string, number[]>();

export function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export async function embed(text: string): Promise<number[]> {
  const key = hash(text);
  const hit = cache.get(key);
  if (hit) return hit;
  const res = await client.embeddings.create({ model: MODEL, input: text });
  const vec = res.data[0].embedding;
  cache.set(key, vec);
  return vec;
}
```

- [ ] **Step 2: Commit**

```bash
git add liknende-saker/lib/embeddings.ts
git commit -m "feat: OpenAI embeddings med innholds-hash-cache"
```

---

## Task 8: Retrieval — cosinus + filter + prisspenn (TDD)

**Files:**
- Create: `liknende-saker/lib/retrieval.ts`, `liknende-saker/lib/retrieval.test.ts`

- [ ] **Step 1: Skriv failing test**

```ts
// lib/retrieval.test.ts
import { describe, it, expect } from 'vitest';
import { cosine, prisspenn } from './retrieval';

describe('cosine', () => {
  it('1 for identiske vektorer', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
  });
  it('0 for ortogonale', () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });
});

describe('prisspenn', () => {
  it('median, min og max fra kostnader', () => {
    expect(prisspenn([1800, 4300, 14500])).toEqual({ median: 4300, min: 1800, max: 14500, antall: 3 });
  });
  it('ignorerer null-kostnader', () => {
    expect(prisspenn([null, 5000, null])).toEqual({ median: 5000, min: 5000, max: 5000, antall: 1 });
  });
  it('antall 0 når ingen kostnad', () => {
    expect(prisspenn([null, null]).antall).toBe(0);
  });
});
```

- [ ] **Step 2: Kjør test, verifiser fail**

Run: `cd liknende-saker && npx vitest run lib/retrieval.test.ts`
Expected: FAIL — `cosine is not a function`.

- [ ] **Step 3: Implementer retrieval.ts**

```ts
// lib/retrieval.ts
import type { CorpusCase, SearchHit, Prisspenn, Alvorlighet } from '../types';

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function prisspenn(kostnader: (number | null)[]): Prisspenn {
  const tall = kostnader.filter((k): k is number => k !== null).sort((a, b) => a - b);
  if (tall.length === 0) return { median: 0, min: 0, max: 0, antall: 0 };
  const mid = Math.floor(tall.length / 2);
  const median = tall.length % 2 ? tall[mid] : Math.round((tall[mid - 1] + tall[mid]) / 2);
  return { median, min: tall[0], max: tall[tall.length - 1], antall: tall.length };
}

export interface SøkeFilter { senter?: string; alvorlighet?: Alvorlighet; terskel?: number; topK?: number; }

export function søk(korpus: CorpusCase[], queryVec: number[], f: SøkeFilter = {}): SearchHit[] {
  const terskel = f.terskel ?? 0.3;
  const topK = f.topK ?? 8;
  return korpus
    .filter((c) => (!f.senter || c.senter === f.senter) && (!f.alvorlighet || c.alvorlighet === f.alvorlighet))
    .map((c) => {
      const { embedding, ...sak } = c;
      return { sak, likhet: cosine(queryVec, embedding) };
    })
    .filter((h) => h.likhet >= terskel)
    .sort((a, b) => b.likhet - a.likhet)
    .slice(0, topK);
}
```

- [ ] **Step 4: Kjør test, verifiser pass**

Run: `cd liknende-saker && npx vitest run lib/retrieval.test.ts`
Expected: PASS (5 tester).

- [ ] **Step 5: Commit**

```bash
git add liknende-saker/lib/retrieval.ts liknende-saker/lib/retrieval.test.ts
git commit -m "feat: cosinus-søk, filter og prisspenn"
```

---

## Task 9: Import-pipeline

**Files:**
- Create: `liknende-saker/scripts/import.ts`

**Forutsetning:** Tom har lagt `Filnavn202606230814.xlsx` som `liknende-saker/data/kilde.xlsx`. Kolonnenavnene under (`KOL`) bekreftes mot faktisk fil i Step 1 — juster konstantene hvis de avviker.

- [ ] **Step 1: Inspiser faktiske kolonnenavn**

Run:
```bash
cd liknende-saker && npx tsx -e "const x=require('xlsx');const wb=x.readFile('data/kilde.xlsx');const r=x.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);console.log(Object.keys(r[0]));console.log(r.length,'rader')"
```
Expected: Liste over kolonnenavn + `287 rader`. Noter de faktiske navnene for beskrivelse, senter, alvorlighet, status, kostnad, datoer.

- [ ] **Step 2: Skriv import.ts mot bekreftede kolonner**

```ts
// scripts/import.ts
import * as XLSX from 'xlsx';
import { writeFileSync } from 'node:fs';
import { anonymize } from '../lib/anonymize';
import { hentKostnad } from '../lib/belop';
import { klassifiserTema } from '../lib/tema';
import { embed } from '../lib/embeddings';
import type { CorpusCase, Alvorlighet } from '../types';

// === Juster disse til faktiske kolonnenavn fra Step 1 ===
const KOL = {
  beskrivelse: 'Beskrivelse',
  senter: 'Senter',
  alvorlighet: 'Alvorlighetsgrad',
  status: 'Status',
  kostnad: 'Sum kostnader',
  opprettet: 'Opprettet',
  lukket: 'Lukket',
};

function dager(a?: string, b?: string): number | null {
  if (!a || !b) return null;
  const d = (new Date(b).getTime() - new Date(a).getTime()) / 86400000;
  return Number.isFinite(d) ? Math.round(d) : null;
}

async function main() {
  const wb = XLSX.readFile('data/kilde.xlsx');
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[wb.SheetNames[0]]);
  if (!(KOL.beskrivelse in (rows[0] ?? {}))) {
    throw new Error(`Fant ikke kolonne "${KOL.beskrivelse}". Faktiske: ${Object.keys(rows[0] ?? {}).join(', ')}`);
  }
  const korpus: CorpusCase[] = [];
  let hoppet = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rawBesk = String(r[KOL.beskrivelse] ?? '').trim();
    if (!rawBesk) { hoppet++; continue; }
    const beskrivelse_anonymisert = await anonymize(rawBesk);
    const kostnadsfelt = Number(r[KOL.kostnad]) || null;
    const { kostnad, kilde } = await hentKostnad(beskrivelse_anonymisert, kostnadsfelt);
    const tema = await klassifiserTema(beskrivelse_anonymisert);
    const embedding = await embed(beskrivelse_anonymisert);
    korpus.push({
      id: `sak-${i + 1}`,
      senter: String(r[KOL.senter] ?? 'Ukjent'),
      alvorlighet: (r[KOL.alvorlighet] as Alvorlighet) ?? 'Middels',
      status: String(r[KOL.status] ?? 'Ukjent'),
      tid_til_lukking_dager: dager(r[KOL.opprettet], r[KOL.lukket]),
      tema,
      beskrivelse_anonymisert,
      kostnad,
      kostnad_kilde: kilde,
      embedding,
    });
    if ((i + 1) % 25 === 0) console.log(`${i + 1}/${rows.length}`);
  }
  writeFileSync('data/korpus.json', JSON.stringify(korpus, null, 2));
  console.log(`Ferdig: ${korpus.length} saker, ${hoppet} hoppet over.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Commit (kjøres mot data i Task 12)**

```bash
git add liknende-saker/scripts/import.ts
git commit -m "feat: import-pipeline xlsx til korpus.json"
```

---

## Task 10: Søke-API

**Files:**
- Create: `liknende-saker/app/api/search/route.ts`

- [ ] **Step 1: Implementer route.ts**

```ts
// app/api/search/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'node:fs';
import { embed } from '@/lib/embeddings';
import { søk, prisspenn } from '@/lib/retrieval';
import type { CorpusCase, Alvorlighet } from '@/types';

let korpus: CorpusCase[] | null = null;
function lastKorpus(): CorpusCase[] {
  if (!korpus) korpus = JSON.parse(readFileSync('data/korpus.json', 'utf-8'));
  return korpus;
}

export async function POST(req: NextRequest) {
  const { tekst, senter, alvorlighet } = await req.json();
  if (!tekst || typeof tekst !== 'string') {
    return NextResponse.json({ error: 'Mangler tekst' }, { status: 400 });
  }
  const queryVec = await embed(tekst);
  const treff = søk(lastKorpus(), queryVec, {
    senter: senter || undefined,
    alvorlighet: (alvorlighet as Alvorlighet) || undefined,
  });
  const spenn = prisspenn(treff.map((t) => t.sak.kostnad));
  return NextResponse.json({ treff, prisspenn: spenn });
}
```

- [ ] **Step 2: Commit**

```bash
git add liknende-saker/app/api/search/route.ts
git commit -m "feat: søke-API embedder spørring og rangerer korpus"
```

---

## Task 11: Søke-UI

**Files:**
- Create: `liknende-saker/app/page.tsx`

- [ ] **Step 1: Implementer page.tsx (matcher godkjent mockup)**

```tsx
'use client';
import { useState } from 'react';
import type { SearchHit, Prisspenn } from '@/types';

export default function Page() {
  const [tekst, setTekst] = useState('');
  const [treff, setTreff] = useState<SearchHit[]>([]);
  const [spenn, setSpenn] = useState<Prisspenn | null>(null);
  const [laster, setLaster] = useState(false);

  async function søk() {
    setLaster(true);
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tekst }),
    });
    const data = await res.json();
    setTreff(data.treff ?? []);
    setSpenn(data.prisspenn ?? null);
    setLaster(false);
  }

  return (
    <main style={{ maxWidth: 760, margin: '40px auto', fontFamily: 'system-ui', padding: 16 }}>
      <h1>Finn liknende saker</h1>
      <textarea value={tekst} onChange={(e) => setTekst(e.target.value)} rows={4}
        placeholder="Lim inn beskrivelse av ny reklamasjon…" style={{ width: '100%', padding: 10 }} />
      <button onClick={søk} disabled={laster || !tekst} style={{ marginTop: 8, padding: '8px 16px' }}>
        {laster ? 'Søker…' : 'Søk liknende saker'}
      </button>

      {spenn && spenn.antall > 0 && (
        <div style={{ background: '#eef', border: '1px solid #99c', borderRadius: 8, padding: 12, marginTop: 16 }}>
          <strong>Estimert prisspenn:</strong> median {spenn.median.toLocaleString('nb-NO')} kr ·
          spenn {spenn.min.toLocaleString('nb-NO')}–{spenn.max.toLocaleString('nb-NO')} kr ·
          basert på {spenn.antall} treff
        </div>
      )}

      {treff.length === 0 && !laster && tekst && <p style={{ marginTop: 16 }}>Ingen sterkt liknende saker.</p>}

      {treff.map((t) => (
        <div key={t.sak.id} style={{ border: '1px solid #ccc', borderRadius: 8, padding: 12, marginTop: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#666' }}>
            <span style={{ background: '#10b981', color: '#fff', padding: '2px 8px', borderRadius: 12 }}>
              {Math.round(t.likhet * 100)}% likhet
            </span>
            <span>{t.sak.tema} · {t.sak.alvorlighet} · {t.sak.status}
              {t.sak.tid_til_lukking_dager != null ? ` · ${t.sak.tid_til_lukking_dager} dager` : ''}</span>
          </div>
          <p>{t.sak.beskrivelse_anonymisert}</p>
          <div style={{ fontSize: 13 }}>
            <strong>Kostnad:</strong>{' '}
            {t.sak.kostnad != null
              ? `${t.sak.kostnad.toLocaleString('nb-NO')} kr (${t.sak.kostnad_kilde})`
              : 'ikke oppgitt'}
          </div>
        </div>
      ))}
    </main>
  );
}
```

- [ ] **Step 2: Verifiser build**

Run: `cd liknende-saker && npm run build`
Expected: Bygger uten typefeil.

- [ ] **Step 3: Commit**

```bash
git add liknende-saker/app/page.tsx
git commit -m "feat: søke-UI med prisspenn og treffkort"
```

---

## Task 12: Kjør import + GDPR-akseptanse + kvalitetssjekk

**Files:** ingen nye — kjøring og verifisering.

- [ ] **Step 1: Legg .env.local med nøkler**

```
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

- [ ] **Step 2: Kjør import**

Run: `cd liknende-saker && npm run import`
Expected: `Ferdig: ~287 saker, N hoppet over.` og `data/korpus.json` opprettet.

- [ ] **Step 3: GDPR-akseptanse — verifiser 0 gjenværende PII**

Run:
```bash
cd liknende-saker && npx tsx -e "const k=require('./data/korpus.json');const txt=k.map(c=>c.beskrivelse_anonymisert).join(' ');const funn=[...txt.matchAll(/[A-Za-z0-9._%+-]+@|\b[A-Z]{2}\s?\d{5}\b|\b\d{9,11}\b/g)];console.log('Gjenværende PII-mønstre:',funn.length);console.log('Felter i korpus:',Object.keys(k[0]))"
```
Expected: `Gjenværende PII-mønstre: 0` og felt-listen inneholder INGEN navn/e-post/telefon/reg.nr-felt. Stikkprøve 5–10 beskrivelser manuelt for navn NER kan ha bommet på — dette er akseptansekriteriet.

- [ ] **Step 4: Kvalitetssjekk retrieval (med Tom)**

Run: `cd liknende-saker && npm run dev` → åpne `http://localhost:3100`, lim inn en realistisk beskrivelse, vurder om treffene er relevante. Noter treffkvalitet og om regex-beløp-treffraten er god nok (ellers: bytt til LLM-på-alt, jf. spec åpent punkt 2).

- [ ] **Step 5: Commit eventuelle justeringer + oppsummering**

```bash
git add -A
git commit -m "chore: kjør import, verifiser GDPR-anonymisering og treffkvalitet"
```

---

## Self-Review

**Spec-dekning:**
- Retrieval (ikke prediksjon) → Task 8 ✅
- Frittstående Next.js-spike → Task 0, 10, 11 ✅
- Flat-fil-vektorer / in-memory cosinus → Task 8, 9 ✅
- OpenAI embeddings → Task 7 ✅
- Anthropic for tema/beløp → Task 5, 6, 4 ✅
- Beløp regex-først + LLM-fallback → Task 4 ✅
- Lokal/offline NER → Task 3 ✅
- Anonymisering før lagring/API + null identifikatorer i korpus → Task 2, 3, 9, 12 (akseptanse) ✅
- Prisspenn (median/min/max) → Task 8, 10, 11 ✅
- Kilde-merking på kostnad → Task 4 (KostnadKilde), 11 ✅
- Filter senter/alvorlighet → Task 8, 10 ✅
- Tom-tilstand ved ingen treff → Task 11 ✅
- Feilhåndtering: kolonnedrift → Task 9 Step 2; manglende beskrivelse → Task 9 (hoppet); ingen treff → Task 11 ✅
- Åpne punkter (xlsx-kolonner, regex vs LLM, OpenAI-residens) → Task 9 Step 1, Task 12 Step 4, + flagget i spec ✅

**Placeholder-skann:** Ingen TBD/TODO. `KOL`-konstantene i Task 9 er eksplisitt merket for bekreftelse i Step 1 mot faktisk fil — ikke et skjult hull.

**Type-konsistens:** `CorpusCase`, `SearchHit`, `Prisspenn`, `KostnadKilde`, `Alvorlighet` definert i Task 1 og brukt konsekvent i Task 4, 8, 10, 11. `anonymize()`, `hentKostnad()`, `klassifiserTema()`, `embed()`, `søk()`, `prisspenn()`, `cosine()` — alle definert før de brukes i import/route.
