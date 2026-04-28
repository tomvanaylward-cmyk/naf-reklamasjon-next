-- Migrasjon: Pakke Sikkerhet — senter-bevisst RLS
-- Dato: 2026-04-28
-- Kjøres i Supabase SQL Editor av admin etter at Vercel-deploy er bekreftet.
--
-- Bakgrunn:
-- Etter Pakke A oppdaget vi at cases_select, cases_update og messages_select
-- bare sjekket auth.role() = 'authenticated' — dvs. enhver innlogget bruker
-- kunne lese/oppdatere alle saker direkte via Supabase REST, uavhengig av
-- senter. Senter-isolasjonen var i praksis app-lag-filtrering, ikke RLS.
--
-- Denne migrasjonen tetter hullet ved å gjøre RLS-policiene rolle- og
-- senter-bevisste, slik at SECURITY.md sin påstand om "RLS enforced"
-- faktisk stemmer.
--
-- Påvirker IKKE:
--   - Offentlig reklamasjons-innsending (bruker service-role-klient som
--     bypasser RLS uansett)
--   - Kunde-svar via reply-token (samme — service-role)
--   - cases_insert / messages_insert / profiles_select (uendret)

BEGIN;

-- ============================================================
-- 1. cases_select
--    Staff (admin/overordnet/reklamasjonsansvarlig): alle saker
--    Senterleder: kun saker der profiles.senter = cases.senter
-- ============================================================
DROP POLICY IF EXISTS cases_select ON cases;

CREATE POLICY cases_select ON cases
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND (
          profiles.role IN ('admin','overordnet','reklamasjonsansvarlig')
          OR (profiles.role = 'senterleder' AND profiles.senter = cases.senter)
        )
    )
  );

-- ============================================================
-- 2. cases_update
--    Samme USING-logikk som SELECT.
--    WITH CHECK satt til true slik at senterleder fortsatt kan flytte
--    saker ut av eget senter (UI-en logger flyttingen som intern melding).
-- ============================================================
DROP POLICY IF EXISTS cases_update ON cases;

CREATE POLICY cases_update ON cases
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND (
          profiles.role IN ('admin','overordnet','reklamasjonsansvarlig')
          OR (profiles.role = 'senterleder' AND profiles.senter = cases.senter)
        )
    )
  )
  WITH CHECK (true);

-- ============================================================
-- 3. messages_select
--    Staff: alle meldinger
--    Senterleder: kun meldinger på saker fra eget senter
-- ============================================================
DROP POLICY IF EXISTS messages_select ON messages;

CREATE POLICY messages_select ON messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin','overordnet','reklamasjonsansvarlig')
          OR (
            p.role = 'senterleder'
            AND EXISTS (
              SELECT 1 FROM cases c
              WHERE c.id = messages.case_id
                AND c.senter = p.senter
            )
          )
        )
    )
  );

COMMIT;

-- ============================================================
-- VERIFIKASJON — kjør disse spørringene etter migrasjonen for å
-- bekrefte at policyene er på plass:
-- ============================================================
--
-- SELECT tablename, policyname, cmd, qual
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN ('cases','messages')
-- ORDER BY tablename, policyname;
--
-- Forventet:
--   - cases.cases_insert      INSERT  (uendret)
--   - cases.cases_select      SELECT  (ny senter-bevisst USING)
--   - cases.cases_update      UPDATE  (ny senter-bevisst USING)
--   - messages.messages_insert INSERT (uendret)
--   - messages.messages_select SELECT (ny senter-bevisst USING)
--
-- ============================================================
-- SMOKE-TEST i prod (etter migrasjon)
-- ============================================================
-- 1. Logg inn som senterleder ved senter A
--    -> Saksbehandling-listen skal kun vise saker fra senter A
--    -> Eventuell direkte query via Supabase REST på cases skal også
--       returnere kun rader der senter = senter A
--
-- 2. Logg inn som reklamasjonsansvarlig
--    -> Saksbehandling-listen skal vise saker fra alle sentre
--
-- 3. Logg inn som senterleder ved senter A og bruk «Flytt →» til senter B
--    -> Saken oppdateres i DB (cases.senter = senter B)
--    -> Saken forsvinner fra senterleders liste (RLS skjuler den)
--    -> Senterleder ved senter B kan nå se saken
--
-- 4. Logg inn som senterleder ved senter A og åpne en sak fra eget
--    senter. Sjekk at meldingstråden er fullstendig synlig.
--    -> messages_select skal slippe gjennom alle meldinger på saken
