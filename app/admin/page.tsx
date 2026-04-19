// app/admin/page.tsx
'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { db, getCurrentUser } from '@/lib/supabase';
import type { Profile, UserRole, PendingRegistration } from '@/lib/types';
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
  const [currentUser, setCurrentUser]   = useState<Profile | null>(null);
  const [profiles,    setProfiles]       = useState<Profile[]>([]);
  const [pending,     setPending]        = useState<PendingRegistration[]>([]);
  const [updating,    setUpdating]       = useState<string | null>(null);
  const [message,     setMessage]        = useState('');
  const [expandedId,  setExpandedId]     = useState<string | null>(null);
  const [editName,  setEditName]  = useState('');
  const [editPhone, setEditPhone] = useState('');

  async function getToken(): Promise<string> {
    const { data: { session } } = await db.auth.getSession();
    return session?.access_token ?? '';
  }

  const loadData = useCallback(async () => {
    const [{ data: profileData }, { data: pendingData }] = await Promise.all([
      db.from('profiles').select('id, email, full_name, role, senter, phone, status').order('full_name'),
      db.from('pending_registrations').select('*').order('created_at'),
    ]);
    setProfiles((profileData as Profile[]) || []);
    setPending((pendingData as PendingRegistration[]) || []);
  }, []);

  useEffect(() => {
    (async () => {
      const user = await getCurrentUser();
      if (!user)                    { router.push('/login');           return; }
      if (user.role !== 'admin')    { router.push('/saksbehandling'); return; }
      setCurrentUser(user);
      await loadData();
    })();
  }, [router, loadData]);

  async function cycleRole(profile: Profile) {
    const newRole = ROLE_CYCLE[profile.role];
    setUpdating(profile.id);
    setMessage('');
    try {
      const { error } = await db.from('profiles').update({ role: newRole }).eq('id', profile.id);
      if (error) { setMessage(`Feil: ${error.message}`); }
      else        { setMessage(`${profile.full_name || profile.email} er nå ${ROLE_LABEL[newRole]}`); await loadData(); }
    } finally { setUpdating(null); }
  }

  async function updateSenter(profile: Profile, senter: string) {
    setUpdating(profile.id);
    try {
      await db.from('profiles').update({ senter: senter || null }).eq('id', profile.id);
      await loadData();
    } finally { setUpdating(null); }
  }

  async function approveUser(reg: PendingRegistration) {
    setUpdating(reg.id);
    setMessage('');
    try {
      const token = await getToken();
      const res = await fetch('/api/admin/approve-user', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body:    JSON.stringify({ id: reg.id }),
      });
      const data = await res.json();
      if (!res.ok) { setMessage(`Feil: ${data.error}`); }
      else          { setMessage(`${reg.full_name} er godkjent og har fått velkomst-e-post.`); await loadData(); }
    } finally { setUpdating(null); }
  }

  async function rejectUser(reg: PendingRegistration) {
    if (!confirm(`Avvis søknad fra ${reg.full_name}?`)) return;
    setUpdating(reg.id);
    setMessage('');
    try {
      const token = await getToken();
      const res = await fetch('/api/admin/reject-user', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body:    JSON.stringify({ id: reg.id }),
      });
      const data = await res.json();
      if (!res.ok) { setMessage(`Feil: ${data.error}`); }
      else          { setMessage(`Søknad fra ${reg.full_name} er avvist.`); await loadData(); }
    } finally { setUpdating(null); }
  }

  function toggleExpand(profile: Profile) {
    if (expandedId === profile.id) {
      setExpandedId(null);
    } else {
      setExpandedId(profile.id);
      setEditName(profile.full_name  || '');
      setEditPhone(profile.phone     || '');
    }
  }

  async function saveUserEdits(profile: Profile) {
    setUpdating(profile.id);
    setMessage('');
    try {
      const token = await getToken();
      const res = await fetch('/api/admin/update-user', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body:    JSON.stringify({ userId: profile.id, full_name: editName, phone: editPhone }),
      });
      const data = await res.json();
      if (!res.ok) { setMessage(`Feil: ${data.error}`); }
      else          { setMessage('Brukerinformasjon oppdatert.'); setExpandedId(null); await loadData(); }
    } finally { setUpdating(null); }
  }

  async function deleteUser(profile: Profile) {
    if (!confirm(`Er du sikker på at du vil slette ${profile.full_name || profile.email}? Dette kan ikke angres.`)) return;
    setUpdating(profile.id);
    setMessage('');
    try {
      const token = await getToken();
      const res = await fetch('/api/admin/delete-user', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body:    JSON.stringify({ userId: profile.id }),
      });
      const data = await res.json();
      if (!res.ok) { setMessage(`Feil: ${data.error}`); }
      else          { setMessage(`${profile.full_name || profile.email} er slettet.`); setExpandedId(null); await loadData(); }
    } finally { setUpdating(null); }
  }

  async function resetPassword(profile: Profile) {
    if (!confirm(`Tilbakestill passord for ${profile.full_name || profile.email}? Et nytt midlertidig passord sendes på e-post.`)) return;
    setUpdating(profile.id);
    setMessage('');
    try {
      const token = await getToken();
      const res = await fetch('/api/admin/reset-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body:    JSON.stringify({ userId: profile.id }),
      });
      const data = await res.json();
      if (!res.ok) { setMessage(`Feil: ${data.error}`); }
      else          { setMessage(`Nytt passord sendt til ${profile.email}.`); }
    } finally { setUpdating(null); }
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
        pendingCount={pending.length}
      />

      <div className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <h1 className="text-2xl font-bold text-[#003087] mb-6">Adminpanel — Brukere</h1>

          {message && (
            <div className="mb-4 px-4 py-2.5 bg-emerald-50 border border-emerald-100 rounded-lg text-sm text-emerald-700">
              {message}
            </div>
          )}

          {/* Pending registrations */}
          {pending.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-amber-200 overflow-hidden mb-6">
              <div className="px-5 py-4 border-b border-amber-100 bg-amber-50 flex items-center gap-2">
                <span className="text-amber-600 font-bold text-lg">🔔</span>
                <div>
                  <h2 className="text-sm font-semibold text-amber-800">
                    Ventende søknader ({pending.length})
                  </h2>
                  <p className="text-xs text-amber-600 mt-0.5">
                    Disse brukerne venter på godkjenning for tilgang.
                  </p>
                </div>
              </div>
              <div className="divide-y divide-amber-50">
                {pending.map(reg => (
                  <div key={reg.id} className="flex items-center gap-4 px-5 py-3.5">
                    <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center text-sm font-semibold text-amber-700 flex-shrink-0">
                      {reg.full_name[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800">{reg.full_name}</p>
                      <p className="text-xs text-gray-400">{reg.email} · {reg.senter}</p>
                      <p className="text-xs text-gray-300">
                        {new Date(reg.created_at).toLocaleDateString('nb-NO', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => approveUser(reg)}
                        disabled={updating === reg.id}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        {updating === reg.id ? '…' : '✅ Godkjenn'}
                      </button>
                      <button
                        onClick={() => rejectUser(reg)}
                        disabled={updating === reg.id}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-50 text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        {updating === reg.id ? '…' : '❌ Avvis'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Existing users */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700">Brukere ({profiles.length})</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Klikk på en bruker for å redigere. Klikk på rollen for å endre den.
              </p>
            </div>
            <div className="divide-y divide-gray-50">
              {profiles.map(profile => (
                <div key={profile.id}>
                  {/* Main row */}
                  <div
                    className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors cursor-pointer"
                    onClick={() => toggleExpand(profile)}
                  >
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
                      onChange={e => { e.stopPropagation(); updateSenter(profile, e.target.value); }}
                      onClick={e => e.stopPropagation()}
                      disabled={updating === profile.id}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none bg-white text-gray-600 cursor-pointer hover:border-[#003087] transition-colors w-48"
                    >
                      <option value="">Ikke tilordnet senter</option>
                      {SENTRE.map(s => (
                        <option key={s} value={s}>{s.replace('NAF Senter ', '')}</option>
                      ))}
                    </select>
                    <button
                      onClick={e => { e.stopPropagation(); cycleRole(profile); }}
                      disabled={updating === profile.id || profile.id === currentUser.id}
                      title={profile.id === currentUser.id ? 'Kan ikke endre din egen rolle' : `Klikk for å endre til ${ROLE_LABEL[ROLE_CYCLE[profile.role]]}`}
                      className={`text-xs font-semibold px-3 py-1.5 rounded-full cursor-pointer transition-all border-2 border-transparent hover:border-gray-300
                        ${ROLE_COLORS[profile.role]}
                        ${profile.id === currentUser.id ? 'opacity-40 cursor-not-allowed' : ''}
                        ${updating === profile.id ? 'opacity-50' : ''}`}
                    >
                      {updating === profile.id ? '...' : ROLE_LABEL[profile.role]}
                    </button>
                    <span className="text-gray-300 text-xs">{expandedId === profile.id ? '▲' : '▼'}</span>
                  </div>

                  {/* Inline edit panel */}
                  {expandedId === profile.id && (
                    <div className="px-5 pb-4 pt-2 bg-gray-50 border-t border-gray-100">
                      <div className="flex gap-3 flex-wrap items-end">
                        <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
                          <label className="text-xs font-semibold text-gray-500">Fullt navn</label>
                          <input
                            type="text"
                            value={editName}
                            onChange={e => setEditName(e.target.value)}
                            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-[#003087] bg-white"
                          />
                        </div>
                        <div className="flex flex-col gap-1 flex-1 min-w-[140px]">
                          <label className="text-xs font-semibold text-gray-500">Telefonnummer</label>
                          <input
                            type="tel"
                            value={editPhone}
                            onChange={e => setEditPhone(e.target.value)}
                            placeholder="+47 000 00 000"
                            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-[#003087] bg-white"
                          />
                        </div>
                        <button
                          onClick={() => saveUserEdits(profile)}
                          disabled={updating === profile.id}
                          className="text-xs font-semibold px-4 py-2 rounded-lg bg-[#003087] text-white hover:bg-[#001f5c] transition-colors disabled:opacity-50 cursor-pointer"
                        >
                          {updating === profile.id ? '…' : 'Lagre'}
                        </button>
                        <button
                          onClick={() => resetPassword(profile)}
                          disabled={updating === profile.id}
                          className="text-xs font-semibold px-4 py-2 rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors disabled:opacity-50 cursor-pointer"
                        >
                          🔑 Tilbakestill passord
                        </button>
                        <button
                          onClick={() => deleteUser(profile)}
                          disabled={updating === profile.id || profile.id === currentUser.id}
                          title={profile.id === currentUser.id ? 'Kan ikke slette deg selv' : undefined}
                          className={`text-xs font-semibold px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50 cursor-pointer
                            ${profile.id === currentUser.id ? 'cursor-not-allowed' : ''}`}
                        >
                          🗑 Slett bruker
                        </button>
                      </div>
                    </div>
                  )}
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
