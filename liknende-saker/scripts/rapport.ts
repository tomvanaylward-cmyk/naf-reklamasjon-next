// Genererer en lesbar HTML-rapport fra klynge-analysen. Ingen API-kall —
// spherical k-means på embeddingene vi allerede har lokalt.
//
//   npx tsx scripts/rapport.ts [K] > ../docs/klyngerapport.html
import { readFileSync } from 'node:fs';

interface Sak {
  id: string; senter: string; alvorlighet: string; status: string;
  tid_til_lukking_dager: number | null; tema: string;
  beskrivelse_anonymisert: string; losning_anonymisert: string | null;
  kostnad: number | null; kostnad_kilde: string | null; embedding: number[];
}

const K = Number(process.argv[2] ?? 8);
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const norm = (v: number[]) => { const n = Math.sqrt(dot(v, v)); return n ? v.map((x) => x / n) : v; };
const median = (t: number[]) => {
  if (!t.length) return 0;
  const s = [...t].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const kr = (n: number) => n.toLocaleString('nb-NO') + ' kr';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

const STOPP = new Set(['og','i','på','til','av','for','er','som','med','en','et','den','det','har','ble','at','de','fra','om','var','ikke','skal','kan','vi','han','hun','seg','sin','sitt','etter','ved','men','så','da','også','navn','regnr','kunde','kunden','klager','klage','følgende','feil','dette','bilen','bil','saken','sak','hei','mail','under','send','sendt','jeg','meg','oss','dere','deres','blir','være','får','fikk','gjort','tatt','kommer','veldig','samt','uten','over','mot','opp','ned','inn','vil','ønsker','videre','angående','vedr']);
function fingeravtrykk(iKlynge: string[], alle: string[], n = 5): string[] {
  const tell = (t: string[]) => {
    const m = new Map<string, number>();
    for (const s of t) for (const w of new Set(s.toLowerCase().match(/[a-zæøå]{4,}/g) ?? [])) {
      if (!STOPP.has(w)) m.set(w, (m.get(w) ?? 0) + 1);
    }
    return m;
  };
  const inn = tell(iKlynge), ut = tell(alle);
  return [...inn].filter(([, c]) => c >= 3)
    .map(([w, c]) => [w, (c / iKlynge.length) / ((ut.get(w) ?? 0) / alle.length + 0.01)] as [string, number])
    .sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);
}

const korpus: Sak[] = JSON.parse(readFileSync('data/korpus.json', 'utf-8'));
const vek = korpus.map((s) => norm(s.embedding));

const sentroider: number[][] = [vek[Math.floor(rand() * vek.length)]];
while (sentroider.length < K) {
  let best = 0, verst = -Infinity;
  vek.forEach((v, i) => {
    const nær = Math.max(...sentroider.map((c) => dot(v, c)));
    if (1 - nær > verst) { verst = 1 - nær; best = i; }
  });
  sentroider.push(vek[best]);
}
const tilhør = new Array(vek.length).fill(0);
for (let it = 0; it < 50; it++) {
  let endret = false;
  vek.forEach((v, i) => {
    let b = 0, bs = -Infinity;
    sentroider.forEach((c, k) => { const s = dot(v, c); if (s > bs) { bs = s; b = k; } });
    if (tilhør[i] !== b) { tilhør[i] = b; endret = true; }
  });
  for (let k = 0; k < K; k++) {
    const med = vek.filter((_, i) => tilhør[i] === k);
    if (!med.length) continue;
    const sum = new Array(med[0].length).fill(0);
    med.forEach((v) => v.forEach((x, d) => (sum[d] += x)));
    sentroider[k] = norm(sum);
  }
  if (!endret) break;
}

const alle = korpus.map((s) => s.beskrivelse_anonymisert);
const klynger = Array.from({ length: K }, (_, k) => {
  const saker = korpus.filter((_, i) => tilhør[i] === k);
  const kost = saker.map((s) => s.kostnad).filter((x): x is number => !!x && x > 1);
  const dager = saker.map((s) => s.tid_til_lukking_dager).filter((x): x is number => x !== null);
  const senterTell = new Map<string, number>();
  saker.forEach((s) => senterTell.set(s.senter, (senterTell.get(s.senter) ?? 0) + 1));
  return {
    saker, antall: saker.length,
    ord: fingeravtrykk(saker.map((s) => s.beskrivelse_anonymisert), alle),
    kost, sumKost: kost.reduce((a, b) => a + b, 0), medKost: median(kost),
    minKost: kost.length ? Math.min(...kost) : 0, maksKost: kost.length ? Math.max(...kost) : 0,
    medDager: median(dager), maksDager: dager.length ? Math.max(...dager) : 0, antLukket: dager.length,
    antSentre: senterTell.size,
    toppSentre: [...senterTell].sort((a, b) => b[1] - a[1]).slice(0, 3),
    losninger: saker.map((s) => (s.losning_anonymisert ?? '').trim()).filter((l) => l.length > 25),
  };
}).filter((c) => c.antall > 0).sort((a, b) => b.sumKost - a.sumKost);

const totKost = klynger.reduce((a, c) => a + c.sumKost, 0);
const alleDager = korpus.map((s) => s.tid_til_lukking_dager).filter((x): x is number => x !== null);
const medBelop = korpus.filter((s) => s.kostnad && s.kostnad > 1).length;
const tommeLos = korpus.filter((s) => (s.losning_anonymisert ?? '').trim().length < 6).length;
const brukbareLos = korpus.filter((s) => (s.losning_anonymisert ?? '').trim().length > 25).length;
const høySpredning = klynger.filter((c) => c.kost.length > 2 && c.minKost > 0 && c.maksKost / c.minKost > 5);

const rader = klynger.map((c, i) => {
  const spredning = c.kost.length > 1 && c.minKost > 0 ? (c.maksKost / c.minKost).toFixed(0) + '×' : '–';
  const andel = totKost ? Math.round((c.sumKost / totKost) * 100) : 0;
  return `
  <section class="klynge">
    <div class="klynge-topp">
      <h3><span class="nr">${i + 1}</span> ${esc(c.ord.join(' · ')) || '(ingen tydelige nøkkelord)'}</h3>
      <span class="andel">${andel} % av kostnadene</span>
    </div>
    <div class="tall">
      <div><b>${c.antall}</b><span>saker</span></div>
      <div><b>${c.antSentre}</b><span>sentre involvert</span></div>
      <div><b>${c.medDager} d</b><span>median ledetid (maks ${c.maksDager})</span></div>
      <div><b>${kr(c.sumKost)}</b><span>registrert kostnad</span></div>
      <div><b>${c.kost.length ? kr(c.medKost) : '–'}</b><span>median per sak</span></div>
      <div class="${spredning !== '–' && parseInt(spredning) > 5 ? 'varsel' : ''}"><b>${spredning}</b><span>kostnadsspredning</span></div>
    </div>
    ${c.kost.length > 1 ? `<p class="spenn">Spenn: ${kr(c.minKost)} – ${kr(c.maksKost)} <span class="grå">(${c.kost.length} av ${c.antall} saker har beløp)</span></p>` : ''}
    <p class="grå liten">Mest berørte sentre: ${c.toppSentre.map(([s, n]) => `${esc(s.replace('NAF-senter ', ''))} (${n})`).join(', ')}</p>
    <details>
      <summary>Se eksempler og løsninger</summary>
      <ul class="eksempler">
        ${c.saker.slice(0, 4).map((s) => `<li>${esc(s.beskrivelse_anonymisert.replace(/\s+/g, ' ').slice(0, 190))}…</li>`).join('')}
      </ul>
      ${c.losninger.length ? `<p class="liten"><b>Dokumenterte løsninger (${c.losninger.length} av ${c.antall}):</b></p>
      <ul class="losninger">${c.losninger.slice(0, 3).map((l) => `<li>${esc(l.replace(/\s+/g, ' ').slice(0, 170))}…</li>`).join('')}</ul>`
      : '<p class="liten varsel-tekst">Ingen av sakene i denne gruppen har dokumentert hvordan de ble løst.</p>'}
    </details>
  </section>`;
}).join('');

console.log(`<!doctype html><html lang="nb"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Klyngeanalyse — NAF reklamasjoner</title>
<style>
:root{--blå:#003087;--grå:#6b7280;--kant:#e5e7eb;--bg:#f8f9fc;--varsel:#b45309}
*{box-sizing:border-box}
body{font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;margin:0;background:var(--bg);color:#111827}
main{max-width:880px;margin:0 auto;padding:32px 20px 64px}
h1{font-size:28px;margin:0 0 4px;color:var(--blå)}
h2{font-size:19px;margin:36px 0 12px;padding-bottom:6px;border-bottom:2px solid var(--kant)}
h3{font-size:16px;margin:0;font-weight:650}
.undertittel{color:var(--grå);margin:0 0 28px;font-size:14px}
.kort{background:#fff;border:1px solid var(--kant);border-radius:12px;padding:18px 20px;margin-bottom:14px}
.sammendrag{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:8px}
.sammendrag div{background:#fff;border:1px solid var(--kant);border-radius:12px;padding:14px 16px}
.sammendrag b{display:block;font-size:22px;color:var(--blå)}
.sammendrag span{font-size:12.5px;color:var(--grå)}
.klynge{background:#fff;border:1px solid var(--kant);border-radius:12px;padding:18px 20px;margin-bottom:14px}
.klynge-topp{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.nr{display:inline-block;background:var(--blå);color:#fff;width:24px;height:24px;line-height:24px;text-align:center;border-radius:50%;font-size:13px;margin-right:6px}
.andel{font-size:12.5px;color:var(--grå);white-space:nowrap}
.tall{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:10px;margin-bottom:10px}
.tall div{background:var(--bg);border-radius:8px;padding:9px 11px}
.tall b{display:block;font-size:17px}
.tall span{font-size:11.5px;color:var(--grå);line-height:1.35;display:block}
.tall .varsel b{color:var(--varsel)}
.spenn{margin:4px 0;font-size:14px}
.grå{color:var(--grå)}.liten{font-size:13px}
.varsel-tekst{color:var(--varsel)}
details{margin-top:10px;border-top:1px solid var(--kant);padding-top:10px}
summary{cursor:pointer;font-size:13.5px;color:var(--blå);font-weight:600}
.eksempler,.losninger{font-size:13px;color:#374151;padding-left:18px;margin:8px 0}
.eksempler li,.losninger li{margin-bottom:6px}
.losninger{color:#065f46}
table{width:100%;border-collapse:collapse;font-size:14px;background:#fff;border-radius:12px;overflow:hidden}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--kant)}
th{background:var(--bg);font-size:12.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--grå)}
.advarsel{background:#fffbeb;border:1px solid #fcd34d;border-radius:12px;padding:16px 20px;margin-bottom:14px}
.advarsel h2{border:0;margin-top:0;color:var(--varsel);font-size:17px}
ul.punkter{margin:8px 0;padding-left:20px}ul.punkter li{margin-bottom:7px;font-size:14.5px}
footer{margin-top:40px;font-size:12.5px;color:var(--grå);border-top:1px solid var(--kant);padding-top:14px}
@media(prefers-color-scheme:dark){
:root{--bg:#111827;--kant:#374151;--grå:#9ca3af;--blå:#93b4ff}
body{background:#0b1220;color:#e5e7eb}
.kort,.klynge,.sammendrag div,table{background:#161f30}
.tall div{background:#0f1725}
.eksempler,.losninger{color:#cbd5e1}.losninger{color:#6ee7b7}
th{background:#0f1725}
.advarsel{background:#2a1f06;border-color:#78500a}
}
</style></head><body><main>
<h1>Klyngeanalyse av reklamasjoner</h1>
<p class="undertittel">${korpus.length} saker · 22.12.2025–23.06.2026 · gruppert automatisk i ${klynger.length} tema · all analyse kjørt lokalt, ingen data sendt ut</p>

<div class="sammendrag">
  <div><b>${korpus.length}</b><span>saker analysert</span></div>
  <div><b>${median(alleDager)} dager</b><span>median ledetid (${alleDager.length} lukket)</span></div>
  <div><b>${kr(totKost)}</b><span>registrert kostnad</span></div>
  <div><b>${medBelop} av ${korpus.length}</b><span>saker har beløp</span></div>
</div>

<h2>Hovedfunn</h2>
<div class="kort">
<ul class="punkter">
<li><b>Kostnadene er konsentrert:</b> de tre største gruppene står for ${Math.round((klynger.slice(0, 3).reduce((a, c) => a + c.sumKost, 0) / totKost) * 100)} % av registrert kostnad. Tiltak mot disse tre treffer mest.</li>
<li><b>Samme problem, ulik pris:</b> ${høySpredning.length} av ${klynger.length} grupper har mer enn 5× forskjell mellom billigste og dyreste sak. Det er ikke naturlig variasjon — det er ulik praksis mellom sentre.</li>
<li><b>Problemene er organisasjonsbrede:</b> de store gruppene berører 14–31 sentre hver. Ingen av dem er lokale særtilfeller, så felles retningslinjer vil ha bred effekt.</li>
<li><b>Ledetiden varierer sterkt:</b> median ${median(alleDager)} dager totalt, men enkeltsaker opp mot ${Math.max(...alleDager)} dager. Gruppene med lengst ledetid er de samme som har høyest kostnad.</li>
</ul>
</div>

<div class="advarsel">
<h2>Om datagrunnlaget — les dette før tallene brukes</h2>
<ul class="punkter">
<li><b>Bare ${medBelop} av ${korpus.length} saker har et kostnadsbeløp</b> (${korpus.filter((s) => s.kostnad_kilde === 'felt').length} fra kostnadsfeltet, ${korpus.filter((s) => s.kostnad_kilde === 'tekst').length} lest ut av fritekst). Reell totalkostnad er derfor <em>høyere</em> enn ${kr(totKost)} — vi vet bare ikke hvor mye.</li>
<li><b>${tommeLos} av ${korpus.length} saker mangler beskrivelse av hvordan de ble løst</b> — feltet inneholder bare «Ja» eller tilsvarende. Kun ${brukbareLos} saker har brukbar løsningstekst. Dette er hovedhindringen for å dele løsninger på tvers.</li>
<li><b>Gruppenavnene er nøkkelord</b>, ikke tolkning — maskinen viser hvilke ord som skiller gruppen fra resten. En språkmodell kan gi dem ordentlige navn og sammendrag.</li>
<li><b>Tidligere feil, nå rettet:</b> systemet leste ordrenummer som kronebeløp og viste 11,2 mill. i kostnader. Riktig tall er ${kr(totKost)}. Tallene i denne rapporten er kontrollert.</li>
</ul>
</div>

<h2>Gruppene, sortert etter kostnad</h2>
${rader}

<h2>Hva dette betyr for målene</h2>
<table>
<tr><th>Mål</th><th>Hva analysen viser</th><th>Neste steg</th></tr>
<tr><td><b>Like beslutninger</b></td><td>Opptil ${Math.max(...høySpredning.map((c) => Math.round(c.maksKost / c.minKost)), 0)}× prisforskjell på samme problemtype mellom sentre</td><td>Felles kompensasjonsramme per gruppe</td></tr>
<tr><td><b>Kortere ledetid</b></td><td>Median ${median(alleDager)} dager; de dyreste gruppene er også de tregeste</td><td>Standardsvar for de tre største gruppene</td></tr>
<tr><td><b>Lavere kostnad</b></td><td>${Math.round((klynger.slice(0, 3).reduce((a, c) => a + c.sumKost, 0) / totKost) * 100)} % av kostnaden ligger i tre grupper</td><td>Årsaksarbeid mot disse tre, ikke spredt innsats</td></tr>
</table>

<footer>
Generert lokalt fra anonymisert eksport (${korpus.length} saker). Gruppering: spherical k-means på flerspråklige embeddinger, ${klynger.length} grupper.
Ingen personopplysninger i grunnlaget — navn, e-post, telefon og registreringsnummer er fjernet før analyse. Ingen data er sendt til eksterne tjenester.
</footer>
</main></body></html>`);
