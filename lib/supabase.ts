import { createClient } from '@supabase/supabase-js';
import type { CaseStatus, CasePriority, Profile } from './types';

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const db = createClient(SUPABASE_URL, SUPABASE_ANON);

export const STATUS_LABEL: Record<CaseStatus, string> = {
  ny: 'Ny', open: 'Åpen', waiting: 'Venter', closed: 'Lukket'
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
  const { data } = await db.from('profiles').select('id, email, full_name, role').eq('id', user.id).single();
  return data as Profile | null;
}
