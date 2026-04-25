# Similar Past Cases — Vector Similarity Search

**Status:** Parked (revisit when corpus reaches ~200 resolved cases)
**Decided:** 2026-04-25

---

## The idea

When a saksbehandler opens a complaint, show three past resolved cases that are semantically similar — based on the meaning of the text, not just keywords. Each match displays the original complaint and how NAF answered it, with a one-click "Kopier svar" button to reuse the response. The goal: consistent, high-quality answers across the team and across time.

---

## Why we parked it

1. **Not enough resolved cases yet.** Vector similarity needs depth in the corpus to feel useful. Below ~50–100 resolved cases, results are thin and feel random.
2. **Reply templates already cover recurring patterns.** The bottleneck this feature solves may already be partially handled.
3. **The bottleneck might be elsewhere.** Worth confirming whether saksbehandler slowness is about *writing* replies or about *investigating* complaints / coordinating with centres / waiting for customer responses. If the latter, this feature does not help.
4. **IT security cost.** Adds OpenAI as a fourth third-party vendor. Fresh DPA, new section in `SECURITY.md`, another vendor in the security review pack.
5. **Risk of degraded answers.** If saksbehandlere lean on "Kopier svar" without thinking, the failure mode shifts from "different answers to similar cases" to "same answer to slightly different cases."

---

## Signals that say "build it now"

| Signal | Threshold |
|--------|-----------|
| Volume of resolved cases | ~200+ |
| Saksbehandlere reporting "I know we've seen this before but can't find it" | Repeated complaint |
| Inconsistent answers identified in audits | Pattern emerges |
| New hires struggling to learn the answer style | Onboarding pain point |
| Reply templates feel insufficient or clutter the UI | Templates not scaling |

---

## Decisions already made (for when we revisit)

These were validated in the brainstorm session before parking:

1. **UI placement:** Inline between complaint and reply — natural cognitive flow, no extra clicks, vertical space only
2. **Trigger:** Automatic on case open (search is a fast DB query, embedding is one-time at case creation)
3. **Detail per match:** Expandable card with original complaint + NAF reply + "Kopier svar" button
4. **Embedding model:** OpenAI `text-embedding-3-small` — best Norwegian quality, ~$0.10 cost for 10k cases, EU data residency available

---

## Architecture sketch

```
NEW CASE
  Customer submits → Server action embeds (title + description) via OpenAI
                  → Stores in cases.embedding (vector(1536))

SAKSBEHANDLER OPENS CASE
  RSC fetches /api/cases/[id]/similar
    → pgvector query (cosine distance, status='resolved', RLS-scoped, threshold > 0.75, limit 3)
    → <SimilarCases /> renders inline section
```

**Files (rough plan):**
- `lib/embeddings.ts` — OpenAI wrapper
- `app/api/cases/[id]/similar/route.ts` — similarity API
- `app/saksbehandling/[id]/SimilarCases.tsx` — inline UI
- `lib/db/migrations/add_embedding_column.sql` — pgvector column + IVFFlat index
- `scripts/backfill-embeddings.ts` — one-time backfill of existing cases

**DB migration:**
```sql
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE cases ADD COLUMN embedding vector(1536);
CREATE INDEX cases_embedding_idx ON cases
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

---

## What to do in the meantime

1. **Build keyword search first** — 10× cheaper, no AI vendor, gives ~60% of the value.
2. **Track explicit similarity signals** — at case resolution, prompt saksbehandler with "Was this similar to another case?" → after 3 months, hard data on how often cases repeat.
3. **Grow the corpus** — every resolved case improves the eventual quality of this feature.

---

## Effort estimate when we eventually build it

~3–4 days of focused implementation:
- DB migration + embedding column + index *(½ day)*
- `lib/embeddings.ts` + new-case embedding hook *(½ day)*
- `/api/cases/[id]/similar` endpoint *(½ day)*
- `<SimilarCases />` UI component *(1 day)*
- Backfill script + run on existing cases *(½ day)*
- SECURITY.md update + OpenAI DPA documentation *(½ day)*
