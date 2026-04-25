---
title: "NAF Reklamasjonssystem — Prosjektoversikt"
subtitle: "Levende dokument · oppdatert 25. april 2026"
author: "Tom Aylward"
lang: nb
---

# NAF Reklamasjonssystem — Prosjektoversikt

> **Hva dette dokumentet er:** Et personlig referansedokument for å holde oversikt over hva som er bygget, hvilke ideer som er parkert, hvilke risikoer som ligger foran oss, og hvilke muligheter som finnes. Markdown-versjonen i `docs/PROSJEKTOVERSIKT.md` er kilden — Word/PDF-eksport genereres ved behov.

---

## 1. Prosjektoversikt

### Hva er dette?

NAF Reklamasjonssystem er et nettbasert verktøy for å motta, behandle og besvare klager og reklamasjoner fra NAFs kunder. Verktøyet gir kundene mulighet til å sende inn klager og svare på oppfølgingsspørsmål uten å logge inn, samtidig som NAFs saksbehandlere får en strukturert plattform for å håndtere sakene.

### Hvem bruker det?

| Rolle | Hva de gjør |
|-------|-------------|
| Kunde | Sender inn reklamasjon og svarer via lenke i e-post |
| Saksbehandler | Behandler saker tilhørende eget senter, sender svar, laster opp vedlegg |
| Senterleder | Ser oversikt over saker i eget senter |
| Administrator | Godkjenner nye saksbehandlere, ser alle saker, eksporterer rapporter |

### Hvor er det?

Produksjon: <https://naf-reklamasjon-next.vercel.app>

Verktøyet ligger på Vercel-domenet fordi NAF-subdomene ikke er tilgjengelig per i dag.

---

## 2. Arkitektur og teknologi

### Tech-stack

| Lag | Teknologi |
|-----|-----------|
| Frontend & backend | Next.js 16 (App Router) i TypeScript, React Server Components |
| Database | Supabase PostgreSQL (Stockholm, EU) med Row Level Security |
| Autentisering | Supabase Auth (JWT i httpOnly cookies) |
| Fillagring | Supabase Storage (signerte URL-er, 60 min utløp) |
| E-post | SendGrid (transaksjonelle e-poster) |
| Rate limiting | Upstash Redis (sliding window) |
| Hosting | Vercel (auto-deploy fra `main`) |
| Excel-eksport | ExcelJS (erstattet `xlsx` pga. sikkerhetshull) |

### Arkitekturprinsipper

- **Database-håndhevet sikkerhet** — Row Level Security (RLS) i Supabase sørger for at saksbehandlere kun ser saker fra eget senter. Dette gjelder selv om det skulle være feil i applikasjonskoden.
- **Service-rolle aldri eksponert** — Supabase service-role key brukes kun server-side (i `adminDb`), aldri sendt til nettleseren.
- **Server-first** — så mye logikk som mulig kjøres på server (RSC), ikke i nettleseren. Sikrere og raskere.
- **Token-basert tilgang for kunder** — kunder bruker UUID-tokens i URL-er for å svare på saker uten innlogging. Validering med timing-trygg sammenligning.

---

## 3. Funksjoner som er bygget

### 3.1 Roller, RLS og eskalering

Grunnmuren i saksbehandlingen. Tre rollenivåer:

```
admin → saksbehandler → senterleder
```

Hver saksbehandler ser kun saker som hører til eget senter — håndhevet på databasenivå via Supabase RLS-policies. Inkluderer søk, paginering, eskaleringsvarsler, svar-maler og enkel rapportering.

### 3.2 Brukerregistrering og admin

Selvbetjent registrering for nye saksbehandlere med **godkjenningstrinn**: nye brukere registrerer seg og venter; en administrator godkjenner eller avviser via `/admin`. Inkluderer e-postvarsler ved godkjenning/avvisning og en full administrasjonsside.

### 3.3 Filvedlegg

Kunder og saksbehandlere kan laste opp **JPG, PNG og PDF** (maks 10 MB per fil, maks 5 per opplasting). Filer lagres i Supabase Storage. Saksbehandlere får tilgang via signerte 60-minutters nedlastings-URL-er. RLS-policies sørger for at brukere kun ser vedlegg de har rett til.

### 3.4 Kunde-svarportal

Utgående e-post fra saksbehandler inkluderer en **"Svar på reklamasjonen →"**-knapp som lenker til en åpen portal (`/svar/[case_id]?token=UUID`). Kunden kan skrive svar og legge ved fil **uten å logge inn**. Svaret vises i sak-tidslinjen i sanntid og trigger en e-postvarsel til ansvarlig saksbehandler. Token valideres på serveren med timing-trygg sammenligning for å hindre tidsbaserte angrep.

### 3.5 Sikkerhetsherding

Komplett sikkerhetsherding etter NAF.no-standard, klart for IT-sikkerhetsvurdering:

- **Sikkerhets-headere** — CSP, HSTS (2 år + preload), X-Frame-Options DENY, X-Content-Type-Options, Referrer-Policy, COOP, CORP, Permissions-Policy. Verifisert i produksjon.
- **Distribuert rate limiting** — Upstash Redis med sliding window på tre offentlige endepunkter:
  - Kundesvar: 5 forespørsler / 10 min
  - Filopplasting: 10 forespørsler / 10 min
  - Ny reklamasjon: 3 forespørsler / time
- **Avhengighetsrevisjon** — sårbar `xlsx`-pakke (HØY CVE) erstattet med `exceljs`. To moderate CVE-er i transitive avhengigheter er dokumentert og akseptert.
- **`security.txt`** — tilgjengelig på `/.well-known/security.txt` for ansvarlig avsløring.
- **`SECURITY.md`** — omfattende åtteseksjons-dokument (dataoversikt, leverandører, autentisering, sikkerhetstiltak, kjente begrensninger, full avhengighetsrevisjon) klar for IT-vurdering.

---

## 4. Sikkerhetsposisjon

### Implementerte tiltak

| Lag | Tiltak |
|-----|--------|
| Transport | HTTPS overalt, HSTS 2 år, automatisk oppgradering av usikre forespørsler |
| Headere | Full CSP uten wildcards, X-Frame-Options DENY, COOP, CORP, Permissions-Policy |
| Auth | Supabase JWT i httpOnly cookies, ingen lokal lagring av tokens |
| Autorisasjon | RLS på alle tabeller, senterskoping for saksbehandlere |
| Rate limiting | Upstash Redis distribuert teller, fail-open ved Redis-utfall |
| Inputvalidering | Lengdebegrensning, filtype/-størrelse, HTML-escaping i e-post |
| Fillagring | Signerte URL-er med 60 min utløp, RLS på `attachments`-tabellen |
| Token-tilgang | UUID-tokens (122-bit entropi), timing-trygg sammenligning |
| Avhengigheter | `npm audit` ren for HØY/KRITISK, dokumenterte aksepterte moderate CVE-er |

### Karakter på securityheaders.com

Forventet: **A**. A+ krever nonce-basert CSP (uten `unsafe-inline`) — dokumentert som fremtidig forbedring i `SECURITY.md`.

### Det vi ikke har (og hvorfor)

- **NAF-subdomene** — ikke tilgjengelig per i dag; verktøyet ligger på `*.vercel.app`
- **WAF (web application firewall)** — vi støtter oss på Vercels plattform-beskyttelse
- **Nonce-basert CSP** — krever nonce-injeksjon i middleware, fremtidig forbedring

---

## 5. Parkerte ideer (fremtidig arbeid)

Disse er dokumentert i `docs/future-work/`. Hver fil sier hva som ble bestemt, hvorfor det ble parkert, og hva som trigger en gjenåpning.

### 5.1 Lignende saker via vektorsøk

**Hva:** Når saksbehandler åpner en sak, vis tre tidligere løste saker som er semantisk like — basert på meningen i teksten, ikke bare nøkkelord. Hver match viser klagen og NAFs svar, med "Kopier svar"-knapp.

**Hvorfor parkert:**
1. For få løste saker per i dag — vektorsøk trenger dybde i korpuset (~200+ saker)
2. Svar-maler dekker allerede gjentakende saker
3. Bruker kanskje ikke skrive-svar som er flaskehalsen
4. Krever OpenAI som fjerde leverandør (DPA, IT-vurdering)

**Når vi tar opp igjen:** Når antallet løste saker passerer ~200, og/eller saksbehandlere rapporterer at de "vet vi har sett dette før, men finner det ikke".

### 5.2 Lettvekts nøkkelordssøk (steget før vektorsøk)

**Hva:** Søkelinje over tidligere løste saker etter nøkkelord, merke, kategori. 60 % av verdien til vektorsøket, 10 % av kostnaden.

**Status:** Diskutert som naturlig stegestein — bygger korpus og muskel i påvente av vektorsøk. Ikke startet implementering.

### 5.3 Distribusjonsmiljøer (staging)

**Hva:** Per i dag har vi kun "Level 1" — Vercels preview-URL-er for kode, men felles produksjonsdatabase. Reell isolasjon krever Supabase Branching (Level 2) som krever Supabase Pro.

**Status:** Holder oss på Level 1 inntil videre. Oppgraderer ved første betydelige databaseendring eller når flere utviklere blir med.

### 5.4 Tilgangskontrollrevisjon (Sub-prosjekt 2 av sikkerhet)

**Hva:** Verifiser at alle RLS-policies faktisk håndheves end-to-end i produksjon, legg til admin-revisjonslogg.

**Status:** Klar til å starte når sikkerhetsherding er sluttført. Neste naturlige steg.

### 5.5 GDPR / databehandling (Sub-prosjekt 3 av sikkerhet)

**Hva:** Datalokasjon-bekreftelse, oppbevarings- og slettepolicy, DPA-er med Supabase/Vercel/SendGrid, personvernerklæring for kunder.

**Status:** Påkrevd for IT-vurdering. Bør gjøres etter eller parallelt med Sub-prosjekt 2.

---

## 6. Risiko og tiltak

| Risiko | Sannsynlighet | Konsekvens | Tiltak |
|--------|--------------|------------|--------|
| Supabase free-tier pauser etter 7 dager uten aktivitet | Høy ved lav bruk | Tjeneste utilgjengelig | Oppgrader til Pro når aktiv bruk starter |
| Storage-grense (1 GB) på free-tier nås | Middels på sikt | Vedlegg-opplasting feiler | Oppgrader til Pro; sett opp slettepolicy for gamle vedlegg |
| OpenAI / fjerde leverandør i sikkerhetsbildet | N/A nå (parkert) | Ekstra DPA / IT-vurdering | Vurderes igjen når vektorsøk åpnes |
| DB-migrasjon i produksjon låser tabell | Middels | Korte tjenestebrudd | Bruk `CREATE INDEX CONCURRENTLY`, kjør utenfor kontortid, ta backup |
| Endringer pushes direkte til main uten gjennomgang | Lav nå (vane), middels | Bug treffer kunder | Branch + preview-URL + PR fra nå av (ny rutine) |
| `vercel.app`-domene oppfattes som useriøst | Middels | Reduserer kundetillit | Vurder NAF-subdomene igjen senere; kommunikasjon i e-post hjelper |
| SendGrid bounce-rate øker | Lav | E-postlevering forverres | Overvåk; sjekk SPF/DKIM ved spike |
| `unsafe-inline` i CSP utnyttes | Lav | XSS hvis annen sårbarhet finnes | Oppgrader til nonce-basert CSP når mulig |
| Avhengighet får ny KRITISK CVE | Middels | Sårbar produksjon | Månedlig `npm audit`; abonner på GitHub Dependabot |
| Vedlegg inneholder skadelig fil | Lav (JPG/PNG/PDF + størrelse) | Begrenset av filtypevalidering | Vurder antivirus-skanning ved volum |
| Tap av enkelt utvikler (bus-factor) | Høy | Ingen som kan vedlikeholde | Dokumentasjon (dette dokumentet, README, SECURITY.md) reduserer dette |
| Kunde sender PII i klagebeskrivelsen vi ikke ber om | Høy | Lagrer mer PII enn nødvendig | Personvernerklæring; kort oppbevaringspolicy; minimering ved analyse |

---

## 7. Muligheter / neste steg

I omtrentlig prioritert rekkefølge:

### Klart neste steg

1. **Tilgangskontrollrevisjon** *(2 dager)* — verifiser RLS, legg til revisjonslogg. Lukker IT-sikkerhets-løkken.
2. **GDPR-dokumentasjon** *(2–3 dager)* — DPA-er, oppbevaringspolicy, personvernerklæring. Kreves for IT-vurdering.
3. **Lettvekts nøkkelordssøk** *(1–2 dager)* — bygger korpus og muskel for senere vektorsøk.

### Når aktiv bruk starter

4. **Supabase Pro-oppgradering** *(~25 USD/mnd)* — fjerner pause-risiko, gir Branching, øker storage.
5. **Branch + preview + PR-rutine** — null-kost prosess-endring som forhindrer 95 % av "ai-nei"-øyeblikk.

### Lengre fram

6. **Vektorsøk over løste saker** *(3–4 dager)* — når korpuset passerer ~200 saker.
7. **Nonce-basert CSP** *(1 dag)* — gir A+ på securityheaders.com.
8. **NAF-subdomene** — krever IT-koordinering på NAF-siden, men styrker kundetillit.
9. **WAF / DDoS-beskyttelse** — vurderes når trafikk og angrepsoverflate vokser.
10. **Eksplisitt "lignende sak"-signal ved løsning** — saksbehandler huker av "denne lignet på sak X" — gir hard data på hvor ofte saker faktisk gjentar seg.

### Drømmeliste / langt fram

11. **AI-utkast til svar** *(RAG)* — bygger på vektorsøk + LLM, foreslår utkast til svar saksbehandler kan redigere.
12. **Kunde-status-side** — kunde kan se status på egen sak uten å vente på e-post.
13. **Senterleder-dashboard** — saksantall, gjennomsnittlig svartid, eskaleringer.
14. **Integrasjon mot NAF medlemsdatabase** — slå opp medlem direkte i saksbildet.

---

## 8. Åpne spørsmål og beslutninger

| Spørsmål | Status |
|----------|--------|
| Skal vi få NAF-subdomene? | Ikke mulig per i dag; revurderes ved IT-koordinering |
| Skal vi gå for Supabase Pro nå eller vente? | Vente til aktiv bruk eller første DB-endring |
| Hvor lenge skal saker oppbevares? | Åpent — del av GDPR-arbeidet |
| Hvem signerer DPA-er med Supabase/Vercel/SendGrid? | Åpent — del av GDPR-arbeidet |
| Skal vi bruke `staging`-miljø? | Nei, holder oss på preview-URL-er nå |
| Skal vi sende reklamasjons-bekreftelse på SMS i tillegg til e-post? | Ikke vurdert |
| Når skal vi gå til IT-sikkerhetsvurdering? | Etter Sub-prosjekt 2 og 3 er ferdig |
| Skal kunden kunne laste ned hele saken som PDF? | Ikke vurdert |

---

## 9. Leverandører og kostnader

### Leverandører i bruk

| Leverandør | Rolle | Kostnad i dag | Bemerkninger |
|------------|-------|---------------|--------------|
| Vercel | Hosting, serverless funksjoner, preview-URL-er | Hobby (gratis) | Auto-deploy fra `main` |
| Supabase | PostgreSQL, Auth, Storage | Free | Stockholm-region; 1 GB storage; pauser etter 7 dager idle |
| SendGrid | Transaksjonell e-post | Free (100 e-post/dag) | Holder for nåværende skala |
| Upstash | Redis for rate limiting | Free (10 000 forespørsler/dag) | EU-region |

### Forventede kostnader ved oppgradering

| Trigger | Tjeneste | Plan | Kostnad |
|---------|----------|------|---------|
| Aktiv bruk / DB-endringer | Supabase Pro | $25/mnd | Inkluderer Branching, mer storage, ingen pause |
| > 100 e-post/dag | SendGrid Essentials | Fra ~$20/mnd | Ved vekst |
| Vektorsøk åpnes | OpenAI embeddings | ~$0,10 én gang for backfill, deretter < $1/mnd | Når funksjonen bygges |
| Høyt trafikkvolum | Vercel Pro | $20/mnd per medlem | Ved teamvekst eller volum |

### Total løpende kostnad i dag

**0 NOK / 0 USD per måned.** Alt på free-tier.

### Estimert løpende kostnad ved aktiv bruk (alle planlagte oppgraderinger)

**~50–70 USD/mnd** — Supabase Pro + Vercel Pro + SendGrid Essentials. Skalerer langsomt med volum.

---

## 10. Hvordan dette dokumentet holdes oppdatert

- **Kilde:** `docs/PROSJEKTOVERSIKT.md` i Git-repoet — versjonert, sporbar
- **Eksport:** Word/PDF genereres ved behov via `pandoc docs/PROSJEKTOVERSIKT.md -o ut.docx`
- **Oppdater når:** ny funksjon ferdig, ny risiko identifisert, beslutning tatt om åpne spørsmål, ny leverandør/kostnad
- **Eier:** Tom Aylward

---

*Generert 25. april 2026. Hvis du leser en eksportert PDF/Word, sjekk Markdown-versjonen i repoet for siste oppdateringer.*
