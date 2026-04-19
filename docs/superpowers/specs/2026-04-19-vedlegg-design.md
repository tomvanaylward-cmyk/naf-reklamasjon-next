# Vedlegg — Design Spec

**Dato:** 2026-04-19

---

## Mål

Gi kunder mulighet til å laste opp bilder og dokumenter ved innmelding av reklamasjon, og gi saksbehandlere/senterledere mulighet til å laste opp interne filer direkte på en sak. Alle vedlegg er kun synlige for interne brukere — ikke for kunden.

---

## Datamodell

### Ny tabell: `attachments`

```sql
CREATE TABLE attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id      uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  uploader_id  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  file_name    text NOT NULL,
  file_size    int  NOT NULL,
  mime_type    text NOT NULL,
  storage_path text NOT NULL,
  created_at   timestamptz DEFAULT now()
);
```

- `uploader_id = null` betyr kundeopplasting
- `storage_path` er relativ sti i Supabase Storage, f.eks. `NAF-202604-1234/uuid-skadebilde.jpg`

### RLS-policy

```sql
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;

-- Admin og saksbehandler ser alle vedlegg
CREATE POLICY "attachments_select_admin_saksbehandler" ON attachments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'saksbehandler')
    )
  );

-- Senterleder ser kun vedlegg på saker fra eget senter
CREATE POLICY "attachments_select_senterleder" ON attachments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      JOIN cases ON cases.senter = profiles.senter
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'senterleder'
      AND cases.id = attachments.case_id
    )
  );

-- Innloggede brukere kan laste opp vedlegg til saker de har tilgang til
CREATE POLICY "attachments_insert" ON attachments
  FOR INSERT TO authenticated
  WITH CHECK (uploader_id = auth.uid());
```

### Supabase Storage

- **Bucket:** `case-attachments` (privat — ingen offentlig tilgang)
- **Filsti:** `{case_id}/{uuid}-{sanitert_filnavn}`
- **Støttede formater:** JPG, PNG, PDF
- **Maks størrelse:** 10 MB per fil
- **Maks antall:** 5 filer per opplasting

---

## Opplastingsflyt

### A) Kunde på `/ny-reklamasjon` (ikke innlogget)

1. Kunden velger inntil 5 filer under beskrivelsesfeltet (valgfritt)
2. Ved innsending: saken opprettes i databasen først
3. Filene sendes deretter til `POST /api/attachments/upload` med `case_id` og fildata
4. API-ruten bruker `SUPABASE_SERVICE_ROLE_KEY` for å:
   - Laste opp til Supabase Storage
   - Sette inn rad i `attachments` med `uploader_id = null`
5. Feil ved opplasting stopper ikke saken fra å bli opprettet — opplastingsfeil logges men vises ikke til kunden

### B) Saksbehandler / senterleder (innlogget)

1. Klikker "Last opp fil" i Vedlegg-seksjonen i saksdetaljvisningen
2. Filen lastes opp direkte fra klienten til Supabase Storage via signert URL
3. Metadata lagres i `attachments` med `uploader_id = auth.uid()`
4. Vedlegg-seksjonen oppdateres automatisk

---

## UI

### `/ny-reklamasjon` — filopplaster

- Plassering: under beskrivelsesfeltet, over innsendingsknappen
- Label: "Last opp bilder eller dokumenter (valgfritt)"
- Aksepterte typer: `.jpg`, `.jpeg`, `.png`, `.pdf`
- Viser valgte filer med navn og størrelse, med ✕ for å fjerne enkeltfiler
- Feilmelding vises inline ved feil format eller for stor fil (> 10 MB)
- Ingen endring i resten av skjemaet eller innsendingsflyten

### `/saksbehandling` — Vedlegg-seksjon (høyrekolonne)

- Ny seksjon under eksisterende kort (senterinfo, SLA, osv.)
- Tittel: "Vedlegg"
- Lister alle vedlegg på saken:
  - Filikon basert på type (🖼 for bilder, 📄 for PDF)
  - Filnavn + størrelse (formatert, f.eks. "2,3 MB")
  - Opplaster: "Kunde" (hvis `uploader_id = null`) eller brukerens fulle navn
  - Tidspunkt: dato og klokkeslett, f.eks. "19. apr 2026 kl. 14:32"
  - Klikk på bilde → fullskjermvisning (lightbox)
  - Klikk på PDF → åpner i ny fane / laster ned
- "Last opp fil"-knapp nederst i seksjonen
- Seksjon skjules ikke selv om den er tom — viser "Ingen vedlegg ennå"

### Tidslinje

Vedlegg vises i tidslinjen som en egen rad. Implementasjon: `saksbehandling/page.tsx` henter `attachments` for aktiv sak parallelt med `messages`, mapper dem til et felles format `{ type: 'message' | 'attachment', created_at, ... }`, og sorterer hele listen etter `created_at` stigende før rendering.

> 📎 **skadebilde.jpg** · 2,3 MB · lastet opp av Tom Aylward · 19. apr 2026 kl. 14:32

eller for kundeopplasting:

> 📎 **faktura.pdf** · 1,1 MB · lastet opp av kunden · 19. apr 2026 kl. 09:15

---

## API-ruter

| Rute | Beskrivelse |
|------|-------------|
| `POST /api/attachments/upload` | Kundeopplasting — ingen auth, bruker service role key, tar imot `case_id` + filer |

Saksbehandleropplasting skjer direkte mot Supabase Storage fra klienten (signert URL via Supabase JS-klient).

---

## Filer som endres/opprettes

| Fil | Endring |
|-----|---------|
| `app/ny-reklamasjon/page.tsx` | Legg til filopplaster under beskrivelsesfeltet |
| `app/saksbehandling/page.tsx` | Ny Vedlegg-seksjon i høyrekolonne + vedlegg i tidslinje |
| `app/api/attachments/upload/route.ts` | Ny — håndterer kundeopplasting via service role |
| `lib/types.ts` | Ny `Attachment`-type |
| SQL (kjøres i Supabase) | `attachments`-tabell + RLS-policies + Storage bucket `case-attachments` |

---

## Sikkerhet

- Storage-bucketen er **privat** — ingen offentlig URL-tilgang
- Filer leses via signerte URLs som utløper etter 60 minutter
- Kundeopplasting går via server-side API (service role) — anon key har aldri skrivetilgang til Storage
- RLS på `attachments`-tabellen hindrer senterledere i å se vedlegg fra andre senters saker (arver senter-RLS fra `cases`)

---

## Utenfor scope

- E-post med vedlegg til kunden
- Kunde-portal der kunden kan se sine egne opplastinger etter innsending
- HEIC-støtte (iPhone-format) — for komplekst for MVP, kan legges til senere
- Sletting av vedlegg (kan legges til i admin-panelet senere)
