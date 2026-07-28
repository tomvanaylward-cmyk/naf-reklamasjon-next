import { llmTema } from './llm';

export const KATEGORIER = [
  'dekk/felg/hjul',
  'service',
  'PKK/EU-kontroll',
  'lakk/karosseri',
  'faktura/pris',
  'annet',
];

/**
 * Nøkkelord-basert klassifisering — kjører helt lokalt. Ordlistene er
 * avledet fra temaene YTD-analysen fant dominerte de 287 sakene.
 * Første kategori med treff vinner (rekkefølgen under er prioritert:
 * spesifikke temaer sjekkes før det generiske 'service').
 */
const NOKKELORD: [string, RegExp][] = [
  ['dekk/felg/hjul', /\b(dekk|felg|hjul|balanser|avbalanser|omleggin|pigg|tpms|ventil)\w*/i],
  ['PKK/EU-kontroll', /\b(pkk|eu-?kontroll|periodisk kj|etterkontroll|underkjen)\w*/i],
  ['lakk/karosseri', /\b(lakk|karosseri|bulk|ripe|riper|skjerm|støtfanger|rust)\w*/i],
  ['faktura/pris', /\b(faktura|pris|belast|betal|kredit|refusjon|gebyr|kostnadsoverslag)\w*/i],
  ['service', /\b(service|oljeskift|verksted|reparasjon|mekaniker|intervall)\w*/i],
];

export function klassifiserTemaLokalt(beskrivelse: string): string {
  for (const [kategori, mønster] of NOKKELORD) {
    if (mønster.test(beskrivelse)) return kategori;
  }
  return 'annet';
}

/**
 * LLM-klassifisering når ANTHROPIC_API_KEY er satt, ellers lokal
 * nøkkelord-mapping. Grovere uten LLM, men holder for å validere
 * retrieval-konseptet — og alt forblir på maskinen.
 */
export function klassifiserTema(beskrivelse: string): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Promise.resolve(klassifiserTemaLokalt(beskrivelse));
  }
  return llmTema(beskrivelse, KATEGORIER);
}
