-- Migrasjon: kunnskapsbase for «liknende saker» (Fase 1)
-- Krever: pgvector-utvidelsen (tilgjengelig i Supabase som 'vector')

BEGIN;

create extension if not exists vector;

create table if not exists kunnskapsbase (
  id uuid primary key default gen_random_uuid(),
  kilde text not null check (kilde in ('legacy', 'app')),
  kilde_ref text unique,
  senter text,
  alvorlighet text,
  status text,
  tid_til_lukking_dager int,
  tema text,
  beskrivelse_anonymisert text not null,
  losning_anonymisert text,
  kostnad numeric,
  kostnad_kilde text check (kostnad_kilde in ('felt','tekst','llm')),
  embedding vector(1536) not null,
  created_at timestamptz default now()
);

create index if not exists kunnskapsbase_embedding_idx
  on kunnskapsbase using hnsw (embedding vector_cosine_ops);

create table if not exists kunnskapsbase_feedback (
  id uuid primary key default gen_random_uuid(),
  case_id uuid,
  nyttig boolean not null,
  created_at timestamptz default now()
);

-- RLS: lesing for innloggede staff-roller, skriving kun via service-role
alter table kunnskapsbase enable row level security;
alter table kunnskapsbase_feedback enable row level security;

drop policy if exists kunnskapsbase_select on kunnskapsbase;
create policy kunnskapsbase_select on kunnskapsbase for select
  to authenticated
  using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid()
        and p.role in ('admin','overordnet','reklamasjonsansvarlig','senterleder')
    )
  );
-- Ingen insert/update/delete-policy: kun service-role (bypasser RLS) kan skrive.
-- kunnskapsbase_feedback: ingen policies — kun service-role leser/skriver.

-- Cosinus-søk. SECURITY INVOKER (default): kalles kun fra service-role i API-laget.
create or replace function match_kunnskapsbase(
  query_embedding vector(1536),
  match_count int default 8,
  terskel float default 0.35,
  ekskluder_ref text default null
)
returns table (
  id uuid, kilde text, kilde_ref text, senter text, alvorlighet text,
  status text, tid_til_lukking_dager int, tema text,
  beskrivelse_anonymisert text, losning_anonymisert text,
  kostnad numeric, kostnad_kilde text, likhet float
)
language sql stable as $$
  select
    k.id, k.kilde, k.kilde_ref, k.senter, k.alvorlighet, k.status,
    k.tid_til_lukking_dager, k.tema, k.beskrivelse_anonymisert,
    k.losning_anonymisert, k.kostnad, k.kostnad_kilde,
    1 - (k.embedding <=> query_embedding) as likhet
  from kunnskapsbase k
  where (ekskluder_ref is null or k.kilde_ref is distinct from ekskluder_ref)
    and 1 - (k.embedding <=> query_embedding) >= terskel
  order by k.embedding <=> query_embedding
  limit match_count;
$$;

COMMIT;

-- Verifiser:
-- SELECT count(*) FROM kunnskapsbase;                          -- 0 (tom, men finnes)
-- SELECT proname FROM pg_proc WHERE proname = 'match_kunnskapsbase';  -- én rad
