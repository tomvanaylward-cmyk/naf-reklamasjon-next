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
  losning_anonymisert: string | null;
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
