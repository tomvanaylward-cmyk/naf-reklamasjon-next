# Mobiloptimalisering av reklamasjonssystemet

**Status:** Idébank — ikke startet
**Lagt inn:** 2026-04-28
**Foreslått av:** Tom Aylward

---

## Idéen

Reklamasjonssystemet er i dag bygget med desktop som referansebrukeropplevelse. Det fungerer på mobil i den grad responsive utility classes (Tailwind) gjør det, men det er ingen reell mobil-først-design. Idéen er å gjøre verktøyet ordentlig optimalisert for mobil — i to lag, med ulik prioritet:

### Lag 1 — Hovedprioritet: kunden som reklamerer

Mest sannsynlige brukerflyt:
- Kunden står på senteret eller har akkurat kjørt fra senteret
- Tar opp telefonen, skanner QR-kode eller klikker en lenke
- Vil rapportere en feil med få trykk, gjerne med foto rett fra kameraet
- Senere svarer hen via signert lenke i e-post — også på mobil

Konkrete grep:
- `/ny-reklamasjon` — fullskjerm-mobil-layout, store touchtargets, stegvis innfylling, kamera-knapp som åpner kamera direkte (ikke filvelger)
- `/svar/[case_id]` — meldingstråd som ligner SMS/Messenger-mønster, mulig å svare med tale-til-tekst
- Drag & drop fjernes til fordel for «Legg til bilde»-knapp som åpner enten kamera eller bibliotek
- Senter-velger med søk (44 sentre i en dropdown er tungt på mobil)
- Lagre kladd i localStorage så de ikke mister utfylt data hvis nettet faller eller de bytter app

### Lag 2 — Sekundær prioritet: de som behandler saker

Mest sannsynlige brukerflyt:
- Senterleder eller reklamasjonsansvarlig får e-postvarsling, åpner i mobil-Mail
- Vil ha rask oversikt og kunne svare/eskalere uten å måtte sette seg ved en PC

Konkrete grep:
- `/saksbehandling` — i dag har den tre-kolonners desktop-layout (sidebar + liste + detaljer). På mobil må dette bli en stack med tilbake-navigering
- Stats-kort, filter-pills og badges må fungere uten å brytes på smale skjermer
- Eskaler/lukk-knapper må være lett tilgjengelige uten dropdowns
- E-postvarslinger må peke til mobiloptimaliserte sider

---

## Hvorfor dette ikke er i drift i dag

1. **Bygget for desktop først.** Saksbehandling er en arbeidsstasjons-applikasjon i hodet — sidebar + liste + detalj-pane forutsetter bredde.
2. **Tailwind-responsivitet er ikke det samme som mobil-først-design.** Klassene `sm:` og `lg:` håndterer breakpoints, men strukturen er fortsatt desktop-strukturen som skrumpes ned.
3. **Kunde-skjemaet ble bygget likt for desktop og mobil.** Fungerer, men er ikke optimalisert.

---

## Hvorfor dette betyr noe

| Argument | Konsekvens |
|---|---|
| **Kundereisen starter ofte på telefonen** | Hvis skjemaet er klønete på mobil, faller noen fra. Reklamasjon kommer da via e-post/telefon i stedet — som er nettopp det vi vil bort fra. |
| **Bilder er kjernen i mange reklamasjoner** | Riper, transportskader, feilmonteringer — alt fotograferes på telefonen. Det skal være ett trykk, ikke fem. |
| **Senterledere har ikke alltid en PC** | Spesielt verksted-rollen. Mobilflyt for å eskalere/respondere er reell tidsbesparelse. |
| **Compliance/sporbarhet henger på faktisk bruk** | Et system som er for tungt på mobil blir omgått (telefon, e-post). Sporbarheten ryker når kanalen er muntlig. |

---

## Signaler som sier «bygg det nå»

| Signal | Terskel |
|---|---|
| Andel innsendinger fra mobile enheter (web analytics) | Hvis > 30 % allerede i dag — bygg nå. Vi vet ikke tallet ennå; må måles. |
| Frafallsrate i `/ny-reklamasjon` på mobil vs. desktop | Hvis mobile sesjoner avbryter signifikant oftere |
| Tilbakemeldinger fra senterledere | «Jeg ville svart om jeg kunne på telefonen» |
| Kvartalsstikkprøve | Reklamasjoner som ble levert via telefon/e-post i stedet for skjema fordi mobilen var for tungvint |

---

## Pakke-skisse (når vi tar det)

**Pakke M1 — Kunde-mobil (1–2 dager):**
- Mobiloptimalisert `/ny-reklamasjon` (stegvis, store knapper, kamera-direkte)
- Mobiloptimalisert `/svar/[case_id]` (meldings-tråd-mønster)
- localStorage-kladd
- Senter-søk i stedet for full dropdown

**Pakke M2 — Saksbehandling-mobil (2–3 dager):**
- Stack-layout for `/saksbehandling` på smale skjermer
- Tilbake-navigering mellom liste og detaljer
- Tilpassede touchvennlige action-knapper for eskaler/lukk/svar
- Validering på alle eksisterende screen-sizes

**Pakke M3 — PWA + offline-kladd (avansert, parkert):**
- Service worker for offline-tilgang til skjema
- Mulighet til å installere som app-ikon på hjemskjerm
- Push-varsel ved nye saker (krever tillatelse)

---

## Avhengigheter / hva som bør være på plass først

- **Pakke C (rapportering)** trenger ikke være ferdig først — uavhengig.
- **Sikkerhets-mini-pakke (RLS-tetting)** bør være ferdig før mobiloptimalisering brukes mye, fordi flere brukere på flere enheter øker angrepsoverflaten.
- **Web analytics** bør være på plass for å måle baseline (mobil-andel, frafall) — uten det vet vi ikke om endringene faktisk hjelper.

---

## Risikoer

| Risiko | Mitigasjon |
|---|---|
| Endrer noe som fungerer på desktop | Visuell regresjonstest manuelt før merge; behold desktop-layout som default på `lg:` breakpoint |
| Kameratilgang krever HTTPS + brukertillatelse | Vi har HTTPS allerede; tillatelse blir et naturlig pop-up |
| Bilder fra mobilkamera er ofte > 10 MB | Klient-side komprimering før upload (canvas + JPEG kvalitet 0.8) |
| Forskjellige iOS/Android-quirks | Test på reelle enheter, ikke bare DevTools simulator |

---

## Estimert kostnad

- Pakke M1 (kunde-mobil): ~1–2 arbeidsdager
- Pakke M2 (saksbehandling-mobil): ~2–3 arbeidsdager
- Pakke M3 (PWA): ~3–5 arbeidsdager (parkert til volum tilsier det)

Totalt for M1+M2: under én ukesverk. Det er den typen ting agentic-utvikling håndterer raskt, og som ville kostet ~150–200 kNOK i tradisjonell konsulent.

---

## Når dette skal vurderes på nytt

- Etter at Pakke C (rapportering) er i drift og vi har mobil-andel-data fra 1 kvartal
- Eller umiddelbart hvis senterleder-feedback eller frafallsrate-data tilsier det
