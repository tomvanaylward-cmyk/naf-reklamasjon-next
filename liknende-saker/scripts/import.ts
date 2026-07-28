import * as XLSX from 'xlsx';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { anonymize } from '../lib/anonymize';
import { hentKostnad } from '../lib/belop';
import { klassifiserTema } from '../lib/tema';
import { embed, hash } from '../lib/embeddings';
import type { CorpusCase, Alvorlighet } from '../types';

// Lokalt alias: korpus-oppføringer bærer en kilde-hash (for gjenopptak) som
// ikke er del av den offentlige CorpusCase-typen brukt av resten av appen.
type ImportertSak = CorpusCase & { kilde_hash: string };

const KOL = {
  beskrivelse: 'Beskrivelse',
  losning: 'Utførte tiltak',
  senter: 'Prosess',
  alvorlighet: 'Alvorlighetsgrad',
  status: 'Status',
  kostnad: 'Sum kostnader',
  registrert: 'Registrert dato',
  lukket: 'Dato lukket',
} as const;

// 'Grunnlag for lukking' finnes i arket, men er sparsomt utfylt (161/287).
// NB: uten `defval` i sheet_to_json utelates nøkler for tomme celler per rad,
// så en sparsom kolonne kan mangle fra akkurat rad 0 selv om den finnes i
// arket. Behandles derfor som valgfritt supplement utenfor den harde
// kolonnedrift-sjekken, i tilfelle fremtidige eksporter dropper den helt.
const KOL_LOSNING_SUPPLEMENT = 'Grunnlag for lukking';

function parseNorskDato(s: unknown): Date | null {
  const m = String(s ?? '').trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

function dagerMellom(a: Date | null, b: Date | null): number | null {
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function parseNorskKostnad(v: unknown): number | null {
  const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

async function main() {
  const wb = XLSX.readFile('data/kilde.xlsx');
  // `defval: ''` sikrer at ALLE header-nøkler finnes på hver rad — uten den
  // utelater sheet_to_json nøkler for tomme celler, og kolonnedrift-sjekken
  // under ville feilaktig slå ut på sparsomme kolonner (f.eks. 'Dato lukket'
  // hvis rad 0 er en åpen sak).
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { range: 1, defval: '' });

  const manglende = Object.values(KOL).filter((k) => !(k in (rows[0] ?? {})));
  if (manglende.length > 0) {
    throw new Error(
      `Kolonnedrift: fant ikke [${manglende.join(', ')}]. Faktiske kolonner: ${Object.keys(rows[0] ?? {}).join(', ')}`
    );
  }

  // Resume support: if korpus.json exists, reuse entries whose content hash matches.
  const tidligere = new Map<string, ImportertSak>();
  if (existsSync('data/korpus.json')) {
    for (const c of JSON.parse(readFileSync('data/korpus.json', 'utf-8')) as ImportertSak[]) {
      if (c.kilde_hash) tidligere.set(c.kilde_hash, c);
    }
    console.log(`Fant eksisterende korpus med ${tidligere.size} gjenbrukbare saker.`);
  }

  const korpus: ImportertSak[] = [];
  let hoppet = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rawBesk = String(r[KOL.beskrivelse] ?? '').trim();
    if (!rawBesk) { hoppet++; continue; }

    const rawLosning = [String(r[KOL.losning] ?? '').trim(), String(r[KOL_LOSNING_SUPPLEMENT] ?? '').trim()]
      .filter(Boolean).join(' — ');
    const kildeHash = hash(rawBesk + ' ' + rawLosning);

    const gjenbruk = tidligere.get(kildeHash);
    if (gjenbruk) {
      korpus.push({ ...gjenbruk, id: `sak-${i + 1}`, kilde_hash: kildeHash });
      continue;
    }

    const beskrivelse_anonymisert = await anonymize(rawBesk);
    const losning_anonymisert = rawLosning ? await anonymize(rawLosning) : null;
    const kostnadsfelt = parseNorskKostnad(r[KOL.kostnad]);
    const { kostnad, kilde } = await hentKostnad(beskrivelse_anonymisert, kostnadsfelt);
    const tema = await klassifiserTema(beskrivelse_anonymisert);
    const embedding = await embed(beskrivelse_anonymisert);

    korpus.push({
      id: `sak-${i + 1}`,
      senter: String(r[KOL.senter] ?? 'Ukjent').trim(),
      alvorlighet: (['Lav', 'Middels', 'Høy'].includes(String(r[KOL.alvorlighet]).trim())
        ? String(r[KOL.alvorlighet]).trim()
        : 'Middels') as Alvorlighet,
      status: String(r[KOL.status] ?? 'Ukjent').trim(),
      tid_til_lukking_dager: dagerMellom(parseNorskDato(r[KOL.registrert]), parseNorskDato(r[KOL.lukket])),
      tema,
      beskrivelse_anonymisert,
      losning_anonymisert,
      kostnad,
      kostnad_kilde: kilde,
      embedding,
      kilde_hash: kildeHash,
    });

    if ((i + 1) % 25 === 0) console.log(`${i + 1}/${rows.length}…`);
    // Skriv underveis så en avbrutt kjøring kan gjenopptas uten å re-embedde alt.
    if ((i + 1) % 50 === 0) writeFileSync('data/korpus.json', JSON.stringify(korpus));
  }

  writeFileSync('data/korpus.json', JSON.stringify(korpus, null, 1));
  console.log(`Ferdig: ${korpus.length} saker skrevet til data/korpus.json, ${hoppet} hoppet over.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
