// liknende-saker/scripts/last-opp-supabase.ts
//
// Leser spikens anonymiserte korpus.json, re-embedder med OpenAI (1536-dim)
// og upserter til kunnskapsbase i Supabase. Kjøres lokalt:
//   OPENAI_API_KEY=... NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run last-opp
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface SpikeSak {
  id: string; senter: string; alvorlighet: string; status: string;
  tid_til_lukking_dager: number | null; tema: string;
  beskrivelse_anonymisert: string; losning_anonymisert: string | null;
  kostnad: number | null; kostnad_kilde: string | null;
}

async function main() {
  const korpus: SpikeSak[] = JSON.parse(readFileSync('data/korpus.json', 'utf-8'));
  console.log(`Laster opp ${korpus.length} legacy-saker…`);
  let ok = 0;
  for (const sak of korpus) {
    const res = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: sak.beskrivelse_anonymisert,
    });
    const { error } = await supabase.from('kunnskapsbase').upsert({
      kilde: 'legacy',
      kilde_ref: `legacy-${sak.id}`,
      senter: sak.senter,
      alvorlighet: sak.alvorlighet,
      status: sak.status,
      tid_til_lukking_dager: sak.tid_til_lukking_dager,
      tema: sak.tema,
      beskrivelse_anonymisert: sak.beskrivelse_anonymisert,
      losning_anonymisert: sak.losning_anonymisert,
      kostnad: sak.kostnad,
      kostnad_kilde: sak.kostnad_kilde,
      embedding: res.data[0].embedding,
    }, { onConflict: 'kilde_ref' });
    if (error) throw new Error(`Feil på ${sak.id}: ${error.message}`);
    ok++;
    if (ok % 25 === 0) console.log(`${ok}/${korpus.length}…`);
  }
  console.log(`Ferdig: ${ok} saker lastet opp.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
