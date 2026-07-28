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

/**
 * Beløp fra fritekst — brukes når kostnadsfeltene er tomme.
 *
 * Krever en VALUTA-MARKØR («kr» foran, eller «kr»/«,-» bak). Uten det kravet
 * ble ordre- og kundenummer lest som kroner: «Ordrenr: 6190450» ga 619 045 kr,
 * og totalen for 287 saker ble 11,2 mill. i stedet for reelle ~1 mill.
 * Presisjon foran dekning: vi mister noen beløp uten markør, men finner
 * aldri opp et beløp som ikke finnes.
 */
const BELOP_MAKS = 200_000;
const IKKE_BELOP_KONTEKST = /(ordre|kunde|faktura|konto|tlf|telefon|nummer|nr)\s*[.:/]?\s*$/i;

export function belopFraTekst(text: string): number | null {
  const tall = '\\d{1,3}(?:[ .]\\d{3})+|\\d{1,6}';
  const re = new RegExp(
    `(?:(?:kr|NOK)\\.?\\s*(${tall})(?![\\d.,]*\\d{4}))|((?:${tall}))\\s*(?:,-|kr\\b|NOK\\b)`,
    'gi'
  );
  const funnet: number[] = [];
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const foran = text.slice(Math.max(0, m.index - 22), m.index);
    if (IKKE_BELOP_KONTEKST.test(foran)) continue;
    const n = parseInt((m[1] ?? m[2]).replace(/[ .]/g, ''), 10);
    if (Number.isFinite(n) && n >= 100 && n <= BELOP_MAKS) funnet.push(n);
  }
  return funnet.length ? Math.max(...funnet) : null;
}
