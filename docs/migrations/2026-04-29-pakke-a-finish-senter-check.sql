-- Migrasjon: Pakke A-finish — CHECK constraint på cases.senter
-- Dato: 2026-04-29
--
-- Bakgrunn:
-- Code review fant at WITH CHECK på cases_update kun verifiserer at
-- brukeren har en gyldig rolle, ikke at den nye senter-verdien er
-- gyldig. En senterleder kunne via direkte REST-kall sette
-- cases.senter = NULL eller 'whatever' og slik miste tilgang til
-- saken uten audit. Saken ville blitt usynlig for alle senterledere
-- (ingen ville ha matchende senter-felt).
--
-- Fiks: Legg til en column-level CHECK constraint som krever at
-- cases.senter er ett av de 44 NAF-sentrene. Dette håndheves av
-- PostgreSQL uavhengig av RLS-policy og hvilken klient som skriver.
--
-- Trygt å kjøre: alle eksisterende rader bør allerede ha gyldige
-- senter-verdier siden ny-reklamasjon-skjemaet og Flytt-flyten
-- begge bruker NAF_SENTRE som kilde.

BEGIN;

-- Sjekk for ugyldige rader før vi setter constraint.
-- Hvis denne returnerer rader, må de oppdateres manuelt før migrasjonen kjøres.
DO $$
DECLARE
  invalid_count int;
BEGIN
  SELECT COUNT(*) INTO invalid_count
  FROM cases
  WHERE senter IS NOT NULL
    AND senter NOT IN (
      'NAF Senter Alta','NAF Senter Arendal','NAF Senter Bodø',
      'NAF Senter Drammen','NAF Senter Elverum','NAF Senter Finnsnes',
      'NAF Senter Fredrikstad','NAF Senter Fyllingsdalen','NAF Senter Førde',
      'NAF Senter Gjøvik','NAF Senter Halden','NAF Senter Hamar',
      'NAF Senter Harstad','NAF Senter Haugesund','NAF Senter Hvam',
      'NAF Senter Jessheim','NAF Senter Knarvik','NAF Senter Kongsberg',
      'NAF Senter Kristiansand','NAF Senter Kristiansund','NAF Senter Larvik',
      'NAF Senter Levanger','NAF Senter Lillehammer','NAF Senter Lillestrøm',
      'NAF Senter Mastemyr','NAF Senter Mo i Rana','NAF Senter Molde',
      'NAF Senter Mosjøen','NAF Senter Moss','NAF Senter Namsos',
      'NAF Senter Narvik','NAF Senter Oslo','NAF Senter Otta',
      'NAF Senter Sandvika','NAF Senter Skien','NAF Senter Sortland',
      'NAF Senter Stavanger','NAF Senter Steinkjer','NAF Senter Stjørdal',
      'NAF Senter Tromsø','NAF Senter Trondheim','NAF Senter Tønsberg',
      'NAF Senter Ålesund','NAF Senter Åsane'
    );
  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'Migrasjonen avbrutt: % rad(er) i cases har ugyldige senter-verdier. Rens dem opp først.', invalid_count;
  END IF;
END $$;

-- Drop eksisterende constraint hvis den finnes (for re-kjøring).
ALTER TABLE cases DROP CONSTRAINT IF EXISTS cases_senter_valid;

ALTER TABLE cases ADD CONSTRAINT cases_senter_valid
  CHECK (
    senter IS NULL
    OR senter IN (
      'NAF Senter Alta','NAF Senter Arendal','NAF Senter Bodø',
      'NAF Senter Drammen','NAF Senter Elverum','NAF Senter Finnsnes',
      'NAF Senter Fredrikstad','NAF Senter Fyllingsdalen','NAF Senter Førde',
      'NAF Senter Gjøvik','NAF Senter Halden','NAF Senter Hamar',
      'NAF Senter Harstad','NAF Senter Haugesund','NAF Senter Hvam',
      'NAF Senter Jessheim','NAF Senter Knarvik','NAF Senter Kongsberg',
      'NAF Senter Kristiansand','NAF Senter Kristiansund','NAF Senter Larvik',
      'NAF Senter Levanger','NAF Senter Lillehammer','NAF Senter Lillestrøm',
      'NAF Senter Mastemyr','NAF Senter Mo i Rana','NAF Senter Molde',
      'NAF Senter Mosjøen','NAF Senter Moss','NAF Senter Namsos',
      'NAF Senter Narvik','NAF Senter Oslo','NAF Senter Otta',
      'NAF Senter Sandvika','NAF Senter Skien','NAF Senter Sortland',
      'NAF Senter Stavanger','NAF Senter Steinkjer','NAF Senter Stjørdal',
      'NAF Senter Tromsø','NAF Senter Trondheim','NAF Senter Tønsberg',
      'NAF Senter Ålesund','NAF Senter Åsane'
    )
  );

COMMIT;

-- Verifiser:
--
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'cases'::regclass AND conname = 'cases_senter_valid';
--
-- Forventet: én rad som viser CHECK med listen over alle 44 sentre.
