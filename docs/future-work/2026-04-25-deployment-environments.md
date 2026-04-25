# Deployment & Environments — Decision Log

**Status:** Level 1 chosen for now (current setup). Upgrade path documented for when complexity grows.
**Decided:** 2026-04-25

---

## Where we are today (Level 1 — Vercel preview URLs only)

```
Code → branch → Vercel auto-creates preview URL → merge to main → production
```

**What's isolated:**
- ✅ Code (each branch deploys to its own URL)

**What's shared with production:**
- ❌ Supabase database
- ⚠️ SendGrid account
- ⚠️ Upstash Redis
- ⚠️ Env vars tagged "Preview" usually point at production services

**Verdict:** Safe for UI/logic changes. **Not safe** for database migrations or write-heavy testing — those still need to be done carefully directly against production.

---

## Operating rules while on Level 1

1. **Every change goes on a feature branch** — never push directly to main, even for one-line fixes
2. **Use the preview URL to test** before merging
3. **Open a PR**, even when self-reviewing — forces a 30-second pause to look at the diff
4. **Database migrations:**
   - Run on a personal Supabase project first, manually verify
   - Backup production DB before running (Supabase auto-daily, but trigger manual too)
   - Run during low-traffic time
   - Use `CREATE INDEX CONCURRENTLY` for indexes on large tables
5. **Test data discipline:**
   - Prefix with `test-` when testing in production DB
   - Clean up afterward
6. **Know how to roll back:**
   - Vercel dashboard → Deployments → click any old one → "Promote to Production"
   - ~10 second instant revert

---

## The three levels of environment safety

### Level 1 — Vercel preview URLs (current)
- ✅ Free, automatic, zero setup
- ✅ Code-only isolation
- ❌ DB shared with production
- **Cost:** $0
- **When it works:** Small team, infrequent DB changes, careful operators

### Level 2 — Supabase Branching (recommended next step)
Supabase automatically creates a separate database per Git branch. The Vercel preview URL on `feat/x` automatically connects to the Supabase branch DB called `feat/x`. Migrations run in isolation. Test data stays in the branch. Auto-cleaned when the branch is deleted.
- ✅ Real DB isolation per feature branch
- ✅ Auto-cleanup
- ✅ Works with existing Vercel + Supabase setup
- ⚠️ Requires Supabase Pro plan (~$25/month — needed anyway for storage/pause-prevention)
- ⚠️ ~30 min one-time setup
- **When to upgrade:** First material DB change after going live, or when free-tier limits start biting (whichever comes first)

### Level 3 — Permanent staging environment (traditional)
A long-lived `staging` branch with its own Supabase project, env vars, etc. Promotes through `feature → staging → production`.
- ✅ Maximum safety, true production mirror
- ❌ More setup, more maintenance overhead
- **When relevant:** Multiple developers, formal QA process, regulated industry workflows
- **Verdict for NAF Reklamasjon:** Probably overkill given current scale

---

## Specific hiccups to plan for on any deploy

| Risk | Mitigation |
|------|------------|
| New env var needed | Add to Vercel **before** merging the code that uses it |
| DB migration locks table | `CREATE INDEX CONCURRENTLY`, run during off-hours, backup first |
| Schema change breaks compatibility | Multi-step deploy: backwards-compatible code first → migrate → use new schema |
| Active customer mid-form | Vercel switchover is ~2s and atomic, but long sessions can lose state — deploy off-hours when possible |
| New third-party script | Add to CSP in `next.config.ts` or it's silently blocked |
| Supabase free tier pauses | Project auto-pauses after 7 days idle on free — upgrade to Pro before this matters |
| Build cache stale | "Redeploy without build cache" in Vercel dashboard |
| SendGrid bounce spike | Watch sender reputation; check DNS / SPF / DKIM if rates climb |

---

## Trigger to revisit

- First material DB change planned (e.g., adding tables, indexes on large tables)
- Multiple developers joining the project
- IT security review explicitly requires staging mirror
- Supabase free tier becomes insufficient (storage, pause risk)

When any of these hits, upgrade to Level 2 (Supabase Pro + Branching).
