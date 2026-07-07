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
