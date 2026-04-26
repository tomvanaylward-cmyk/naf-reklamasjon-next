# Business case — NAF Reklamasjonssystem

**Målgruppe:** NAFs ledergruppe og styre
**Dato:** 2026-04-25
**Status:** Investering gjennomført, drift ferskt påbegynt
**Forfatter:** Tom Aylward

---

## 1. Sammendrag

NAF har bygget et eget reklamasjonssystem med en samlet investering på **under 200 000 NOK**, for å adressere et område som i dag binder anslagsvis **2,0 mNOK i årlig personalkostnad** og eksponerer organisasjonen for fragmentert saksbehandling og kommende tilsynskrav. Selv en moderat effektivitetsgevinst på 10 % betaler tilbake investeringen på under 12 måneder. Utover ROI demonstrerer prosjektet også en **ny utviklingsmetode** — agentic-utvikling med Claude Code — som NAF kan gjenbruke for fremtidige interne verktøy til en brøkdel av tradisjonell konsulentkostnad.

---

## 2. Problemet

Reklamasjonshåndteringen i NAF har vokst frem organisk over tid, og bærer preg av tre strukturelle svakheter:

1. **Fragmentering på tvers av kanaler.** Klager kommer inn via delt e-postboks, et CRM som ikke er bygget for klagebehandling, og telefon/papir til de enkelte sentrene. Det finnes ingen samlet sannhetsversjon for hvor en sak står.

2. **Distribuert koordineringsbyrde.** Cirka 35 senterledere er involvert i 1–2 reklamasjoner per uke hver, i tillegg til 1–2 saksbehandlere på heltid sentralt. Det utgjør anslagsvis **2,5 årsverk** brukt på reklamasjonsbehandling — hvorav en betydelig del går til koordinering, ikke faktisk saksløsning.

3. **Compliance-eksponering uten hard frist.** GDPR, Forbrukertilsynet og bransjekrav forventer sporbar klagebehandling. NAF har ikke fått pålegg, men har heller ikke kunnet dokumentere komplett behandlingshistorikk på forespørsel. Dette er en proaktiv risikoposisjon, ikke en reaktiv brannslukking — men eksponeringen er reell.

Den utløsende grunnen til prosjektet var **operasjonell smerte som hadde bygget seg over tid**, kombinert med en ledelseserkjennelse av at compliance-posisjonen måtte styrkes før noen krevde det.

---

## 3. Baseline

| Variabel | Anslag | Kilde |
|---|---|---|
| Saksvolum | ~500–2 000 saker/år | Estimat fra fagansvarlig |
| Sentralt team | ~1,5 FTE | Bekreftet |
| Senterleder-tid | ~35 ledere × 1,5 sak/uke × 45 min ≈ 40 t/uke ≈ 1,0 FTE | Anslag, bør valideres |
| **Totalt arbeidsforbruk** | **~2,5 FTE** |  |
| Personalkostnad/år (lastet 800 kNOK/FTE) | **~2,0 mNOK/år** | Beregnet |
| Verktøystøtte før | Delt e-post + Excel + tilpasset CRM + papir | Beskrevet av fagansvarlig |
| Sporbarhet før | Delvis, ikke systematisk | Eksponering ved tilsyn |

Ingen historiske KPI-data eksisterer i strukturert form. Tall for behandlingstid og konsistens må samles fra det nye systemet de første 3–6 månedene og settes som offisiell baseline ved første kvartalsrapport.

---

## 4. Løsningen

NAF har bygget en moderne, EU-hostet web-applikasjon som samler hele reklamasjonsprosessen i én flyt:

- **Saksbehandling med roller og tilgangsstyring** — admin, saksbehandler og senterleder, med radnivå-sikkerhet (RLS) som scoper data per senter. Erstatter delt e-postboks og uformell oversikt.
- **Selvbetjent kundeportal** — kunder svarer på reklamasjonen via en signert lenke uten innlogging, med vedlegg. Erstatter telefon- og papirkanalen og sikrer dokumentert dialog.
- **Vedleggshåndtering** — JPG, PNG og PDF inntil 10 MB, med signerte nedlastings-URLer og RLS. Tidligere håndtert som e-postvedlegg uten kontroll.
- **Sikkerhetsherding** — sikkerhetsheaders i tråd med NAF.no-standarden, distribuert rate-limiting på offentlige endepunkter, security.txt og SECURITY.md klargjort for IT-revisjon.
- **Sporbarhet ut av boksen** — alle handlinger logges, hele saksgangen fra opprettelse til lukking er rekonstruerbar.

Infrastrukturen ligger på Vercel (applikasjon) og Supabase (database og lagring) med dataresidens i Stockholm (EU). Transaksjonell e-post sendes via SendGrid.

---

## 5. Investering vs. status quo

| Post | Beløp | Kommentar |
|---|---|---|
| **Engangsinvestering (utvikling, design, sikkerhetsherding)** | **< 200 000 NOK** | Primært egen tid, lave eksterne kostnader |
| Årlig drift (Vercel + Supabase + SendGrid + Upstash) | ~5 000–15 000 NOK/år | Gradert med volum |
| **Status quo personalkostnad/år** | **~2,0 mNOK/år** | 2,5 FTE × 800k lastet |
| Effektivitetsgevinst som forsvarer investeringen | 10 % (~200 kNOK/år) | Nedre terskel |
| Effektivitetsgevinst ved realistisk ambisjon | 20–25 % (~400–500 kNOK/år) | Plausibelt år 2 |
| **Implisitt payback** | **< 12 måneder ved 10 % gevinst, < 5 måneder ved 25 %** |  |

Tilleggsverdien — kvalitet, konsistens, compliance og kundeopplevelse — er ikke kvantifisert i regnestykket, men reduserer risiko som er vanskelig å prise før den materialiserer seg som tilsynssak eller omdømmehendelse.

---

## 6. Suksesskriterier

Fem KPIer styres etter, kalibreres formelt etter første kvartalsmåling i drift.

| # | KPI | Mål år 1 | Hvordan måles | Driver |
|---|---|---|---|---|
| 1 | Gjennomsnittlig behandlingstid (dager fra opprettet til lukket) | **−30 %** vs. baseline | Systemgenerert | Effektivitet |
| 2 | Saker per FTE per måned | **+20 %** vs. baseline (~33 → ~40) | Systemgenerert | Effektivitet |
| 3 | Konsistens — andel saker hvor svar bygger på mal eller dokumentert begrunnelse | **≥ 80 %** | Manuell kvartalsstikkprøve, n = 30 | Kvalitet |
| 4 | Sporbarhet — andel saker med fullstendig dokumentert tidslinje | **100 %** | Systemgenerert | Compliance |
| 5 | Senterleder-byrde — minutter per uke per senterleder | **−25 %** vs. baseline (~68 → ~50 min) | Lederundersøkelse, halvårlig | Fragmentering |

Baseline for #1, #2 og #5 settes i Q1 etter idriftsettelse. #3 er en ny metrikk uten historisk tall. #4 er allerede oppnådd ved systemets natur.

---

## 7. Bygde-metoden — agentic-utvikling som strategisk evne

> **Hovedbudskap:** Det viktigste resultatet er ikke selve systemet — det er at NAF nå har en repeterbar metode for å bygge interne verktøy raskt og billig.

Reklamasjonssystemet er bygget med **agentic-utvikling**: en arbeidsform der en menneskelig produkteier samarbeider tett med en AI-utviklingspartner (Claude Code) gjennom hele utviklingsløpet — fra idé og spesifikasjon til implementering, testing, sikkerhetsherding og produksjonssetting. Tradisjonell konsulent- eller in-house-utvikling av et tilsvarende system ville krevd 6–12 ukesverk fra et utviklingsteam, til en estimert markedskostnad på **1,5–4 mNOK**. NAF leverte sammenliknbar funksjonalitet for **under 200 kNOK** — en kostnadsreduksjon i størrelsesorden 8–20×.

**Hvorfor dette betyr noe utover dette ene prosjektet:**

- **Repeterbar metode.** De samme arbeidsformene — spec → plan → subagent-drevet implementering — kan gjenbrukes på nye interne verktøy. NAF har nå et bevis på at metoden virker, og en samling spesifikasjons- og plandokumenter som etablerer mønsteret.
- **Senker terskelen for "gode interne verktøy".** Mange interne behov i NAF er for små til å forsvare et tradisjonelt utviklingsprosjekt, men store nok til at folk lager work-arounds i Excel. Med agentic-utvikling flyttes terskelen kraftig nedover, og work-arounds kan erstattes med ordentlige verktøy.
- **Reduserer leverandøravhengighet.** NAF eier kildekoden og driften, og kan endre systemet uten å være avhengig av en konsulent eller leverandør for hver tilpasning.
- **Bygger intern kompetanse.** Produkteier får dyp forståelse av løsningen gjennom hele byggefasen. Kunnskapen ligger i organisasjonen, ikke hos en ekstern leverandør.

**Kandidater for neste runde** (illustrative — ikke prioritert): internt verktøy for medlemskapshåndtering, automatisert klagestatistikk og rapportering, intern kunnskapsbase med søk, leverandøroppfølging.

**Ledelsesvurdering det inviteres til:** Bør NAF formalisere agentic-utvikling som en egen kapabilitet — med dedikert tid, retningslinjer og en porteføljevurdering av hvilke interne verktøy som bør bygges på denne måten?

---

## 8. Anbefaling og neste steg

1. **Godkjenne business caset** som offisielt grunnlag for fortsatt drift og videreutvikling av reklamasjonssystemet.
2. **Sette baseline for KPI #1, #2 og #5** etter første kvartal i full produksjonsbruk; rapportere KPI-status hvert kvartal til ledergruppen.
3. **Vurdere agentic-utvikling som strategisk evne.** Anbefalt nivå-1: avsette tid for å identifisere 2–3 nye interne verktøy hvor metoden kan testes på samme måte. Nivå-2: formell porteføljegjennomgang av interne verktøybehov.
4. **Compliance-validering.** Be IT-sikkerhet om en formell gjennomgang av SECURITY.md mot NAFs eget rammeverk innen Q3 2026, slik at compliance-posisjonen er dokumentert før et eventuelt tilsyn.
5. **Revisitere casen ved Q4 2026** med faktiske KPI-tall, og oppdatere ROI-regnestykket basert på reell drift — ikke estimat.

---

## Vedlegg — Referanser

- `docs/PROSJEKTOVERSIKT.md` — full prosjektoversikt på norsk (levende dokument)
- `docs/PROJECT-STATUS-REPORT.pdf` — McKinsey-stil engelsk statusrapport
- `docs/README.md` — utviklerdokumentasjon
- `docs/SECURITY.md` *(under arbeid)* — sikkerhetsdokumentasjon for IT-revisjon
- `docs/future-work/` — parkerte initiativer og fremtidige beslutninger
