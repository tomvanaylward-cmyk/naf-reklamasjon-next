# PDF QA-sjekkliste

Brukes etter at en PDF er generert fra HTML, før den deles eksternt eller med ledelsen.
Tar typisk 5–10 minutter for et 5–10 siders dokument.

---

## Forutsetninger

- `poppler` installert (`brew install poppler`) — gir `pdftoppm`
- HTML-kildefil i `docs/build/<navn>.html`
- PDF generert til `docs/<NAVN>.pdf` via Chrome headless

## Rutine

### 1. Rasteriser hver side til PNG (150 dpi)

```bash
mkdir -p /tmp/pdf-qa
rm -f /tmp/pdf-qa/*.png
pdftoppm -png -r 150 docs/<NAVN>.pdf /tmp/pdf-qa/page
```

### 2. Visuell sjekk per side

Bruk Read-tool på hver `/tmp/pdf-qa/page-N.png` og kontroller:

| Sjekkpunkt | Hva man ser etter |
|---|---|
| **Tekstoverløp** | Ord som krysser kolonnegrenser, går utenfor takeaway-bokser, eller stikker ut i marg |
| **Sideskift** | Ingen overskrift alene nederst (orphan), ingen siste linje av paragraf alene øverst (widow) |
| **Tomrom** | Sider med > 30 % blank plass uten god grunn — som regel en tvunget `page-break` som har ødelagt naturlig flyt |
| **Tabellraster** | Pills, tall og tekst flukter pent. Ingen kolonner som er drastisk smalere enn innholdet |
| **Marger** | Topp-/bunntekst på riktig avstand, sidetall på alle sider unntatt forsiden |
| **Skrifttyper** | Headers og body bruker forventede fonter (sjekk at Google Fonts lastet) |
| **Farger** | Brand-blå #003087 og gull #FFB81C konsistent. Ingen pixelert eller "frosset" gradient |
| **Forsiden** | Eyebrow + tittel + undertittel + footer rendrer på riktig høyde, ingen overlapp med diagonalt hjørne |

### 3. Språksjekk (norsk)

Les hver side med disse i hodet:

- **Genus** på substantiv etter "én/ett/en/et" (f.eks. "rytme" er hankjønn → "én rytme", ikke "ett rytme")
- **Verbal aspekt** — passer dette med tempus i resten av avsnittet
- **Falske venner** fra engelsk: "actually" → ikke "aktuelt"; "eventually" → ikke "eventuelt"
- **Avkortede setninger** — adverb som ender en setning ("...for videre.") klinger ofte ufullstendig
- **Korporat jargong** — "kapabilitet", "revisitere", "single source of truth" — akseptabelt for ledergruppe, ikke for ansatte generelt
- **Konsistens** — bytt aldri midt i dokumentet mellom "saksbehandler" og "case worker", eller mellom "NAF" og "vi"
- **Bindestrek vs tankestrek** — `-` for sammensetninger ("e-postboks"), `–` for tallintervall ("500–2 000"), `—` for parentetiske innskudd

Når du er usikker på et ord eller en formulering: noter det, ikke "fiks det" på instinkt. La en morsmålstaler (NAF-kollega) gå gjennom listen før dokumentet sendes ekstern.

### 4. Vanlige rotårsaker → fix

| Symptom | Sannsynlig årsak | Fix |
|---|---|---|
| Tall/tekst krysser kolonnegrense | `white-space: nowrap` på celle som ikke får plass | Fjern nowrap, eller utvid kolonnen i `colgroup` |
| Halvtom side med innhold dyttet til neste | `section { page-break-inside: avoid }` globalt | Fjern global regel; behold kun på små enheter (tabell, takeaway, grid) |
| Overskrift alene nederst | Mangler `page-break-after: avoid` på h2/h3 | Legg til `h2, h3 { page-break-after: avoid }` |
| Bilde/figur splittes over to sider | `figure` mangler `page-break-inside: avoid` | Legg til regelen på `figure` |
| Norsk æ/ø/å rendres feil | Mangler `<meta charset="UTF-8">` eller `lang="nb"` | Legg til i `<head>` |
| Side- og topptekst vises på forsiden | Mangler `@page :first { ... none }`-regel | Override `@top-left`, `@bottom-right` osv. for første side |

### 5. Regenerer og verifiser

Etter fix:
```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf=docs/<NAVN>.pdf \
  file:///full/path/to/docs/build/<navn>.html

rm -f /tmp/pdf-qa/*.png
pdftoppm -png -r 150 docs/<NAVN>.pdf /tmp/pdf-qa/page
```

Re-sjekk de sidene som hadde funn. Verifiser at fixet ikke har skapt nye problemer andre steder.

---

## Defensive CSS-baseregler

For nye PDF-dokumenter, start med disse i HTML-malen:

```css
@page {
  size: A4;
  margin: 22mm 20mm 22mm 20mm;
  @top-left { content: "..."; }
  @bottom-right { content: "Side " counter(page) " av " counter(pages); }
}
@page :first { margin: 0; @top-left { content: none; } @bottom-right { content: none; } }

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: 'Inter', sans-serif;
  font-size: 10.5pt;
  line-height: 1.55;
  text-rendering: optimizeLegibility;
}

p {
  text-align: justify;
  hyphens: auto;
  -webkit-hyphens: auto;
  orphans: 3;
  widows: 3;
}

h2, h3 { page-break-after: avoid; }

table {
  table-layout: fixed;
  word-wrap: break-word;
  overflow-wrap: break-word;
  page-break-inside: avoid;
}
td { hyphens: auto; word-wrap: break-word; }

.takeaway, .highlight, figure { page-break-inside: avoid; }

/* IKKE bruk white-space: nowrap på tabellceller med ranger eller lange tall */
```

---

## Hva denne sjekklisten ikke fanger

- **Faktiske feil i tall/påstander** — krever at en fagperson leser innholdet
- **Tone for målgruppen** — krever menneskelig vurdering (er dette for stivt for ansatte? for løst for styret?)
- **Strategisk konsistens** — om dokumentet motsier andre offisielle NAF-dokumenter
- **Juridisk presisjon** — krever ekstern juridisk gjennomgang ved eksterne dokumenter
- **Tilgjengelighet (WCAG)** — separat sjekk hvis dokumentet skal publiseres for allmennheten
