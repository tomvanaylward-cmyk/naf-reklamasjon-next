# Roller, RLS og Eskalering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **IMPORTANT:** Read `node_modules/next/dist/docs/` before writing any Next.js code — Next.js 16 has breaking changes from earlier versions.

**Goal:** Implement three-tier role access (senterleder / saksbehandler / admin), Supabase Row Level Security so senterledere only see their own senter's cases, and an escalation flow from senterleder to saksbehandler — replacing the shared email inbox as the coordination tool.

**Architecture:** `profiles.role` and `profiles.senter` drive all access decisions. Supabase RLS policies enforce isolation at the database level — not just in UI. The client-side (`db`) uses the anon key with JWT auth so RLS applies automatically. Server-side API routes (cron) use `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS. The Navbar, saksbehandling page, and admin page all branch on `currentUser.role`.

**Tech Stack:** Next.js 16.2.3 App Router, TypeScript, Supabase (auth + postgres RLS), Tailwind CSS v4, SendGrid

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `lib/types.ts` | Modify | Add `'eskalert'` status, expand `UserRole`, add `senter` to Profile, add Attachment + Template types |
| `lib/supabase.ts` | Modify | Fetch `senter` in `getCurrentUser()`, add `eskalert` to STATUS_LABEL |
| `components/Navbar.tsx` | Modify | Accept `role` instead of `isAdmin`, show Rapportering for admin/saksbehandler |
| `app/admin/page.tsx` | Modify | Support 3 roles, add senter selector per user |
| `app/saksbehandling/page.tsx` | Modify | Escalation button, role-aware UI, filter agents in assign dropdown |
| `app/api/send-email/route.ts` | Modify | Add `escalation_notify` email type |
| `app/api/notify-hanging-cases/route.ts` | Modify | Use service role key to bypass RLS |

**Database (Supabase SQL editor — run manually before deploying):**
- Add `senter` column to `profiles`
- Create `attachments` table (used in Plan 2, created now so RLS is consistent)
- Create `templates` table (used in Plan 2, created now)
- Enable RLS on `cases` with two policies

---

## Task 1: Update lib/types.ts

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Replace the entire file**

```typescript
// lib/types.ts
export type CaseStatus = 'ny' | 'open' | 'waiting' | 'eskalert' | 'closed';
export type CasePriority = 'low' | 'normal' | 'high' | 'critical';
export type MessageType = 'customer' | 'agent' | 'internal';
export type UserRole = 'admin' | 'saksbehandler' | 'senterleder';
export type CaseOutcome = 'approved' | 'partial' | 'rejected' | 'dropped';

export interface Case {
  id: string;
  case_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  customer_type: string | null;
  company: string | null;
  category: string;
  senter: string | null;
  description: string | null;
  desired_resolution: string | null;
  reg_nr: string | null;
  visit_date: string | null;
  order_number: string | null;
  status: CaseStatus;
  priority: CasePriority;
  assigned_to: string | null;
  outcome: CaseOutcome | null;
  cost_estimated: number | null;
  cost_actual: number | null;
  sla_deadline: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface Message {
  id: string;
  case_id: string;
  type: MessageType;
  sender_name: string;
  content: string;
  created_at: string;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  senter: string | null;
}

export interface Attachment {
  id: string;
  case_id: string;
  uploader_id: string | null;
  file_name: string;
  file_url: string;
  file_size: number;
  mime_type: string;
  created_at: string;
}

export interface Template {
  id: string;
  name: string;
  category: string | null;
  body: string;
  created_by: string | null;
  created_at: string;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/tomaylward/Documents/Claude/Reklamasjon/naf-reklamasjon-next
npx tsc --noEmit 2>&1 | head -40
```

Expected: errors about `UserRole` mismatch (admin page uses `'agent'`) — these will be fixed in later tasks. No errors in `lib/types.ts` itself.

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat: expand UserRole to 3 tiers, add eskalert status, Attachment/Template types"
```

---

## Task 2: Update lib/supabase.ts

**Files:**
- Modify: `lib/supabase.ts`

- [ ] **Step 1: Replace the entire file**

```typescript
import { createClient } from '@supabase/supabase-js';
import type { CaseStatus, CasePriority, Profile } from './types';

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const db = createClient(SUPABASE_URL, SUPABASE_ANON);

export const STATUS_LABEL: Record<CaseStatus, string> = {
  ny:       'Ny',
  open:     'Åpen',
  waiting:  'Venter',
  eskalert: 'Eskalert',
  closed:   'Lukket',
};

export const PRIO_LABEL: Record<CasePriority, string> = {
  low: 'Lav', normal: 'Normal', high: 'Høy', critical: 'Kritisk'
};

export function formatDate(iso: string | null): string {
  if (!iso) return '–';
  return new Date(iso).toLocaleDateString('nb-NO', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '–';
  const d = new Date(iso);
  return d.toLocaleDateString('nb-NO', { day: '2-digit', month: 'short' })
    + ' ' + d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
}

export async function getCurrentUser(): Promise<Profile | null> {
  const { data: { user } } = await db.auth.getUser();
  if (!user) return null;
  const { data } = await db
    .from('profiles')
    .select('id, email, full_name, role, senter')
    .eq('id', user.id)
    .single();
  return data as Profile | null;
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: TypeScript errors in `app/admin/page.tsx` (still uses old `'agent'` role) — fixed in Task 5. No errors in `lib/supabase.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/supabase.ts
git commit -m "feat: add eskalert to STATUS_LABEL, fetch senter in getCurrentUser"
```

---

## Task 3: Database migrations (run in Supabase SQL editor)

**Files:** None (SQL run directly in Supabase dashboard)

Go to: https://supabase.com → your project → SQL Editor → New query

- [ ] **Step 1: Run migration SQL**

```sql
-- Add senter field to profiles (senterleder tilhørighet)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS senter text;

-- Update role check constraint if exists (drop old, profiles table uses text)
-- No enum to update — role is stored as text

-- Create attachments table (used in Plan 2, created now)
CREATE TABLE IF NOT EXISTS attachments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  uploader_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  file_name   text NOT NULL,
  file_url    text NOT NULL,
  file_size   int  NOT NULL DEFAULT 0,
  mime_type   text NOT NULL DEFAULT 'application/octet-stream',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Create templates table (used in Plan 2, created now)
CREATE TABLE IF NOT EXISTS templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  category   text,
  body       text NOT NULL,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

Expected output: `Success. No rows returned.`

- [ ] **Step 2: Verify senter column exists**

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'profiles' AND column_name = 'senter';
```

Expected: one row with `column_name = senter`, `data_type = text`

- [ ] **Step 3: Verify tables exist**

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('attachments', 'templates');
```

Expected: two rows — `attachments` and `templates`

---

## Task 4: Enable RLS on cases (Supabase SQL editor)

**Files:** None (SQL run in Supabase dashboard)

> **Warning:** After running this SQL, any existing Supabase client using the anon key will only see cases based on the authenticated user's role. Test that login still works after this step before continuing.

- [ ] **Step 1: Enable RLS and create policies**

```sql
-- Enable Row Level Security on cases table
ALTER TABLE cases ENABLE ROW LEVEL SECURITY;

-- Policy 1: saksbehandler and admin can read and write ALL cases
CREATE POLICY "cases_saksbehandler_admin_all"
ON cases
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('saksbehandler', 'admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('saksbehandler', 'admin')
  )
);

-- Policy 2: senterleder can only read and write cases from their own senter
CREATE POLICY "cases_senterleder_own_senter"
ON cases
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'senterleder'
    AND profiles.senter IS NOT NULL
    AND profiles.senter = cases.senter
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'senterleder'
    AND profiles.senter IS NOT NULL
    AND profiles.senter = cases.senter
  )
);
```

Expected: `Success. No rows returned.`

- [ ] **Step 2: Verify policies exist**

```sql
SELECT policyname, cmd, roles
FROM pg_policies
WHERE tablename = 'cases';
```

Expected: two rows — `cases_saksbehandler_admin_all` and `cases_senterleder_own_senter`

- [ ] **Step 3: Update your own profile role to saksbehandler so you can still see all cases**

```sql
UPDATE profiles
SET role = 'saksbehandler'
WHERE email = 'tom.van.aylward@gmail.com';
```

Expected: `1 row affected`

> **Note:** After this update, the old `admin` role no longer exists for your account. You will need to set `role = 'admin'` for yourself after Task 5 rolls out the new admin page. For now, `saksbehandler` gives full case visibility.

---

## Task 5: Update app/admin/page.tsx

**Files:**
- Modify: `app/admin/page.tsx`

The admin page needs to:
- Support 3 roles (senterleder, saksbehandler, admin)
- Add a senter selector for each user
- Guard the page with `role === 'admin'` (not just the old `'admin'` check which still works)

- [ ] **Step 1: Replace the entire file**

```typescript
'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { db, getCurrentUser } from '@/lib/supabase';
import type { Profile, UserRole } from '@/lib/types';
import Navbar from '@/components/Navbar';

const SENTRE = [
  'NAF Senter Oslo',
  'NAF Senter Bergen',
  'NAF Senter Trondheim',
  'NAF Senter Stavanger',
  'NAF Senter Kristiansand',
  'NAF Senter Tromsø',
  'NAF Senter Drammen',
  'NAF Senter Fredrikstad',
  'NAF Senter Ålesund',
  'NAF Senter Bodø',
];

const ROLE_LABEL: Record<UserRole, string> = {
  senterleder:  'Senterleder',
  saksbehandler: 'Saksbehandler',
  admin:        'Administrator',
};

const ROLE_COLORS: Record<UserRole, string> = {
  senterleder:   'bg-sky-100 text-sky-700',
  saksbehandler: 'bg-emerald-100 text-emerald-700',
  admin:         'bg-purple-100 text-purple-700',
};

const ROLE_CYCLE: Record<UserRole, UserRole> = {
  senterleder:   'saksbehandler',
  saksbehandler: 'admin',
  admin:         'senterleder',
};

export default function AdminPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<Profile | null>(null);
  const [profiles, setProfiles]       = useState<Profile[]>([]);
  const [updating, setUpdating]       = useState<string | null>(null);
  const [message, setMessage]         = useState('');

  async function loadProfiles() {
    const { data } = await db
      .from('profiles')
      .select('id, email, full_name, role, senter')
      .order('full_name');
    setProfiles((data as Profile[]) || []);
  }

  useEffect(() => {
    (async () => {
      const user = await getCurrentUser();
      if (!user) { router.push('/login'); return; }
      if (user.role !== 'admin') { router.push('/saksbehandling'); return; }
      setCurrentUser(user);
      await loadProfiles();
    })();
  }, [router]);

  async function cycleRole(profile: Profile) {
    const newRole = ROLE_CYCLE[profile.role];
    setUpdating(profile.id);
    setMessage('');
    try {
      const { error } = await db
        .from('profiles')
        .update({ role: newRole })
        .eq('id', profile.id);
      if (error) {
        setMessage(`Feil: ${error.message}`);
      } else {
        setMessage(`${profile.full_name || profile.email} er nå ${ROLE_LABEL[newRole]}`);
        await loadProfiles();
      }
    } finally {
      setUpdating(null);
    }
  }

  async function updateSenter(profile: Profile, senter: string) {
    setUpdating(profile.id);
    try {
      await db
        .from('profiles')
        .update({ senter: senter || null })
        .eq('id', profile.id);
      await loadProfiles();
    } finally {
      setUpdating(null);
    }
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-[#f5f6fa] flex items-center justify-center text-gray-500">
        Laster...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f6fa] flex flex-col">
      <Navbar
        userName={currentUser.full_name || currentUser.email}
        role={currentUser.role}
      />

      <div className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <h1 className="text-2xl font-bold text-[#003087] mb-6">Adminpanel — Brukere</h1>

          {message && (
            <div className="mb-4 px-4 py-2.5 bg-emerald-50 border border-emerald-100 rounded-lg text-sm text-emerald-700">
              {message}
            </div>
          )}

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700">Brukere ({profiles.length})</h2>
              <p className="text-xs text-gray-400 mt-0.5">Klikk på rollen for å endre. Senterledere må ha et senter tilordnet.</p>
            </div>
            <div className="divide-y divide-gray-50">
              {profiles.map(profile => (
                <div key={profile.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors">
                  {/* Avatar */}
                  <div className="w-9 h-9 rounded-full bg-[#003087]/10 flex items-center justify-center text-sm font-semibold text-[#003087] flex-shrink-0">
                    {(profile.full_name || profile.email)[0].toUpperCase()}
                  </div>

                  {/* Name + email */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {profile.full_name || '(intet navn)'}
                    </p>
                    <p className="text-xs text-gray-400 truncate">{profile.email}</p>
                  </div>

                  {/* Senter selector (only relevant for senterleder, but available to all) */}
                  <select
                    value={profile.senter || ''}
                    onChange={e => updateSenter(profile, e.target.value)}
                    disabled={updating === profile.id}
                    className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none bg-white text-gray-600 cursor-pointer hover:border-[#003087] transition-colors w-48"
                  >
                    <option value="">Ikke tilordnet senter</option>
                    {SENTRE.map(s => (
                      <option key={s} value={s}>{s.replace('NAF Senter ', '')}</option>
                    ))}
                  </select>

                  {/* Role badge (click to cycle) */}
                  <button
                    onClick={() => cycleRole(profile)}
                    disabled={updating === profile.id || profile.id === currentUser.id}
                    title={profile.id === currentUser.id ? 'Kan ikke endre din egen rolle' : `Klikk for å endre til ${ROLE_LABEL[ROLE_CYCLE[profile.role]]}`}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-full cursor-pointer transition-all border-2 border-transparent hover:border-gray-300
                      ${ROLE_COLORS[profile.role]}
                      ${profile.id === currentUser.id ? 'opacity-40 cursor-not-allowed' : ''}
                      ${updating === profile.id ? 'opacity-50' : ''}`}
                  >
                    {updating === profile.id ? '...' : ROLE_LABEL[profile.role]}
                  </button>
                </div>
              ))}
              {profiles.length === 0 && (
                <div className="px-5 py-8 text-center text-sm text-gray-400">
                  Ingen brukere funnet
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep "admin" | head -10
```

Expected: no errors related to admin/page.tsx. May still see Navbar prop errors (fixed in Task 6).

- [ ] **Step 3: Commit**

```bash
git add app/admin/page.tsx
git commit -m "feat: admin page supports 3 roles + senter selector per user"
```

---

## Task 6: Update components/Navbar.tsx

**Files:**
- Modify: `components/Navbar.tsx`

Change `isAdmin: boolean` to `role: UserRole`. Add Rapportering link for admin and saksbehandler.

- [ ] **Step 1: Replace the entire file**

```typescript
'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { db } from '@/lib/supabase';
import type { UserRole } from '@/lib/types';

interface NavbarProps {
  userName: string;
  role: UserRole;
}

export default function Navbar({ userName, role }: NavbarProps) {
  const pathname = usePathname();
  const router   = useRouter();

  async function logout() {
    try {
      await db.auth.signOut();
    } catch {
      // continue to login regardless
    }
    router.push('/login');
  }

  const links = [
    { href: '/dashboard',      label: 'Dashboard',      roles: ['admin', 'saksbehandler', 'senterleder'] },
    { href: '/saksbehandling', label: 'Saksbehandling', roles: ['admin', 'saksbehandler', 'senterleder'] },
    { href: '/rapportering',   label: 'Rapportering',   roles: ['admin', 'saksbehandler'] },
    { href: '/eksport',        label: 'Eksport',        roles: ['admin', 'saksbehandler'] },
    { href: '/admin',          label: 'Adminpanel',     roles: ['admin'] },
  ].filter(l => l.roles.includes(role));

  return (
    <nav className="bg-[#003087] h-[58px] flex items-center px-7 gap-5 sticky top-0 z-50 shadow-[0_2px_16px_rgba(0,48,135,0.35)]">
      <Link href="/" className="flex items-center gap-3 font-semibold text-[14.5px] text-white no-underline">
        <span className="bg-[#E3000F] text-white font-bold text-xs px-2 py-0.5 rounded">NAF</span>
        Reklamasjonssystem
      </Link>
      <div className="flex gap-0.5 ml-auto">
        {links.map(l => (
          <Link key={l.href} href={l.href}
            className={`text-[13.5px] font-medium px-3.5 py-1.5 rounded-lg transition-colors no-underline
              ${pathname.startsWith(l.href)
                ? 'bg-white/15 text-white'
                : 'text-white/60 hover:bg-white/10 hover:text-white'}`}>
            {l.label}
          </Link>
        ))}
      </div>
      <div className="flex items-center gap-2 text-white/75 text-sm ml-3 pl-3 border-l border-white/15">
        <div aria-hidden="true" className="w-[30px] h-[30px] rounded-full bg-white/20 flex items-center justify-center text-xs font-semibold text-white">
          {(userName || '?')[0].toUpperCase()}
        </div>
        <span>{userName}</span>
        <button onClick={logout} className="text-white/50 text-xs px-2 py-1 rounded hover:bg-white/10 hover:text-white transition-colors cursor-pointer border-none bg-transparent">
          Logg ut
        </button>
      </div>
    </nav>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/Navbar.tsx
git commit -m "feat: Navbar uses role prop, shows Rapportering for admin/saksbehandler"
```

---

## Task 6b: Fix remaining Navbar calls in dashboard and eksport pages

**Files:**
- Modify: `app/dashboard/page.tsx` line 153
- Modify: `app/eksport/page.tsx` line 173

Both pages still pass `isAdmin={...}` to Navbar. After Task 6 changes the prop to `role`, TypeScript will error on these.

- [ ] **Step 1: Fix app/dashboard/page.tsx**

Find:
```tsx
<Navbar userName={currentUser.full_name || currentUser.email} isAdmin={currentUser.role === 'admin'} />
```

Replace with:
```tsx
<Navbar userName={currentUser.full_name || currentUser.email} role={currentUser.role} />
```

- [ ] **Step 2: Fix app/eksport/page.tsx**

Find:
```tsx
<Navbar userName={currentUser.full_name || currentUser.email} isAdmin={currentUser.role === 'admin'} />
```

Replace with:
```tsx
<Navbar userName={currentUser.full_name || currentUser.email} role={currentUser.role} />
```

- [ ] **Step 3: Commit**

```bash
git add app/dashboard/page.tsx app/eksport/page.tsx
git commit -m "fix: update Navbar prop from isAdmin to role in dashboard and eksport pages"
```

---

## Task 7: Update app/saksbehandling/page.tsx

**Files:**
- Modify: `app/saksbehandling/page.tsx`

Changes needed:
1. Pass `role={currentUser.role}` to Navbar (replace `isAdmin={...}`)
2. Add escalation button visible only to senterledere
3. Filter agent dropdown to exclude senterledere (only saksbehandler/admin can be assigned)
4. Add `eskalert` to status dropdown options

- [ ] **Step 1: Find and replace Navbar usage**

Find (line ~168):
```tsx
<Navbar userName={currentUser.full_name || currentUser.email} isAdmin={currentUser.role === 'admin'} />
```

Replace with:
```tsx
<Navbar userName={currentUser.full_name || currentUser.email} role={currentUser.role} />
```

- [ ] **Step 2: Add escalation handler function**

Add this function after the `sendReply` function (around line 141):

```typescript
async function escalateCase() {
  if (!activeCase || !currentUser) return;
  const now = new Date().toISOString();

  // Update case status and clear assignment
  await db.from('cases').update({
    status:      'eskalert',
    assigned_to: null,
    updated_at:  now,
  }).eq('id', activeCase.id);

  // Log timeline entry
  const msg: Omit<Message, 'id'> = {
    case_id:     activeCase.id,
    type:        'internal',
    sender_name: '🔁 System',
    content:     `Saken ble eskalert av ${currentUser.full_name || currentUser.email} til saksbehandler`,
    created_at:  now,
  };
  await db.from('messages').insert(msg);
  setMessages(prev => [...prev, { ...msg, id: crypto.randomUUID() }]);

  // Notify saksbehandlere by email (non-blocking)
  fetch('/api/send-email', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      type:       'escalation_notify',
      caseId:     activeCase.case_id,
      caseName:   activeCase.customer_name,
      category:   activeCase.category,
      senter:     activeCase.senter,
      fromName:   currentUser.full_name || currentUser.email,
    }),
  }).catch(() => {});

  // Update local state
  setActiveCase(prev => prev ? { ...prev, status: 'eskalert', assigned_to: null } : prev);
  setAllCases(prev => prev.map(c =>
    c.id === activeCase.id ? { ...c, status: 'eskalert', assigned_to: null } : c
  ));
}
```

- [ ] **Step 3: Add Eskalert to the status dropdown**

Find the status select element (around line 263):
```tsx
<select aria-label="Status" value={activeCase.status} onChange={e => updateField('status', e.target.value)}
```

Add `<option value="eskalert">🟠 Eskalert</option>` after the `waiting` option:
```tsx
<select aria-label="Status" value={activeCase.status} onChange={e => updateField('status', e.target.value)}
  className="text-[12px] font-semibold border-[1.5px] border-gray-200 rounded-full px-3 py-1 cursor-pointer outline-none bg-white text-gray-700 hover:border-[#003087] transition-colors appearance-none">
  <option value="ny">🔵 Ny</option>
  <option value="open">🟡 Åpen</option>
  <option value="waiting">🔷 Venter på kunde</option>
  <option value="eskalert">🟠 Eskalert</option>
  <option value="closed">🟢 Lukket</option>
</select>
```

- [ ] **Step 4: Filter agent dropdown to saksbehandler/admin only**

Find the agent `setAgents` call in the `useEffect` (around line 47):
```typescript
const { data: agentData } = await db.from('profiles').select('id, email, full_name, role').order('full_name');
setAgents((agentData as Profile[]) || []);
```

Replace with:
```typescript
const { data: agentData } = await db
  .from('profiles')
  .select('id, email, full_name, role, senter')
  .in('role', ['saksbehandler', 'admin'])
  .order('full_name');
setAgents((agentData as Profile[]) || []);
```

- [ ] **Step 5: Add escalation button to the detail header**

Find the flex row with the navigation buttons and the export link in the detail header (around line 243). Add the escalation button between the navigation buttons div and the export link:

```tsx
{/* Escalation button — only visible for senterledere on non-closed/non-eskalert cases */}
{currentUser?.role === 'senterleder' &&
  activeCase.status !== 'eskalert' &&
  activeCase.status !== 'closed' && (
  <button
    onClick={escalateCase}
    className="text-[12px] font-semibold px-3 py-1.5 rounded-lg border-[1.5px] border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100 transition-colors cursor-pointer">
    🔺 Eskaler til saksbehandler
  </button>
)}
```

Place this between the nav buttons `div` and the export `a` tag in the header flex row.

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add app/saksbehandling/page.tsx
git commit -m "feat: saksbehandling — escalation button, eskalert status, role-aware Navbar"
```

---

## Task 8: Update app/api/send-email/route.ts

**Files:**
- Modify: `app/api/send-email/route.ts`

Add the `escalation_notify` email type that fires when a senterleder escalates a case.

- [ ] **Step 1: Replace the file**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import sgMail from '@sendgrid/mail';
import { createClient } from '@supabase/supabase-js';

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

// Use service role key so RLS doesn't block fetching saksbehandler email addresses
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { type, to, caseId, replyContent, fromName, caseName, category, senter } = body;

    let subject = '';
    let html    = '';

    if (type === 'agent_reply') {
      subject = `Re: Din reklamasjon ${caseId} – NAF`;
      html    = `<p>Hei,</p><p>${replyContent}</p><p>Med vennlig hilsen,<br>${fromName}<br>NAF Reklamasjonsservice</p>`;

      await sgMail.send({ to, from: 'tom.van.aylward@gmail.com', subject, html });

    } else if (type === 'case_received') {
      subject = `Reklamasjon mottatt – ${caseId}`;
      html    = `<p>Hei,</p><p>Vi har mottatt din reklamasjon (${caseId}) og vil behandle den så snart som mulig.</p>`;

      await sgMail.send({ to, from: 'tom.van.aylward@gmail.com', subject, html });

    } else if (type === 'escalation_notify') {
      // Fetch all saksbehandler/admin emails
      const { data: handlers } = await db
        .from('profiles')
        .select('email')
        .in('role', ['saksbehandler', 'admin']);

      const recipients = (handlers || []).map(h => h.email).filter(Boolean);
      if (recipients.length === 0) {
        return NextResponse.json({ ok: true, sent: false, reason: 'No saksbehandlere found' });
      }

      subject = `🔺 Sak eskalert – ${caseId}`;
      html    = `
        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto">
          <div style="background:#003087;padding:16px 24px;border-radius:8px 8px 0 0">
            <span style="background:#E3000F;color:white;font-weight:700;font-size:12px;padding:3px 8px;border-radius:4px;margin-right:10px">NAF</span>
            <span style="color:white;font-weight:600;font-size:15px">Reklamasjonssystem – Eskalering</span>
          </div>
          <div style="background:#fff8f0;border:1px solid #fde8d0;border-radius:0 0 8px 8px;padding:24px">
            <h2 style="margin:0 0 12px;color:#92400E;font-size:18px">🔺 En sak er eskalert til saksbehandler</h2>
            <table style="width:100%;border-collapse:collapse;font-size:14px">
              <tr><td style="padding:6px 0;color:#6B7280;width:120px">Saksnummer</td><td style="font-weight:600;color:#003087;font-family:monospace">${caseId}</td></tr>
              <tr><td style="padding:6px 0;color:#6B7280">Kunde</td><td style="font-weight:600">${caseName || '–'}</td></tr>
              <tr><td style="padding:6px 0;color:#6B7280">Kategori</td><td>${category || '–'}</td></tr>
              <tr><td style="padding:6px 0;color:#6B7280">Senter</td><td>${senter || '–'}</td></tr>
              <tr><td style="padding:6px 0;color:#6B7280">Eskalert av</td><td>${fromName || '–'}</td></tr>
            </table>
            <div style="margin-top:20px">
              <a href="https://naf-reklamasjon-next.vercel.app/saksbehandling"
                style="background:#003087;color:white;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;font-size:14px">
                Åpne saksbehandling →
              </a>
            </div>
          </div>
        </div>`;

      await sgMail.sendMultiple({
        to:      recipients,
        from:    'tom.van.aylward@gmail.com',
        subject,
        html,
      });

    } else {
      return NextResponse.json({ error: 'Ukjent e-posttype' }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('SendGrid error:', err);
    return NextResponse.json({ error: 'E-postfeil' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/send-email/route.ts
git commit -m "feat: add escalation_notify email type, use service role key for profile lookup"
```

---

## Task 9: Fix notify-hanging-cases to use service role key

**Files:**
- Modify: `app/api/notify-hanging-cases/route.ts`

With RLS enabled on `cases`, this server-side route needs the service role key to bypass RLS and see all hanging cases regardless of senter.

- [ ] **Step 1: Update the createClient call**

Find (line 12):
```typescript
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);
```

Replace with:
```typescript
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);
```

- [ ] **Step 2: Commit**

```bash
git add app/api/notify-hanging-cases/route.ts
git commit -m "fix: use service role key in notify-hanging-cases to bypass RLS"
```

---

## Task 10: Add SUPABASE_SERVICE_ROLE_KEY to Vercel + build

- [ ] **Step 1: Get the service role key from Supabase**

Go to: Supabase project → Settings → API → `service_role` key (under "Project API keys")

Copy the key (starts with `eyJ...` — it's a JWT, not `SG.`).

- [ ] **Step 2: Add to Vercel**

Go to: Vercel project → Settings → Environment Variables

Add:
- Key: `SUPABASE_SERVICE_ROLE_KEY`
- Value: paste the key
- Environment: Production (and Preview)

Click Save.

- [ ] **Step 3: Verify build passes locally**

```bash
npm run build 2>&1 | tail -20
```

Expected: all routes listed, no TypeScript errors.

- [ ] **Step 4: Push and deploy**

```bash
git push origin main
vercel --prod
```

Expected: deployment completes without errors.

- [ ] **Step 5: Smoke test**

1. Log in as yourself (saksbehandler role after Task 4 Step 3)
2. Verify all cases still visible in `/saksbehandling`
3. Verify Rapportering link appears in Navbar
4. Open a case — verify no escalation button (you're saksbehandler, not senterleder)
5. Go to `/admin` — verify you can set a user to senterleder and assign a senter
6. Log in as the senterleder user — verify only their senter's cases are visible
7. Open a case — verify the "Eskaler til saksbehandler" button appears
8. Click it — verify case status changes to 🟠 Eskalert and you receive an email

---

## Self-Review Checklist

- [x] Task 1 covers: UserRole expansion, eskalert status, Profile.senter, Attachment/Template types
- [x] Task 2 covers: getCurrentUser() fetches senter, STATUS_LABEL includes eskalert
- [x] Task 3 covers: profiles.senter, attachments table, templates table
- [x] Task 4 covers: RLS on cases with two policies + own role set to saksbehandler
- [x] Task 5 covers: 3-role admin page with senter selector
- [x] Task 6 covers: Navbar role prop, Rapportering link for admin/saksbehandler
- [x] Task 7 covers: escalation button, eskalert status option, filtered agent dropdown
- [x] Task 8 covers: escalation_notify email to all saksbehandlere
- [x] Task 9 covers: service role key for RLS bypass in cron route
- [x] Task 10 covers: Vercel env var, build, deploy, smoke test
