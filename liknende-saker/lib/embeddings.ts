import OpenAI from 'openai';
import { createHash } from 'node:crypto';

/**
 * Embedding-provider med to moduser:
 *  - OpenAI `text-embedding-3-small` når OPENAI_API_KEY er satt
 *  - Lokal `Xenova/multilingual-e5-small` (via transformers.js, samme
 *    runtime som NER-en) når nøkkel mangler — hele pipelinen kjører da
 *    offline og ingenting forlater maskinen.
 *
 * NB: vektorer fra ulike modeller er inkompatible. `modellnavn()` lagres
 * i korpus.json ved import, og søke-API-et nekter å blande modeller.
 * Bytte av modell = slett data/korpus.json og kjør import på nytt.
 *
 * E5-modellene er trent med prefiksene "query:" / "passage:" — bruk
 * `kind` for å angi om teksten er en søkespørring eller et korpusdokument.
 */
export type EmbedKind = 'query' | 'passage';

const OPENAI_MODEL = 'text-embedding-3-small';
const LOKAL_MODEL = 'Xenova/multilingual-e5-small';

export function brukerLokalModell(): boolean {
  return !process.env.OPENAI_API_KEY;
}

export function modellnavn(): string {
  return brukerLokalModell() ? LOKAL_MODEL : OPENAI_MODEL;
}

let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

// Lazy lokal pipeline — samme mønster som NER-en i anonymize.ts.
type FeatureExtractor = (
  text: string,
  options: { pooling: 'mean'; normalize: boolean }
) => Promise<{ data: Float32Array }>;

let lokalPromise: Promise<FeatureExtractor> | null = null;
function getLokal(): Promise<FeatureExtractor> {
  if (!lokalPromise) {
    lokalPromise = import('@xenova/transformers').then(
      ({ pipeline }) => pipeline('feature-extraction', LOKAL_MODEL) as unknown as Promise<FeatureExtractor>
    );
  }
  return lokalPromise;
}

const cache = new Map<string, number[]>();

export function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export async function embed(text: string, kind: EmbedKind = 'passage'): Promise<number[]> {
  const key = `${modellnavn()}:${kind}:${hash(text)}`;
  const hit = cache.get(key);
  if (hit) return hit;

  let vec: number[];
  if (brukerLokalModell()) {
    const extract = await getLokal();
    const out = await extract(`${kind}: ${text}`, { pooling: 'mean', normalize: true });
    vec = Array.from(out.data);
  } else {
    const res = await getOpenAI().embeddings.create({ model: OPENAI_MODEL, input: text });
    vec = res.data[0].embedding;
  }
  cache.set(key, vec);
  return vec;
}
