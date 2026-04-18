# Registrering, godkjenning og brukeradministrasjon — Design

**Dato:** 2026-04-18

---

## Mål

Gi senterledere mulighet til å søke om tilgang via en registreringsside. Kun administrator kan godkjenne søknader. Ubehandlede søkere er fullstendig blokkert fra innlogging (ingen auth-konto eksisterer). Adminpanelet utvides med redigering av brukerprofiler (navn, telefon, passord-reset).

---

## Datamodell

### Ny tabell: `pending_registrations`

```sql
CREATE TABLE pending_registrations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name  text NOT NULL,
  email      text NOT NULL UNIQUE,
  senter     text NOT NULL,
  created_at timestamptz DEFAULT now()
);
```

Ingen RLS nødvendig — tabellen leses/skrives kun server-side via service role key.

### Endringer på `profiles`

```sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS status text
  NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'pending'));
```

Eksisterende brukere forblir `'active'`. Kolonnen brukes ikke aktivt i registreringsflyten (auth-kontoen opprettes ikke før godkjenning), men er nyttig for fremtidig bruk.

---

## Arkitektur

### Nye sider

| Side | Rute | Tilgang |
|------|------|---------|
| Registreringsside | `/registrer` | Åpen (ingen auth) |
| Bekreftelsesside | `/registrer/bekreftet` | Åpen |

### Nye API-ruter

| Rute | Beskrivelse |
|------|-------------|
| `POST /api/admin/register` | Lagrer søknad i `pending_registrations`, sender e-post til admins |
| `POST /api/admin/approve-user` | Oppretter auth-konto + profil, sender velkomst-e-post, sletter pending-rad |
| `POST /api/admin/reject-user` | Sletter pending-rad, sender avvisnings-e-post til søker |
| `POST /api/admin/update-user` | Oppdaterer `full_name` og/eller `phone` på eksisterende profil |
| `POST /api/admin/reset-password` | Genererer nytt midlertidig passord, oppdaterer auth-konto, sender e-post |

Alle admin-ruter bruker `SUPABASE_SERVICE_ROLE_KEY` og validerer at innlogget bruker har `role = 'admin'`.

---

## Registreringsflyt (detalj)

### `/registrer` — skjema

Felter:
- Fullt navn (påkrevd)
- E-post (påkrevd, valideres mot eksisterende auth-brukere)
- Passord (påkrevd, min. 8 tegn)
- Bekreft passord
- Senter (påkrevd, dropdown med alle NAF-senterene)

Merknad: Rolle er alltid `senterleder` — senterledere er de eneste som registrerer seg selv. Saksbehandlere og admins opprettes av administrator.

Ved innsending:
1. Klient kaller `POST /api/admin/register` med `{ full_name, email, password_hash_placeholder, senter }`
   - Merk: passordet lagres **ikke** i `pending_registrations`. Det sendes videre til Supabase kun ved godkjenning.
   - Løsning: passordet lagres kryptert (bcrypt) i `pending_registrations.password_hash` — alternativt genererer API nytt passord ved godkjenning og sender det per e-post.
   - **Valgt løsning:** API genererer et tilfeldig midlertidig passord ved godkjenning og sender det til brukeren. Søkeren oppgir e-post og senter i skjemaet — ikke passord.
2. API-ruten setter inn rad i `pending_registrations`
3. API-ruten henter alle admin-e-poster og sender varslings-e-post
4. Klient redirecter til `/registrer/bekreftet`

### `/registrer/bekreftet` — bekreftelsesside

Enkel side:
> "Din søknad er sendt. Du vil få en e-post når en administrator har behandlet den."

Lenke tilbake til `/login`.

---

## Adminpanel — endringer

### Ventende søknader (ny seksjon øverst)

- Skjult når `pending_registrations` er tom
- Rød badge på "Adminpanel"-lenken i Navbar: antall ventende (hentes ved sideload)
- Tabell med kolonner: Navn | E-post | Senter | Dato søkt | Handlinger
- To knapper per rad:
  - ✅ **Godkjenn** → kaller `POST /api/admin/approve-user`
  - ❌ **Avvis** → kaller `POST /api/admin/reject-user` med bekreftelsesdialog

### Brukerredigering (utvidet eksisterende seksjon)

Eksisterende klikk-for-rolle og senter-dropdown beholdes. Ny funksjonalitet:

- Klikk på en brukerrad ekspanderer et inline redigeringspanel under raden
- Redigerbare felt: **Fullt navn**, **Telefonnummer**
- **Tilbakestill passord**-knapp: kaller `POST /api/admin/reset-password` → genererer tilfeldig passord → oppdaterer auth-konto → sender e-post til brukeren med nytt passord
- Lagre-knapp kaller `POST /api/admin/update-user`

---

## E-poster

### 1. Ny søknad → admins
- **Til:** alle profiler med `role = 'admin'`
- **Emne:** `🔔 Ny tilgangsforespørsel – [Navn] ([Senter])`
- **Innhold:** Navn, e-post, senter, tidspunkt, lenke til adminpanelet

### 2. Godkjenning → søker
- **Til:** søkerens e-post
- **Emne:** `✅ Tilgang godkjent – NAF Reklamasjonssystem`
- **Innhold:** Velkomstmelding, midlertidig passord, lenke til `/login`, oppfordring til å bytte passord

### 3. Avvisning → søker
- **Til:** søkerens e-post
- **Emne:** `Din tilgangsforespørsel – NAF Reklamasjonssystem`
- **Innhold:** Nøytral melding om at søknaden ikke ble godkjent, kontaktinfo for spørsmål

### 4. Passord-reset → bruker
- **Til:** brukerens e-post
- **Emne:** `🔑 Nytt midlertidig passord – NAF Reklamasjonssystem`
- **Innhold:** Nytt midlertidig passord, oppfordring til å bytte ved neste innlogging

---

## Navbar-badge

`Navbar`-komponenten mottar en ny prop `pendingCount?: number`. Adminpanel-lenken viser en rød sirkel med tallet hvis `pendingCount > 0`. Hentes i `app/admin/page.tsx` ved sideload og sendes ned som prop.

---

## Sikkerhet

- Alle admin API-ruter validerer at `Authorization`-headeren tilhører en bruker med `role = 'admin'` i `profiles`
- `pending_registrations` er ikke tilgjengelig via anon key (ingen RLS policy = ingen tilgang)
- Midlertidige passord genereres med `crypto.randomBytes(12).toString('base64url')` (16 tegn, URL-safe)
- Passord sendes kun per e-post — lagres aldri i klartekst i databasen

---

## Filer som endres/opprettes

| Fil | Endring |
|-----|---------|
| `app/registrer/page.tsx` | Ny — registreringsskjema |
| `app/registrer/bekreftet/page.tsx` | Ny — bekreftelsesside |
| `app/login/page.tsx` | Legg til "Søk om tilgang"-lenke |
| `app/admin/page.tsx` | Pending-seksjon + inline brukerredigering + badge-prop |
| `components/Navbar.tsx` | `pendingCount` prop + badge på Adminpanel-lenke |
| `app/api/admin/register/route.ts` | Ny API-rute |
| `app/api/admin/approve-user/route.ts` | Ny API-rute |
| `app/api/admin/reject-user/route.ts` | Ny API-rute |
| `app/api/admin/update-user/route.ts` | Ny API-rute |
| `app/api/admin/reset-password/route.ts` | Ny API-rute |
| `app/api/send-email/route.ts` | Nye e-posttyper: `registration_notify`, `registration_approved`, `registration_rejected`, `password_reset` |
| `lib/types.ts` | `Profile` får `phone: string \| null` og `status: 'active' \| 'pending'` |
