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
  senterleder:   'Senterleder',
  saksbehandler: 'Saksbehandler',
  admin:         'Administrator',
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
                  <div className="w-9 h-9 rounded-full bg-[#003087]/10 flex items-center justify-center text-sm font-semibold text-[#003087] flex-shrink-0">
                    {(profile.full_name || profile.email)[0].toUpperCase()}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {profile.full_name || '(intet navn)'}
                    </p>
                    <p className="text-xs text-gray-400 truncate">{profile.email}</p>
                  </div>

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
