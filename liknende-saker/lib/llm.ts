import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-haiku-4-5-20251001';

async function ask(prompt: string): Promise<string> {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 64,
    messages: [{ role: 'user', content: prompt }],
  });
  const block = res.content[0];
  return block.type === 'text' ? block.text.trim() : '';
}

export async function llmExtract(beskrivelse: string): Promise<number | null> {
  const out = await ask(
    `Hva er den totale kostnaden i kroner som nevnes i denne reklamasjonsteksten? ` +
    `Svar KUN med et heltall uten mellomrom, eller "null" hvis ingen kostnad nevnes.\n\n${beskrivelse}`
  );
  const n = parseInt(out.replace(/\D/g, ''), 10);
  return Number.isFinite(n) && n >= 100 ? n : null;
}

export async function llmTema(beskrivelse: string, kategorier: string[]): Promise<string> {
  const out = await ask(
    `Klassifiser denne reklamasjonen i nøyaktig én av kategoriene: ${kategorier.join(', ')}. ` +
    `Svar KUN med kategorinavnet.\n\n${beskrivelse}`
  );
  const match = kategorier.find((k) => out.toLowerCase().includes(k.toLowerCase()));
  return match ?? 'annet';
}
