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
