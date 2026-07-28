import { llmExtract } from './llm';
import type { KostnadKilde } from '../types';

/**
 * Beløp fra fritekst. Krever VALUTA-MARKØR («kr» foran, eller «kr»/«,-» bak).
 * Uten det kravet ble ordre-/kundenummer lest som kroner («Ordrenr: 6190450»
 * → 619 045 kr), og korpusets totalsum ble 11,2 mill. i stedet for ~1 mill.
 * Presisjon foran dekning — finn aldri opp et beløp som ikke finnes.
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
