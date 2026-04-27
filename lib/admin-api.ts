// lib/admin-api.ts
import { createClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';

export const adminDb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * Validates that the request Bearer token belongs to an admin user.
 * Returns { userId } on success, null on failure.
 */
export async function requireAdmin(req: NextRequest): Promise<{ userId: string } | null> {
  const auth  = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;

  const { data: { user }, error } = await adminDb.auth.getUser(token);
  if (error || !user) return null;

  const { data: profile } = await adminDb
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (!profile || (profile.role !== 'admin' && profile.role !== 'overordnet')) return null;
  return { userId: user.id };
}
