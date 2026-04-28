-- Hot-fix: cases_update WITH CHECK
-- Dato: 2026-04-28
--
-- Problem: Senterleder fikk «new row violates row-level security policy
-- for table cases» når de prøvde å flytte en sak til et annet senter.
--
-- Årsak: Den forrige migrasjonen satte USING men ikke et eksplisitt
-- WITH CHECK. PostgreSQL faller tilbake på USING når WITH CHECK er null,
-- og den nye raden (med endret senter) feiler USING-klausulen for
-- senterleder.
--
-- Fiks: Drop og gjenopprett cases_update med eksplisitt WITH CHECK som
-- tillater senterleder å skrive en rad uavhengig av nytt senter-felt.
-- USING-klausulen sikrer at de kun kan starte UPDATE på saker de eier.

BEGIN;

DROP POLICY IF EXISTS cases_update ON cases;

CREATE POLICY cases_update ON cases
  FOR UPDATE
  USING (
    -- Hvilke rader kan brukeren starte UPDATE på (gammel rad).
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND (
          profiles.role IN ('admin','overordnet','reklamasjonsansvarlig')
          OR (profiles.role = 'senterleder' AND profiles.senter = cases.senter)
        )
    )
  )
  WITH CHECK (
    -- Hva den nye raden får lov til å være.
    -- Brukeren må være innlogget med en gyldig rolle. Vi sjekker IKKE
    -- senter på den nye raden, slik at senterleder kan flytte saken
    -- til et annet senter (UI-en logger flyttingen som intern melding).
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin','overordnet','reklamasjonsansvarlig','senterleder')
    )
  );

COMMIT;

-- Verifiser at WITH CHECK nå er satt:
--
-- SELECT policyname, cmd, qual, with_check
-- FROM pg_policies
-- WHERE tablename = 'cases' AND policyname = 'cases_update';
--
-- Forventet: qual og with_check skal begge være EXISTS-uttrykk (ikke null).
