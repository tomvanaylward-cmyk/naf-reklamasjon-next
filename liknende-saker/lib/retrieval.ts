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
