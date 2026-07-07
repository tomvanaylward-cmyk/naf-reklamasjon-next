import OpenAI from 'openai';
import { createHash } from 'node:crypto';

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}
const MODEL = 'text-embedding-3-small';
const cache = new Map<string, number[]>();

export function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export async function embed(text: string): Promise<number[]> {
  const key = hash(text);
  const hit = cache.get(key);
  if (hit) return hit;
  const res = await getClient().embeddings.create({ model: MODEL, input: text });
  const vec = res.data[0].embedding;
  cache.set(key, vec);
  return vec;
}
