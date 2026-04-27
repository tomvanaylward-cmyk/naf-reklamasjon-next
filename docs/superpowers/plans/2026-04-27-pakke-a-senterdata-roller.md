# Pakke A — Implementeringsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Etablere komplett senter-liste, ny rolle `overordnet`, terminologi-bytte `saksbehandler` → `reklamasjonsansvarlig`, og skjule brutt `/rapportering`-lenke.

**Architecture:** Kodebasen er Next.js 15 (App Router) + Supabase. Endringene er konsentrert i `lib/`, `app/`, `components/`, og krever to SQL-migrasjoner som kjøres manuelt i Supabase Studio. Ingen tester finnes i prosjektet — verifisering skjer via TypeScript-kompilering, `next build`, og manuell smoke-test mot prod.

**Tech Stack:** TypeScript, Next.js 15 App Router, Supabase (Postgres + Auth + RLS), TailwindCSS.

**Spec:** `docs/superpowers/specs/2026-04-26-pakke-a-senterdata-roller-design.md`

---

## File Structure

| Status | Sti | Ansvar |
|---|---|---|
| Ny | `lib/sentre.ts` | Eneste kilde for de 44 NAF-sentrene |
| Ny | `docs/migrations/2026-04-27-pakke-a-roller.sql` | DB-migrasjon — kjøres i Supabase Studio |
| Modifiseres | `lib/types.ts` | Utvider `UserRole`-union med `overordnet` og `reklamasjonsansvarlig` |
| Modifiseres | `lib/admin-api.ts` | Admin-gate aksepterer både `admin` og `overordnet` |
| Modifiseres | `components/Navbar.tsx` | Skjul `/rapportering`. Utvide `roles`-arrays |
| Modifiseres | `app/admin/page.tsx` | Dropdown for rolle (4 valg), labels og badge-farger oppdatert |
| Modifiseres | `app/saksbehandling/page.tsx` | Tekst og rollesjekk oppdatert |
| Modifiseres | `app/ny-reklamasjon/page.tsx` | Senter-dropdown via `lib/sentre`. Nøytral kunde-tekst |
| Modifiseres | `app/registrer/page.tsx` | Senter-dropdown via `lib/sentre` |
| Modifiseres | `app/login/page.tsx` | UI-tekst oppdatert |
| Modifiseres | `app/api/send-email/route.ts` | `.in('role', ...)` og `.eq('role', 'admin')` utvides |
| Modifiseres | `app/api/customer-reply/route.ts` | `.in('role', ...)` utvides |
| Modifiseres | `SECURITY.md` | Oppdatert rolle-tabell |

---

### Task 1: Skjul Rapportering-lenken

**Files:**
- Modify: `components/Navbar.tsx`

- [ ] **Step 1: Fjern Rapportering-linje**

I `components/Navbar.tsx`, slett linje 25:

```tsx
{ href: '/rapportering',   label: 'Rapportering',   roles: ['admin', 'saksbehandler'] },
```

Resultatet skal være at `links`-arrayet inneholder fire elementer (Dashboard, Saksbehandling, Eksport, Adminpanel) — ikke fem.

- [ ] **Step 2: Verifiser**

Kjør:
```bash
npx tsc --noEmit
```
Forventet: ingen feil.

- [ ] **Step 3: Commit**

```bash
git add components/Navbar.tsx
git commit -m "fix: skjul Rapportering-lenke (404 — bygges i Pakke C)"
```

---

### Task 2: Opprett `lib/sentre.ts`

**Files:**
- Create: `lib/sentre.ts`

- [ ] **Step 1: Lag fila**

```ts
// lib/sentre.ts
//
// Komplett liste over NAF-sentre. Kilde:
// https://www.autolease.no/media/42fbhjnf/naf-senterliste.pdf (per april 2026, 44 sentre)
//
// Brukes som eneste kilde i registrerings-skjema, ny-reklamasjon-skjema, og adminpanel.
// Nye sentre legges inn alfabetisk her.

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

- [ ] **Step 2: Erstatt hardkodet liste i `app/registrer/page.tsx`**

Slett linjene 7-18 (hele `const SENTRE = [...]`-blokken) og legg til ny import like under linje 5:

```tsx
import { NAF_SENTRE } from '@/lib/sentre';
```

Søk og erstatt deretter alle referanser til `SENTRE` med `NAF_SENTRE` i samme fil.

- [ ] **Step 3: Erstatt hardkodet liste i `app/admin/page.tsx`**

Slett linjene 9-20 (hele `const SENTRE = [...]`-blokken) og legg til ny import etter linje 6:

```tsx
import { NAF_SENTRE } from '@/lib/sentre';
```

Erstatt referanser til `SENTRE` med `NAF_SENTRE` i samme fil.

- [ ] **Step 4: Sørg for at ny-reklamasjon bruker fellesliste**

Sjekk `app/ny-reklamasjon/page.tsx`. Hvis siden har en hardkodet `SENTRE`-liste eller et `<select>` for senter, oppdater til:

```tsx
import { NAF_SENTRE } from '@/lib/sentre';
```

og bruk `NAF_SENTRE.map(...)` der listen rendres. Hvis siden ikke har en senter-dropdown, hopp over dette steget.

- [ ] **Step 5: Verifiser**

```bash
npx tsc --noEmit
```
Forventet: ingen feil.

- [ ] **Step 6: Commit**

```bash
git add lib/sentre.ts app/registrer/page.tsx app/admin/page.tsx app/ny-reklamasjon/page.tsx
git commit -m "feat: sentralisere NAF-senter-liste (44 sentre) i lib/sentre.ts"
```

---

### Task 3: Skriv DB-migrasjons-SQL (lagres som fil, kjøres senere)

**Files:**
- Create: `docs/migrations/2026-04-27-pakke-a-roller.sql`

- [ ] **Step 1: Opprett migrasjons-fil**

Lag mappen hvis den ikke finnes:
```bash
mkdir -p docs/migrations
```

Skriv `docs/migrations/2026-04-27-pakke-a-roller.sql`:

```sql
-- Migrasjon: Pakke A — rolle-modell og terminologi
-- Dato: 2026-04-27
-- Kjøres i Supabase SQL Editor av admin etter at Vercel-deploy er bekreftet.
--
-- Endringer:
--   1. Tillater nye roller: 'overordnet' og 'reklamasjonsansvarlig'
--   2. Migrerer eksisterende 'saksbehandler' → 'reklamasjonsansvarlig'
--   3. Strammer CHECK-constraint til de fire endelige rollene

BEGIN;

-- Steg 1: Tillat alle gamle og nye roller midlertidig
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin','overordnet','reklamasjonsansvarlig','senterleder','saksbehandler'));

-- Steg 2: Migrer eksisterende rader
UPDATE profiles SET role = 'reklamasjonsansvarlig' WHERE role = 'saksbehandler';

-- Steg 3: Stramme CHECK-constraint til de endelige fire rollene
ALTER TABLE profiles DROP CONSTRAINT profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin','overordnet','reklamasjonsansvarlig','senterleder'));

COMMIT;

-- ============================================================
-- RLS-POLICIES — fylles ut etter at vi har dumpet aktuelle policies
-- via følgende query i Supabase SQL Editor:
--
--   SELECT schemaname, tablename, policyname, cmd, qual, with_check
--   FROM pg_policies
--   WHERE schemaname = 'public'
--   ORDER BY tablename, policyname;
--
-- For hver policy som refererer 'saksbehandler' eller 'admin' alene:
--   1. DROP POLICY <name> ON <table>;
--   2. CREATE POLICY <name> ON <table> ... USING (...) med ny rollelist
--      som inkluderer 'reklamasjonsansvarlig' og 'overordnet'.
-- ============================================================
```

- [ ] **Step 2: Commit**

```bash
git add docs/migrations/2026-04-27-pakke-a-roller.sql
git commit -m "chore: DB-migrasjon for Pakke A roller (kjøres manuelt i Supabase)"
```

> **MERK:** Selve kjøringen i Supabase utsettes til Task 13. Filen er bare lagret som dokumentasjon nå.

---

### Task 4: Utvid `UserRole`-type

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Endre union-typen**

I `lib/types.ts` linje 5, erstatt:

```ts
export type UserRole = 'admin' | 'saksbehandler' | 'senterleder';
```

med:

```ts
export type UserRole = 'admin' | 'overordnet' | 'reklamasjonsansvarlig' | 'senterleder';
```

- [ ] **Step 2: Verifiser at TypeScript fanger alle berørte filer**

```bash
npx tsc --noEmit
```

Forventet: en rekke feil i `app/admin/page.tsx`, `app/saksbehandling/page.tsx`, `components/Navbar.tsx` osv. der `UserRole` brukes som key i objekt eller union i string-likhet. Disse fikses i de neste task'ene — ikke commit ennå.

- [ ] **Step 3: Ikke commit ennå**

Vi venter til Task 5–9 har fikset alle fallout-feilene før commit.

---

### Task 5: Admin-gate — `lib/admin-api.ts` og `app/admin/page.tsx`

**Files:**
- Modify: `lib/admin-api.ts`
- Modify: `app/admin/page.tsx`

- [ ] **Step 1: Utvid `requireAdmin` til å tillate `overordnet`**

I `lib/admin-api.ts` linje 28, erstatt:

```ts
if (!profile || profile.role !== 'admin') return null;
```

med:

```ts
if (!profile || (profile.role !== 'admin' && profile.role !== 'overordnet')) return null;
```

- [ ] **Step 2: Utvid admin-side-gate**

I `app/admin/page.tsx` linje 69, erstatt:

```tsx
if (user.role !== 'admin')    { router.push('/saksbehandling'); return; }
```

med:

```tsx
if (user.role !== 'admin' && user.role !== 'overordnet') { router.push('/saksbehandling'); return; }
```

- [ ] **Step 3: Verifiser**

```bash
npx tsc --noEmit
```
Forventet: feilene i admin-API'et er borte; det gjenstår feil andre steder som fikses i neste task.

---

### Task 6: Admin-panel UI — dropdown for rolle, oppdaterte labels

**Files:**
- Modify: `app/admin/page.tsx`

- [ ] **Step 1: Oppdater `ROLE_LABEL` (linje 22-26)**

Erstatt:

```tsx
const ROLE_LABEL: Record<UserRole, string> = {
  senterleder:   'Senterleder',
  saksbehandler: 'Saksbehandler',
  admin:         'Administrator',
};
```

med:

```tsx
const ROLE_LABEL: Record<UserRole, string> = {
  senterleder:           'Senterleder',
  reklamasjonsansvarlig: 'Reklamasjonsansvarlig',
  overordnet:            'Overordnet',
  admin:                 'Administrator',
};
```

- [ ] **Step 2: Oppdater `ROLE_COLORS` (linje 28-32)**

Erstatt:

```tsx
const ROLE_COLORS: Record<UserRole, string> = {
  senterleder:   'bg-sky-100 text-sky-700',
  saksbehandler: 'bg-emerald-100 text-emerald-700',
  admin:         'bg-purple-100 text-purple-700',
};
```

med:

```tsx
const ROLE_COLORS: Record<UserRole, string> = {
  senterleder:           'bg-sky-100 text-sky-700',
  reklamasjonsansvarlig: 'bg-emerald-100 text-emerald-700',
  overordnet:            'bg-amber-100 text-amber-700',
  admin:                 'bg-purple-100 text-purple-700',
};
```

- [ ] **Step 3: Fjern `ROLE_CYCLE` (linje 34-38)**

Slett hele `ROLE_CYCLE`-konstantblokken — vi bytter fra «klikk for å sykle gjennom roller» til en ekte dropdown.

- [ ] **Step 4: Erstatt `cycleRole` med `changeRole`**

Erstatt funksjonen `cycleRole` (linje 75-84) med:

```tsx
async function changeRole(profile: Profile, newRole: UserRole) {
  if (newRole === profile.role) return;
  setUpdating(profile.id);
  setMessage('');
  try {
    const { error } = await db.from('profiles').update({ role: newRole }).eq('id', profile.id);
    if (error) { setMessage(`Feil: ${error.message}`); }
    else        { setMessage(`${profile.full_name || profile.email} er nå ${ROLE_LABEL[newRole]}`); await loadData(); }
  } finally { setUpdating(null); }
}
```

- [ ] **Step 5: Erstatt rolle-button med rolle-dropdown i bruker-rad**

Finn block ved linje 299–309 (knappen `<button onClick={...cycleRole...}>`) og erstatt med:

```tsx
<select
  value={profile.role}
  onChange={e => { e.stopPropagation(); changeRole(profile, e.target.value as UserRole); }}
  onClick={e => e.stopPropagation()}
  disabled={updating === profile.id || profile.id === currentUser.id}
  title={profile.id === currentUser.id ? 'Kan ikke endre din egen rolle' : 'Endre rolle'}
  className={`text-xs font-semibold px-3 py-1.5 rounded-full cursor-pointer transition-all border-2 border-transparent hover:border-gray-300 outline-none
    ${ROLE_COLORS[profile.role]}
    ${profile.id === currentUser.id ? 'opacity-40 cursor-not-allowed' : ''}
    ${updating === profile.id ? 'opacity-50' : ''}`}
>
  <option value="senterleder">Senterleder</option>
  <option value="reklamasjonsansvarlig">Reklamasjonsansvarlig</option>
  <option value="overordnet">Overordnet</option>
  <option value="admin">Administrator</option>
</select>
```

- [ ] **Step 6: Oppdater hjelpetekst (linje ~267)**

I `<p>`-en under «Brukere»-overskriften, erstatt:

```tsx
Klikk på en bruker for å redigere. Klikk på rollen for å endre den.
```

med:

```tsx
Klikk på en bruker for å redigere. Bruk rollvelgeren for å endre rolle.
```

- [ ] **Step 7: Verifiser**

```bash
npx tsc --noEmit
```
Forventet: ingen feil i `app/admin/page.tsx`.

---

### Task 7: Erstatt `saksbehandler` → `reklamasjonsansvarlig` i øvrig kode

**Files:**
- Modify: `app/saksbehandling/page.tsx`
- Modify: `app/api/send-email/route.ts`
- Modify: `app/api/customer-reply/route.ts`
- Modify: `app/login/page.tsx`

- [ ] **Step 1: `app/saksbehandling/page.tsx`**

Erstatt på linje 90:

```ts
.in('role', ['saksbehandler', 'admin'])
```

med:

```ts
.in('role', ['reklamasjonsansvarlig', 'overordnet', 'admin'])
```

Erstatt på linje 223 (intern tidslinje-tekst):

```ts
content: `Saken ble eskalert av ${currentUser.full_name || currentUser.email} til saksbehandler`,
```

med:

```ts
content: `Saken ble eskalert av ${currentUser.full_name || currentUser.email} til reklamasjonsansvarlig`,
```

Erstatt på linje 561 (UI-knapp):

```tsx
🔺 Eskaler til saksbehandler
```

med:

```tsx
🔺 Eskaler til reklamasjonsansvarlig
```

Erstatt på linje 846 (intern reply-hjelpetekst):

```tsx
{replyType === 'email' ? `Til: ${activeCase.customer_email}` : 'Vises kun for saksbehandlere'}
```

med:

```tsx
{replyType === 'email' ? `Til: ${activeCase.customer_email}` : 'Vises kun for reklamasjonsansvarlig'}
```

- [ ] **Step 2: `app/api/send-email/route.ts`**

Erstatt på linje 118:

```ts
.in('role', ['saksbehandler', 'admin']);
```

med:

```ts
.in('role', ['reklamasjonsansvarlig', 'overordnet', 'admin']);
```

Erstatt på linje 122 (debug-streng):

```ts
return NextResponse.json({ ok: true, sent: false, reason: 'No saksbehandlere found' });
```

med:

```ts
return NextResponse.json({ ok: true, sent: false, reason: 'No reklamasjonsansvarlig found' });
```

Erstatt på linje 130 (e-post-overskrift til intern mottaker):

```html
<h2 style="margin:0 0 12px;color:#92400E;font-size:18px">🔺 En sak er eskalert til saksbehandler</h2>
```

med:

```html
<h2 style="margin:0 0 12px;color:#92400E;font-size:18px">🔺 En sak er eskalert til reklamasjonsansvarlig</h2>
```

Erstatt på linje 150 (registration_notify-handler):

```ts
const { data: admins } = await adminDb.from('profiles').select('email').eq('role', 'admin');
```

med:

```ts
const { data: admins } = await adminDb
  .from('profiles')
  .select('email')
  .in('role', ['admin', 'overordnet']);
```

- [ ] **Step 3: `app/api/customer-reply/route.ts`**

Erstatt på linje 88 (kommentar):

```ts
// Notify saksbehandler — fire and forget
```

med:

```ts
// Notify reklamasjonsansvarlig — fire and forget
```

Erstatt på linje 125:

```ts
.in('role', ['saksbehandler', 'admin']);
```

med:

```ts
.in('role', ['reklamasjonsansvarlig', 'overordnet', 'admin']);
```

- [ ] **Step 4: `app/login/page.tsx`**

Erstatt på linje 31:

```tsx
<p className="text-sm text-gray-400 mb-6">For saksbehandlere og administratorer</p>
```

med:

```tsx
<p className="text-sm text-gray-400 mb-6">For reklamasjonsansvarlig og administratorer</p>
```

- [ ] **Step 5: Verifiser**

```bash
npx tsc --noEmit
```
Forventet: ingen feil.

---

### Task 8: Utvid Navbar `roles`-arrays

**Files:**
- Modify: `components/Navbar.tsx`

- [ ] **Step 1: Oppdater `links`-array**

I `components/Navbar.tsx`, oppdater linje 22-28 til:

```tsx
const links = [
  { href: '/dashboard',      label: 'Dashboard',      roles: ['admin', 'overordnet', 'reklamasjonsansvarlig', 'senterleder'] },
  { href: '/saksbehandling', label: 'Saksbehandling', roles: ['admin', 'overordnet', 'reklamasjonsansvarlig', 'senterleder'] },
  { href: '/eksport',        label: 'Eksport',        roles: ['admin', 'overordnet', 'reklamasjonsansvarlig'] },
  { href: '/admin',          label: 'Adminpanel',     roles: ['admin', 'overordnet'] },
].filter(l => l.roles.includes(role));
```

> **MERK:** Rapportering-lenken er allerede fjernet i Task 1 — den skal ikke gjeninnføres.

- [ ] **Step 2: Verifiser**

```bash
npx tsc --noEmit
```
Forventet: ingen feil.

---

### Task 9: Nøytral kunde-tekst på `/ny-reklamasjon`

**Files:**
- Modify: `app/ny-reklamasjon/page.tsx`

- [ ] **Step 1: Oppdater bekreftelsestekst**

Erstatt linje 162:

```tsx
Vi har mottatt din reklamasjon og sender deg en bekreftelse på e-post. En saksbehandler vil ta kontakt innen 2 virkedager.
```

med:

```tsx
Vi har mottatt din reklamasjon og sender deg en bekreftelse på e-post. Vi vil ta kontakt innen 2 virkedager.
```

- [ ] **Step 2: Verifiser**

```bash
npx tsc --noEmit
```
Forventet: ingen feil.

---

### Task 10: Oppdater SECURITY.md

**Files:**
- Modify: `SECURITY.md`

- [ ] **Step 1: Oppdater linje 15**

Erstatt:

```md
- **Internal staff** (saksbehandlere, senterleder, admin): log in to view, manage, and respond to cases
```

med:

```md
- **Internal staff** (reklamasjonsansvarlig, senterleder, overordnet, admin): log in to view, manage, and respond to cases
```

- [ ] **Step 2: Oppdater rolletabellen rundt linje 61**

Finn raden:

```md
| `saksbehandler` | All cases across all centres; cannot manage users |
```

og erstatt hele rolletabell-segmentet med:

```md
| Role | Access |
|---|---|
| `admin` | Everything, including user management |
| `overordnet` | Everything, including user management (same as admin) |
| `reklamasjonsansvarlig` | All cases across all centres; cannot manage users |
| `senterleder` | Only own centre's cases (RLS-enforced) |
```

> Hvis tabell-headere allerede finnes i den eksisterende seksjonen, behold dem og erstatt kun rad-innholdet.

---

### Task 11: Type-check og lokal build

**Files:**
- Ingen — kun verifisering

- [ ] **Step 1: TypeScript**

```bash
npx tsc --noEmit
```
Forventet: ingen feil.

- [ ] **Step 2: ESLint**

```bash
npm run lint
```
Forventet: ingen nye feil. Eventuelle feil må fikses før commit.

- [ ] **Step 3: Next.js build**

```bash
npm run build
```
Forventet: bygg fullføres uten typefeil.

- [ ] **Step 4: Commit alle kode-endringer fra Task 4–10**

```bash
git add lib/types.ts lib/admin-api.ts app/admin/page.tsx app/saksbehandling/page.tsx \
        app/api/send-email/route.ts app/api/customer-reply/route.ts app/login/page.tsx \
        app/ny-reklamasjon/page.tsx components/Navbar.tsx SECURITY.md
git commit -m "feat: rolle-modell — overordnet + reklamasjonsansvarlig

- Ny rolle 'overordnet' med samme tilgang som admin
- Renaming: saksbehandler -> reklamasjonsansvarlig
- Admin-panel: dropdown for rolle (4 valg)
- Nøytral kunde-tekst på ny-reklamasjon
- SECURITY.md oppdatert"
```

---

### Task 12: Push og deploy til Vercel

**Files:**
- Ingen — kun deploy

- [ ] **Step 1: Push til GitHub**

```bash
git push origin main
```

- [ ] **Step 2: Verifiser Vercel-deploy**

Følg deployen via:
```bash
vercel ls --yes 2>&1 | head -3
```

eller åpne Vercel-dashboardet. Deployen skal vise status `READY` før vi går videre.

- [ ] **Step 3: Røyktest produksjons-URL**

Åpne produksjons-URL i nettleser. Logg inn som admin. Bekreft at:
- Navbaren ikke viser «Rapportering»
- Admin-panel laster uten 500-feil
- Eksisterende saker laster

> **VIKTIG:** På dette tidspunktet er DB-rollen fortsatt `saksbehandler` for eksisterende brukere. Koden godtar både gamle og nye verdier i `.in('role', ...)`-arrays, så det skal være kompatibelt. Hvis admin-panel ikke laster for en bestående saksbehandler-bruker, vent ikke — gå rett til Task 13 og kjør migrasjonen.

---

### Task 13: Kjør DB-migrasjon i Supabase

**Files:**
- Ingen — manuell SQL-kjøring

- [ ] **Step 1: Åpne Supabase SQL Editor**

Logg inn på Supabase-prosjektet. Gå til SQL Editor.

- [ ] **Step 2: Dump aktuelle RLS-policies**

Kjør:

```sql
SELECT schemaname, tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

Kopier resultatet og lim det inn i bunnen av `docs/migrations/2026-04-27-pakke-a-roller.sql` som kommentar (med `--`-prefiks per linje), slik at vi har sporbarhet.

- [ ] **Step 3: Identifiser policies som må oppdateres**

For hver rad i resultatet, se i `qual`- eller `with_check`-kolonnen om policyen refererer streng-litteralen `'saksbehandler'` eller `'admin'`. Disse må oppdateres.

For hver slik policy, skriv et oppdatert SQL-snutt:

```sql
DROP POLICY IF EXISTS "<policy_navn>" ON <tabell>;
CREATE POLICY "<policy_navn>" ON <tabell>
  FOR <cmd> TO authenticated
  USING (...ny qual som speiler ['admin','overordnet','reklamasjonsansvarlig'] eller ['admin','overordnet']...);
```

- [ ] **Step 4: Kjør hovedmigrasjon (kolonne-CHECK + datamigrering)**

Kjør innholdet i `docs/migrations/2026-04-27-pakke-a-roller.sql` (de tre `BEGIN…COMMIT;`-stegene i toppen).

Forventet output: «Success. No rows returned» eller liknende.

- [ ] **Step 5: Kjør de oppdaterte RLS-policy-statementene fra Step 3**

Kjør én transaksjon med alle DROP/CREATE-policy-snuttene.

- [ ] **Step 6: Verifiser**

```sql
-- Skal returnere kun de fire endelige rollene
SELECT DISTINCT role FROM profiles ORDER BY role;
-- Forventet: admin, overordnet, reklamasjonsansvarlig, senterleder
```

```sql
-- Sjekk at ingen policies fortsatt refererer 'saksbehandler'
SELECT tablename, policyname, qual FROM pg_policies
WHERE schemaname = 'public' AND (qual LIKE '%saksbehandler%' OR with_check LIKE '%saksbehandler%');
-- Forventet: ingen rader
```

- [ ] **Step 7: Commit oppdatert migrasjons-fil**

```bash
git add docs/migrations/2026-04-27-pakke-a-roller.sql
git commit -m "chore: ferdigstill DB-migrasjon med faktiske RLS-policies"
git push origin main
```

---

### Task 14: Smoke-test på produksjon

**Files:**
- Ingen — manuell testing

Følg sjekklisten i spec-en (§7), oppsummert:

- [ ] **Steg 1:** Logg inn som admin → navbaren viser **ikke** «Rapportering»
- [ ] **Steg 2:** Admin-panel → endre en bruker fra `reklamasjonsansvarlig` til `overordnet` og tilbake
- [ ] **Steg 3:** Logg inn som `overordnet` → ser admin-panelet, kan godkjenne nye registreringer
- [ ] **Steg 4:** Logg inn som `reklamasjonsansvarlig` → ser alle saker, ser **ikke** admin-panel
- [ ] **Steg 5:** Logg inn som `senterleder` → ser kun eget senter
- [ ] **Steg 6:** Åpne `/ny-reklamasjon` (offentlig side) → senter-dropdown viser **alle 44 sentre**; bekreftelsestekst sier «Vi vil ta kontakt», ikke «En saksbehandler»
- [ ] **Steg 7:** `/registrer` → senter-dropdown viser alle 44 sentre
- [ ] **Steg 8:** Kjør:

  ```bash
  git grep -n "saksbehandler" -- ':!docs/' ':!_arkiv/' ':!*.md'
  ```

  Forventet: **ingen** treff i kodefiler. Dokumentasjonsfiler under `docs/` og `_arkiv/` regnes ikke.

Hvis alle åtte stegene passerer, er Pakke A levert.

---

## Notater til implementer-subagenten

- Dette er et live produksjonssystem med få brukere (~35 senterledere + 1–2 sentralt). Eventuelle midlertidige feil er akseptable hvis de er korte.
- Repoet har ingen tester. Verifisering skjer via `tsc --noEmit`, `npm run lint`, `npm run build` og manuell smoke-test mot prod.
- DB-migrasjonen kjører Tom Aylward selv i Supabase Studio (Task 13). Subagenten skal ikke prøve å kjøre SQL automatisk.
- Hvis subagenten oppdager en `saksbehandler`-streng som ikke står i denne planen (f.eks. ny tekst lagt til siden mappingen), erstatt den med `reklamasjonsansvarlig` og noter det i task-rapporten.
- Hvis subagenten finner en RLS-relevant fil i `supabase/`-mappen som ikke ble oppdaget i kartleggingen, FLAG dette — vi har antatt at policies bare bor i Supabase Studio.

---

## Selv-review

Spec-coverage:
- ✅ A1 (skjul rapportering): Task 1
- ✅ A2 (sentralisere senter-liste): Task 2
- ✅ A3a (renaming): Tasks 4, 6, 7, 8, 10
- ✅ A3b (overordnet-rolle): Tasks 4, 5, 6, 8
- ✅ A4 (nøytral kunde-tekst): Task 9
- ✅ DB-migrasjon: Tasks 3, 13
- ✅ Smoke-test: Task 14

Type-konsistens:
- `UserRole` brukes konsistent med fire verdier overalt
- `NAF_SENTRE` importeres fra én kilde
- `ROLE_LABEL` og `ROLE_COLORS` har alle fire roller som keys

Ingen placeholders, ingen «TBD», ingen «similar to Task N»-referanser.
