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
