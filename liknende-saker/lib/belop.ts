import { llmExtract } from './llm';
import type { KostnadKilde } from '../types';

// Matcher beløp nær 'kr' eller etterfulgt av ',-'. Fjerner tusenskille (mellomrom/punktum).
export function belopFraTekst(text: string): number | null {
  const m = text.match(/(?:kr\.?\s*)?(\d{1,3}(?:[ .]\d{3})+|\d{3,6})(?:,-|\s*kr)?/i);
  if (!m) return null;
  const n = parseInt(m[1].replace(/[ .]/g, ''), 10);
  return Number.isFinite(n) && n >= 100 ? n : null;
}

export async function hentKostnad(
  beskrivelse: string,
  kostnadsfelt: number | null
): Promise<{ kostnad: number | null; kilde: KostnadKilde | null }> {
  if (kostnadsfelt && kostnadsfelt > 0) return { kostnad: kostnadsfelt, kilde: 'felt' };
  const regex = belopFraTekst(beskrivelse);
  if (regex !== null) return { kostnad: regex, kilde: 'tekst' };
  // LLM-fallback kun når nøkkel er konfigurert — uten den kjører
  // pipelinen helt lokalt og saker uten regex-treff får kostnad null.
  if (!process.env.ANTHROPIC_API_KEY) return { kostnad: null, kilde: null };
  const llm = await llmExtract(beskrivelse);
  return llm !== null ? { kostnad: llm, kilde: 'llm' } : { kostnad: null, kilde: null };
}
