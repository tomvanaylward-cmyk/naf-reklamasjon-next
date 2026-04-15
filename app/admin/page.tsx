'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { db, getCurrentUser } from '@/lib/supabase';
import type { Profile, UserRole } from '@/lib/types';
import Navbar from '@/components/Navbar';

export default function AdminPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [updating, setUpdating] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  async function loadProfiles() {
    const { data } = await db.from('profiles').select('id, email, full_name, role').order('full_name');
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

  async function toggleRole(profile: Profile) {
    const newRole: UserRole = profile.role === 'admin' ? 'agent' : 'admin';
    setUpdating(profile.id);
    setMessage('');
    try {
      const { error } = await db.from('profiles').update({ role: newRole }).eq('id', profile.id);
      if (error) {
        setMessage(`Feil: ${error.message}`);
      } else {
        setMessage(`${profile.full_name || profile.email} er nå ${newRole === 'admin' ? 'administrator' : 'agent'}`);
        await loadProfiles();
      }
    } finally {
      setUpdating(null);
    }
  }

  if (!currentUser) {
    return <div className="min-h-screen bg-[#f5f6fa] flex items-center justify-center text-gray-500">Laster...</div>;
  }

  return (
    <div className="min-h-screen bg-[#f5f6fa] flex flex-col">
      <Navbar userName={currentUser.full_name || currentUser.email} isAdmin={true} />

      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-6 py-6">
          <h1 className="text-2xl font-bold text-[#003087] mb-6">Adminpanel</h1>

          {message && (
            <div className="mb-4 px-4 py-2.5 bg-emerald-50 border border-emerald-100 rounded-lg text-sm text-emerald-700">
              {message}
            </div>
          )}

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700">Brukere ({profiles.length})</h2>
            </div>
            <div className="divide-y divide-gray-50">
              {profiles.map(profile => (
                <div key={profile.id} className="flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-[#003087]/10 flex items-center justify-center text-sm font-semibold text-[#003087] flex-shrink-0">
                      {(profile.full_name || profile.email)[0].toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{profile.full_name || '(intet navn)'}</p>
                      <p className="text-xs text-gray-400 truncate">{profile.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0 ml-4">
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full
                      ${profile.role === 'admin'
                        ? 'bg-purple-100 text-purple-700'
                        : 'bg-sky-100 text-sky-700'}`}>
                      {profile.role === 'admin' ? 'Administrator' : 'Agent'}
                    </span>
                    <button
                      onClick={() => toggleRole(profile)}
                      disabled={updating === profile.id || profile.id === currentUser.id}
                      title={profile.id === currentUser.id ? 'Kan ikke endre din egen rolle' : ''}
                      className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer border
                        ${profile.id === currentUser.id
                          ? 'opacity-40 cursor-not-allowed bg-gray-50 border-gray-200 text-gray-400'
                          : profile.role === 'admin'
                            ? 'bg-white border-gray-200 text-gray-600 hover:bg-red-50 hover:border-red-200 hover:text-red-600'
                            : 'bg-white border-gray-200 text-gray-600 hover:bg-purple-50 hover:border-purple-200 hover:text-purple-600'}
                        ${updating === profile.id ? 'opacity-50' : ''}`}
                    >
                      {updating === profile.id
                        ? 'Oppdaterer...'
                        : profile.role === 'admin'
                          ? 'Gjør til agent'
                          : 'Gjør til admin'}
                    </button>
                  </div>
                </div>
              ))}
              {profiles.length === 0 && (
                <div className="px-5 py-8 text-center text-sm text-gray-400">Ingen brukere funnet</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
