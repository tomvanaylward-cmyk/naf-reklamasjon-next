# Pakke A — Senterdata, roller og terminologi

**Dato:** 2026-04-26
**Forfatter:** Tom Aylward (med Claude Code)
**Status:** Spec — klar for implementering
**Estimat:** ~1–1,5 time + 2 SQL-migrasjoner som kjøres i Supabase

---

## 1. Mål

Etablere et solid datafundament for kommende rapportering- og eksport-funksjonalitet (Pakke B og C), samt rette opp en bug i navigasjonen.

Konkret leveres fire ting:

1. **Skjul ikke-eksisterende `/rapportering`-lenke** i navbaren (404-bug).
2. **Sentralisere komplett liste over alle 44 NAF-sentre** ett sted i koden.
3. **Endre intern terminologi** fra `saksbehandler` til `reklamasjonsansvarlig` på alle nivåer (UI, kode, database, RLS, dokumentasjon).
4. **Innføre ny rolle `overordnet`** med samme tilgangsnivå som `admin`.

## 2. Bakgrunn

Etter overlevering av business caset til ledergruppen ble det identifisert tre konkrete behov fra fagansvarlig:

- **Listen over sentre** i registreringsskjema er hardkodet og ufullstendig (10 av 44).
- **Rolle-terminologien** matcher ikke intern språkbruk i NAF — *reklamasjonsansvarlig* er ordet som faktisk brukes i organisasjonen.
- **Mangler en regional/overordnet rolle** for ledere som har ansvar for flere sentre.

I tillegg er `Rapportering`-lenken i navbaren en feil — den peker til en route som ikke eksisterer (`/rapportering` → 404). Denne skjules nå og bygges som del av Pakke C.

## 3. Omfang

### I scope
- Endring av rolle-enum og RLS-policies i Supabase
- Migrering av eksisterende `saksbehandler`-brukere til `reklamasjonsansvarlig`
- Sentralisering av senter-liste (44 sentre)
- UI-tekster, badge-farger, admin-panel, e-postmaler
- Skjuling av `/rapportering`-lenke

### Ikke i scope
- Bygge `/rapportering`-side (Pakke C)
- Senter-filter eller per-senter-eksport (Pakke B)
- Ny logikk for hva `overordnet` skal gjøre annerledes enn `admin`
- Restrukturering av admin-API-et utover å speile rollesjekken

## 4. Designbeslutninger

### 4.1 Senter-navnformat

Bruker prefikset **«NAF Senter <stedsnavn>»** (f.eks. «NAF Senter Alta»). Dette matcher hvordan NAF selv refererer til sentrene utad og i dagens hardkodede liste, og holder dataformatet konsistent med eksisterende `cases.senter`- og `profiles.senter`-rader.

Stedsnavnene følger «Sted»-kolonnen fra NAFs offisielle senterliste — ikke poststedet (f.eks. «Halden», ikke «Berg i Østfold»).

### 4.2 Rolle-modell

```ts
export type UserRole = 'admin' | 'overordnet' | 'reklamasjonsansvarlig' | 'senterleder';
```

| Rolle | Datatilgang | Brukeradministrasjon | Kommentar |
|---|---|---|---|
| `admin` | Alle saker, alle sentre | Ja | Full tilgang |
| `overordnet` | Alle saker, alle sentre | **Ja** | Tilsvarende admin — speiler regional-/seniorlederrolle i NAF |
| `reklamasjonsansvarlig` | Alle saker, alle sentre | Nei | Tidligere `saksbehandler` |
| `senterleder` | Kun eget senter (RLS) | Nei | Uendret |

**Begrunnelse for `overordnet = admin`:** Bruker ønsker en separat etikett uten ny tilgangsmodell. Hvis tilgangsnivåene skal differensieres senere, gjøres det som egen endring.

### 4.3 Terminologi mot kunde

På `app/ny-reklamasjon/page.tsx` (side kunden ser) byttes *«En saksbehandler vil ta kontakt innen 2 virkedager.»* til **«Vi vil ta kontakt innen 2 virkedager.»** Dette holder kundetekstene nøytrale og uavhengige av intern jobbtittel.

### 4.4 Data-migrering

Eksisterende profiler med `role = 'saksbehandler'` migreres til `role = 'reklamasjonsansvarlig'` i samme SQL-transaksjon som CHECK-constraint endres. Ingen brukere får endret tilgang — kun etiketten.

## 5. Komponenter og endringer

### 5.1 Ny fil: `lib/sentre.ts`

```ts
export const NAF_SENTRE = [
  'NAF Senter Alta',         'NAF Senter Arendal',      'NAF Senter Bodø',
  'NAF Senter Drammen',      'NAF Senter Elverum',      'NAF Senter Finnsnes',
  'NAF Senter Fredrikstad',  'NAF Senter Fyllingsdalen','NAF Senter Førde',
  'NAF Senter Gjøvik',       'NAF Senter Halden',       'NAF Senter Hamar',
  'NAF Senter Harstad',      'NAF Senter Haugesund',    'NAF Senter Hvam',
  'NAF Senter Jessheim',     'NAF Senter Knarvik',      'NAF Senter Kongsberg',
  'NAF Senter Kristiansand', 'NAF Senter Kristiansund', 'NAF Senter Larvik',
  'NAF Senter Levanger',     'NAF Senter Lillehammer',  'NAF Senter Lillestrøm',
  'NAF Senter Mastemyr',     'NAF Senter Mo i Rana',    'NAF Senter Molde',
  'NAF Senter Mosjøen',      'NAF Senter Moss',         'NAF Senter Namsos',
  'NAF Senter Narvik',       'NAF Senter Oslo',         'NAF Senter Otta',
  'NAF Senter Sandvika',     'NAF Senter Skien',        'NAF Senter Sortland',
  'NAF Senter Stavanger',    'NAF Senter Steinkjer',    'NAF Senter Stjørdal',
  'NAF Senter Tromsø',       'NAF Senter Trondheim',    'NAF Senter Tønsberg',
  'NAF Senter Ålesund',      'NAF Senter Åsane',
] as const;

export type NafSenter = typeof NAF_SENTRE[number];
```

**Konsumenter:**
- `app/registrer/page.tsx` (erstatter hardkodet 10-liste)
- `app/ny-reklamasjon/page.tsx` (senter-dropdown)
- `app/admin/page.tsx` (senter-tildeling for senterledere)

### 5.2 `lib/types.ts`

```ts
// Før
export type UserRole = 'admin' | 'saksbehandler' | 'senterleder';

// Etter
export type UserRole = 'admin' | 'overordnet' | 'reklamasjonsansvarlig' | 'senterleder';
```

### 5.3 Database-migrasjon (Supabase SQL Editor)

To migrasjoner som kjøres som én transaksjon:

```sql
-- Migrasjon 1: Rolle-enum + datamigrering
BEGIN;

-- Tillat alle fire roller (gammel og ny)
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin','overordnet','reklamasjonsansvarlig','senterleder','saksbehandler'));

-- Migrer eksisterende rader
UPDATE profiles SET role = 'reklamasjonsansvarlig' WHERE role = 'saksbehandler';

-- Strammere CHECK uten gammel rolle
ALTER TABLE profiles DROP CONSTRAINT profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin','overordnet','reklamasjonsansvarlig','senterleder'));

COMMIT;
```

```sql
-- Migrasjon 2: RLS-policies
-- Hver eksisterende policy som refererer 'saksbehandler' eller 'admin' alene
-- må re-droppes og opprettes på nytt med oppdatert rollelist.
-- Konkrete DROP/CREATE-statements ligger i implementeringsplanen og må
-- speile policy-navnene som faktisk finnes i databasen.
```

> **Merk:** Vi har ikke RLS-policy-definisjonene i repoet i dag (de bor i Supabase). Som del av implementeringen henter vi dem ut via Supabase Studio eller `pg_policies`-view, oppdaterer dem, og skriver et komplett migrasjonsskript til `docs/migrations/2026-04-26-roller.sql` slik at vi har sporbarhet fremover.

### 5.4 Kode-endringer (~12 filer)

| Fil | Endring |
|---|---|
| `lib/types.ts` | UserRole-union utvides |
| `lib/admin-api.ts:28` | `role !== 'admin'` → `!['admin','overordnet'].includes(role)` |
| `lib/sentre.ts` | Ny fil |
| `app/admin/page.tsx:24,30,35-36,69` | Labels, badge-farger, role-orden, admin-gate |
| `app/saksbehandling/page.tsx:90,223,561,846` | Erstatte `saksbehandler` |
| `app/api/send-email/route.ts:118,122,130` | `.in('role', [...])`-arrays utvides |
| `app/api/customer-reply/route.ts:88,125` | Samme |
| `app/login/page.tsx:31` | UI-tekst |
| `app/ny-reklamasjon/page.tsx:55-58, 162` | Senter-dropdown bruker `lib/sentre.ts`; kunde-tekst nøytraliseres |
| `app/registrer/page.tsx:7-18` | Senter-liste flyttes til `lib/sentre.ts` |
| `components/Navbar.tsx:23-26` | Skjul `/rapportering`. Utvide `roles`-arrays med `'overordnet'` og `'reklamasjonsansvarlig'` |
| `SECURITY.md:15,61` | Oppdatert rollebeskrivelse |

### 5.5 Admin-panel: ny rolle-toggle

`app/admin/page.tsx` har i dag knapper for å gi/fjerne admin. Utvides til en dropdown med fire valg (admin / overordnet / reklamasjonsansvarlig / senterleder), slik at en superbruker kan endre rolle uten å trenge SQL-tilgang.

## 6. Risikoer og hva som kan gå galt

| Risiko | Sannsynlighet | Konsekvens | Mitigerende tiltak |
|---|---|---|---|
| RLS-policy mister tilgang for `reklamasjonsansvarlig` | Middels | Brukere kan ikke se saker | Migrasjon kjøres i transaksjon. Manuell smoke-test som hver rolle etterpå |
| Eksisterende UI-streng oversett | Lav | Bruker ser «saksbehandler» et sted | Følg sjekkliste fra implementeringsplan; ingen `git grep` på «saksbehandler» skal returnere kode-treff (kun arkiv og historiske docs) |
| `overordnet`-rolle gir for mye tilgang | Lav | Skadelig handling | Designet er `overordnet = admin`. Ingen øket risiko utover det admin-rollen allerede har |
| Senter-navn endres på naf.no senere | Lav | Feilstavet senter-streng | Listen er datert; oppdateres ved behov manuelt — ikke kritisk for systemets funksjon |

## 7. Test- og verifiseringsplan

Etter implementering kjøres manuelt:

1. **Logg inn som admin** → sjekk at navbaren ikke viser «Rapportering»
2. **Admin-panel** → endre en bruker fra `reklamasjonsansvarlig` til `overordnet` og tilbake; bekreft at endringen lagres
3. **Logg inn som `overordnet`** → bekreft at brukeren ser admin-panelet og kan godkjenne nye registreringer
4. **Logg inn som `reklamasjonsansvarlig`** → bekreft at brukeren ser alle sakene men IKKE admin-panelet
5. **Logg inn som `senterleder`** → bekreft at brukeren kun ser eget senter
6. **Ny reklamasjon-skjema** → senterdropdown viser alle 44 sentre; kunde-tekst sier «vi vil ta kontakt», ikke «en saksbehandler»
7. **Registrer-skjema** → senterdropdown viser alle 44 sentre
8. **`git grep "saksbehandler"`** → kun treff i arkiv (`_arkiv/`) og eldre planer/spec-dokumenter — ingen kodetilfeller

## 8. Rollback-strategi

Hvis RLS-migreringen feiler i prod, kan rollen rulles tilbake med:

```sql
BEGIN;
UPDATE profiles SET role = 'saksbehandler' WHERE role = 'reklamasjonsansvarlig';
ALTER TABLE profiles DROP CONSTRAINT profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin','saksbehandler','senterleder'));
COMMIT;
```

Kode-rollback håndteres via `git revert` på commitene i Pakke A. Vercel ruller automatisk tilbake forrige produksjonsbygg ved revert til `main`.

## 9. Vedlegg

- Senterdata-kilde: [NAF senterliste, autolease.no](https://www.autolease.no/media/42fbhjnf/naf-senterliste.pdf) (44 sentre per april 2026)
- Relatert: `docs/superpowers/specs/2026-04-17-feature-gap-skalerbarhet-design.md` (forrige rolle-design)
