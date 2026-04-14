// lib/supabase.ts
import { createClient } from '@supabase/supabase-js';
import type { Profile } from './types';

const SUPABASE_URL  = 'https://efnpfmcgapcgqiouopsx.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVmbnBmbWNnYXBjZ3Fpb3VvcHN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMDc5MzUsImV4cCI6MjA5MTU4MzkzNX0.Rm8QnxVVIXJzNW18JRX0tZlgfr6sJLpSbTqnzwirRmw';

export const db = createClient(SUPABASE_URL, SUPABASE_ANON);

export const STATUS_LABEL: Record<string, string> = {
  ny: 'Ny', open: 'Åpen', waiting: 'Venter', closed: 'Lukket'
};
export const PRIO_LABEL: Record<string, string> = {
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
  const { data: { session } } = await db.auth.getSession();
  if (!session) return null;
  const { data } = await db.from('profiles').select('*').eq('id', session.user.id).single();
  return data as Profile | null;
}
