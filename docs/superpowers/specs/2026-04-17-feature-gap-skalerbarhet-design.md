# Feature-gap & Skalerbarhet — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Mål:** Gjøre NAF Reklamasjonssystemet klart for 30–40 brukere og 10 saker per dag ved å innføre rollestyring, senter-basert tilgangskontroll, søk, paginering, vedlegg, maler, eskaleringsflyt og rapportering.

**Bakgrunn:** I dag bruker 3–4 saksbehandlere en felles e-postkasse, mens 30 senterledere jobber i e-post og logger saker manuelt i TQM Safir. Det gir lav transparens og dobbeltarbeid. Systemet håndterer i dag færre enn 50 saker og laster alt på én gang — ikke skalerbart ved 3 600+ saker per år.

**Tech stack:** Next.js 16.2.3 App Router, TypeScript, Tailwind CSS v4, Supabase (auth + database + storage), SendGrid

---

## Brukerroller

| Rolle | Tilgang | Kan gjøre |
|---|---|---|
| `senterleder` | Kun eget senters saker | Logge sak, svare kunde, ta beslutning, eskalere til saksbehandler |
| `saksbehandler` | Alle saker fra alle sentre | Alt + tildele saker, overta fra senterleder |
| `admin` | Alt | Alt + administrere brukere, maler, se rapportering |

Roller og sentertilhørighet styres i `profiles`-tabellen. Supabase Row Level Security (RLS) håndhever tilgangen på databasenivå — ikke bare i UI.

---

## Seksjon 1: Rolle- og tilgangsarkitektur

### Databaseendringer

**`profiles`-tabell — nye felt:**
- `role`: `'senterleder' | 'saksbehandler' | 'admin'` (eksisterende felt, utvides)
- `senter`: `text | null` — hvilken NAF-lokasjon senterlederen tilhører (f.eks. `'NAF Senter Oslo'`)

**Supabase RLS-policy for `cases`:**
- `senterleder`: kan kun lese/skrive saker der `cases.senter = profiles.senter`
- `saksbehandler`: kan lese/skrive alle saker
- `admin`: full tilgang

### UI-tilpasning per rolle

- **Senterleder:** ser kun sitt senters saker i sakslisten, ingen tilgang til `/admin` eller `/rapportering`
- **Saksbehandler:** ser alle saker, kan tildele og eskalere
- **Admin:** ser alt inkl. brukeradministrasjon og rapportering

### Eskaleringsflyt

1. Senterleder ser en "Eskaler til saksbehandler"-knapp i saksdetaljvisningen
2. Klikk → saken får status `eskalert`, `assigned_to` tømmes
3. Automatisk e-post sendes til alle saksbehandlere med saksinformasjon
4. Tidslinjeoppføring logges: `"Saken ble eskalert av [senterleder] til saksbehandler"`
5. Saksbehandler tar over saken ved å tildele seg selv

**Ny status i `cases`-tabellen:** `'ny' | 'open' | 'waiting' | 'eskalert' | 'closed'`

---

## Seksjon 2: Søk og paginering

### Problem
Dagens løsning: `db.from('cases').select('*')` — laster alle saker. Ikke brukbart ved 3 600+ saker/år.

### Løsning

**Paginering:**
- Last 25 saker om gangen
- "Last inn flere"-knapp nederst i sakslisten (infinite scroll eller paginering)
- Supabase: `.range(offset, offset + 24)`

**Søk:**
- Søkefelt øverst i sakslisten
- Søker på: `customer_name`, `case_id`, `description`, `company`, `reg_nr`
- Supabase full-text search via `to_tsvector` + `to_tsquery`, eller enkel `ilike`-søk for MVP
- Søk kombineres med eksisterende filterpiller (status-filter)
- Debounce på 300ms for å unngå for mange kall

**Sortering:**
- Standard: nyeste sak øverst
- Saksbehandler kan sortere på SLA-frist, opprettet dato, prioritet

---

## Seksjon 3: Vedlegg

### Brukstilfeller
- Kunde laster opp bilder av skaden ved innmelding (`/ny-reklamasjon`)
- Senterleder / saksbehandler laster opp dokumentasjon i saksdetaljvisningen
- Alle parter kan se vedlegg i tidslinjen

### Teknisk løsning

**Supabase Storage:**
- Bucket: `case-attachments` (privat, kun autentiserte brukere med tilgang til saken)
- Filnavn: `{case_id}/{timestamp}-{original_filename}`
- Støttede formater: JPG, PNG, PDF, HEIC
- Maks størrelse: 10 MB per fil, 5 filer per opplasting

**`attachments`-tabell (ny):**
```sql
id          uuid primary key
case_id     uuid references cases(id)
uploader_id uuid references profiles(id) -- null for kundeopplastinger
file_name   text
file_url    text
file_size   int
mime_type   text
created_at  timestamptz
```

**UI:**
- `/ny-reklamasjon`: opplastingsfelt under beskrivelsesfeltet
- Saksdetaljvisning: klikkbar 📎-knapp i reply-feltet
- Tidslinjen: bilder vises som miniatyrbilder (klikk for fullskjerm), PDF-er som klikkbare lenker med ikon

---

## Seksjon 4: Maler og hurtigsvar

### Formål
Sikre konsistente kundesvar på tvers av 30 senterledere.

### `templates`-tabell (ny):
```sql
id          uuid primary key
name        text        -- f.eks. "Godkjent reklamasjon – Dekkskifte"
category    text        -- matcher KATEGORIER-listen, eller null for generelle
body        text        -- maltekst med variabler
created_by  uuid references profiles(id)
created_at  timestamptz
```

**Støttede variabler i maltekst:**
- `{{customer_name}}` — erstattes med kundens navn
- `{{case_id}}` — erstattes med saksnummer
- `{{senter}}` — erstattes med senterets navn

**UI:**
- Admin: `/admin` har fane for å opprette/redigere/slette maler
- Saksbehandler/senterleder: dropdown "Velg mal" over svarfeltet i saksdetaljvisningen
- Valgt mal fylles inn i svarfeltet med variabler erstattet, kan redigeres fritt før sending

---

## Seksjon 5: Rapportering

### `/rapportering`-side (kun admin og saksbehandler)

**Admin ser (alle sentre):**
- Antall saker per senter — siste 30 / 90 dager
- Gjennomsnittlig behandlingstid per senter
- SLA-overholdelse i prosent per senter
- Topp 3 kategorier med flest reklamasjoner
- Utfallsfordeling (godkjent / delvis / avvist / henlagt)

**Senterleder ser (kun eget senter):**
- Egne åpne saker og SLA-status
- Antall saker siste 30 dager
- Gjennomsnittlig behandlingstid

**Teknisk:**
- Supabase-spørringer med `group by` og aggregeringsfunksjoner
- Enkle CSS-baserte stolpediagrammer (ingen ekstern chart-bibliotek for MVP)
- Data oppdateres ved sideinnlasting (ingen realtime nødvendig for rapportering)

---

## Implementeringsrekkefølge

| Prioritet | Funksjon | Avhengighet |
|---|---|---|
| 1 | Roller + RLS + senter-filtrering | Ingen |
| 2 | Eskaleringsflyt | Krever roller |
| 3 | Søk + paginering | Ingen |
| 4 | Vedlegg | Ingen |
| 5 | Maler | Ingen |
| 6 | Rapportering | Krever roller |

---

## Utenfor scope (denne spec)

- ML-modell for beslutningsstøtte (egen spec)
- Kundeportal for sakssporing
- Integrasjon med TQM Safir
- Native mobilapp
- Multikanal-inntak (SMS, telefon)
