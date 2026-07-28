// Grupperer korpuset i tema-klynger med spherical k-means på de eksisterende
// embeddingene. Ingen API-kall — ren matematikk på vektorer vi allerede har.
//
// For hver klynge rapporteres: størrelse, kostnadsspredning, ledetid og
// representative saker. Kostnadsspredning INNENFOR en klynge er nøkkeltallet:
// samme problem løst til vidt ulik pris = penger å hente.
import { readFileSync } from 'node:fs';

interface Sak {
  id: string; senter: string; alvorlighet: string; status: string;
  tid_til_lukking_dager: number | null; tema: string;
  beskrivelse_anonymisert: string; losning_anonymisert: string | null;
  kostnad: number | null; embedding: number[];
}

const K = Number(process.argv[2] ?? 10);
const ITER = 40;
const SEED = 42;

// Deterministisk PRNG så kjøringer er reproduserbare.
let seed = SEED;
function rand(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function normaliser(v: number[]): number[] {
  const n = Math.sqrt(dot(v, v));
  return n === 0 ? v : v.map((x) => x / n);
}

function median(tall: number[]): number {
  if (!tall.length) return 0;
  const s = [...tall].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/** Ord som skiller denne klyngen fra resten (enkel log-odds, gir klyngenavn). */
function kjennetegn(iKlynge: string[], alle: string[], antall = 6): string[] {
  const STOPP = new Set(['og','i','på','til','av','for','er','som','med','en','et','den','det','har','ble','at','de','fra','om','var','ikke','skal','kan','vi','han','hun','seg','sin','sitt','etter','ved','men','så','da','også','navn','kunde','klager','klage','følgende','feil']);
  const tell = (tekster: string[]) => {
    const m = new Map<string, number>();
    for (const t of tekster) {
      for (const w of new Set(t.toLowerCase().match(/[a-zæøå]{4,}/g) ?? [])) {
        if (!STOPP.has(w)) m.set(w, (m.get(w) ?? 0) + 1);
      }
    }
    return m;
  };
  const inn = tell(iKlynge), ut = tell(alle);
  const skår: [string, number][] = [];
  for (const [w, n] of inn) {
    if (n < 2) continue;
    const andelInn = n / iKlynge.length;
    const andelUt = (ut.get(w) ?? 0) / alle.length;
    skår.push([w, andelInn / (andelUt + 0.01)]);
  }
  return skår.sort((a, b) => b[1] - a[1]).slice(0, antall).map(([w]) => w);
}

const korpus: Sak[] = JSON.parse(readFileSync('data/korpus.json', 'utf-8'));
const vek = korpus.map((s) => normaliser(s.embedding));

// k-means++-aktig init: første tilfeldig, deretter den som ligger lengst fra valgte.
const sentre: number[][] = [vek[Math.floor(rand() * vek.length)]];
while (sentre.length < K) {
  let beste = 0, besteAvstand = -Infinity;
  for (let i = 0; i < vek.length; i++) {
    const nærmest = Math.max(...sentre.map((c) => dot(vek[i], c)));
    if (1 - nærmest > besteAvstand) { besteAvstand = 1 - nærmest; beste = i; }
  }
  sentre.push(vek[beste]);
}

let tilhør = new Array(vek.length).fill(0);
for (let it = 0; it < ITER; it++) {
  let endret = false;
  for (let i = 0; i < vek.length; i++) {
    let best = 0, bestS = -Infinity;
    for (let k = 0; k < K; k++) {
      const s = dot(vek[i], sentre[k]);
      if (s > bestS) { bestS = s; best = k; }
    }
    if (tilhør[i] !== best) { tilhør[i] = best; endret = true; }
  }
  for (let k = 0; k < K; k++) {
    const med = vek.filter((_, i) => tilhør[i] === k);
    if (!med.length) continue;
    const sum = new Array(med[0].length).fill(0);
    for (const v of med) for (let d = 0; d < v.length; d++) sum[d] += v[d];
    sentre[k] = normaliser(sum);
  }
  if (!endret) break;
}

const alleTekster = korpus.map((s) => s.beskrivelse_anonymisert);
const klynger = Array.from({ length: K }, (_, k) => {
  const saker = korpus.filter((_, i) => tilhør[i] === k);
  const kost = saker.map((s) => s.kostnad).filter((x): x is number => x != null && x > 0);
  const dager = saker.map((s) => s.tid_til_lukking_dager).filter((x): x is number => x != null);
  const sentreSet = new Set(saker.map((s) => s.senter));
  return {
    k, antall: saker.length,
    ord: kjennetegn(saker.map((s) => s.beskrivelse_anonymisert), alleTekster),
    kostMedian: median(kost), kostMin: kost.length ? Math.min(...kost) : 0,
    kostMaks: kost.length ? Math.max(...kost) : 0, medKost: kost.length,
    sumKost: kost.reduce((a, b) => a + b, 0),
    dagerMedian: median(dager), dagerMaks: dager.length ? Math.max(...dager) : 0,
    antSentre: sentreSet.size,
    eksempler: saker.slice(0, 2).map((s) => s.beskrivelse_anonymisert.replace(/\s+/g, ' ').slice(0, 90)),
    losninger: saker.map((s) => s.losning_anonymisert).filter((x): x is string => !!x && x.length > 4)
      .slice(0, 2).map((l) => l.replace(/\s+/g, ' ').slice(0, 70)),
  };
}).sort((a, b) => b.sumKost - a.sumKost);

console.log(`\n${korpus.length} saker gruppert i ${K} klynger (sortert etter total kostnad)\n${'='.repeat(78)}`);
for (const c of klynger) {
  const spredning = c.medKost > 1 && c.kostMin > 0 ? `${(c.kostMaks / c.kostMin).toFixed(1)}×` : '–';
  console.log(`\n▸ ${c.ord.slice(0, 4).join(', ')}`);
  console.log(`  ${c.antall} saker · ${c.antSentre} sentre · ledetid median ${c.dagerMedian} d (maks ${c.dagerMaks})`);
  console.log(`  kostnad: total ${c.sumKost.toLocaleString('nb-NO')} kr · median ${c.kostMedian.toLocaleString('nb-NO')} kr`
    + ` · spenn ${c.kostMin.toLocaleString('nb-NO')}–${c.kostMaks.toLocaleString('nb-NO')} kr (${spredning} spredning, ${c.medKost} m/beløp)`);
  for (const e of c.eksempler) console.log(`    · "${e}…"`);
  if (c.losninger.length) console.log(`    løsning: ${c.losninger[0]}…`);
}

const totalKost = klynger.reduce((a, c) => a + c.sumKost, 0);
const topp3 = klynger.slice(0, 3).reduce((a, c) => a + c.sumKost, 0);
console.log(`\n${'='.repeat(78)}`);
console.log(`Total registrert kostnad: ${totalKost.toLocaleString('nb-NO')} kr`);
console.log(`Topp 3 klynger utgjør: ${Math.round((topp3 / totalKost) * 100)} % av kostnadene`);
console.log(`Saker i klynger med >3× kostnadsspredning: ${klynger.filter(c => c.medKost > 1 && c.kostMin > 0 && c.kostMaks / c.kostMin > 3).reduce((a, c) => a + c.antall, 0)}`);
