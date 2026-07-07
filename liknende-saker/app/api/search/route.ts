import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { embed } from '@/lib/embeddings';
import { søk, prisspenn } from '@/lib/retrieval';
import type { CorpusCase, Alvorlighet } from '@/types';

let korpus: CorpusCase[] | null = null;
function lastKorpus(): CorpusCase[] {
  if (!korpus) {
    korpus = JSON.parse(readFileSync(join(process.cwd(), 'data', 'korpus.json'), 'utf-8'));
  }
  return korpus!;
}

export async function POST(req: NextRequest) {
  const { tekst, senter, alvorlighet } = await req.json();
  if (!tekst || typeof tekst !== 'string') {
    return NextResponse.json({ error: 'Mangler tekst' }, { status: 400 });
  }
  let alleSaker: CorpusCase[];
  try {
    alleSaker = lastKorpus();
  } catch {
    return NextResponse.json(
      { error: 'Korpus mangler — kjør `npm run import` først.' },
      { status: 503 }
    );
  }
  const queryVec = await embed(tekst);
  const treff = søk(alleSaker, queryVec, {
    senter: senter || undefined,
    alvorlighet: (alvorlighet as Alvorlighet) || undefined,
  });
  const spenn = prisspenn(treff.map((t) => t.sak.kostnad));
  return NextResponse.json({ treff, prisspenn: spenn });
}
