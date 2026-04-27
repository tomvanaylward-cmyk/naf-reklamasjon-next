'use client';
import { useState } from 'react';
import type React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/supabase';

export default function LoginPage() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const router = useRouter();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');
    const { error } = await db.auth.signInWithPassword({ email, password });
    if (error) { setError('Feil e-post eller passord.'); setLoading(false); return; }
    router.push('/saksbehandling');
  }

  return (
    <div className="min-h-screen bg-[#F5F6FA] flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
        <div className="flex items-center gap-3 mb-8">
          <span className="bg-[#E3000F] text-white font-bold text-xs px-2 py-1 rounded">NAF</span>
          <span className="font-semibold text-gray-800">Reklamasjonssystem</span>
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-1">Logg inn</h1>
        <p className="text-sm text-gray-400 mb-6">For reklamasjonsansvarlig og administratorer</p>
        {error && <div className="bg-red-50 text-red-700 border border-red-200 rounded-lg px-4 py-3 text-sm mb-4">{error}</div>}
        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">E-post</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className="border-[1.5px] border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#003087] focus:ring-2 focus:ring-[#003087]/10" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">Passord</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
              className="border-[1.5px] border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#003087] focus:ring-2 focus:ring-[#003087]/10" />
          </div>
          <button type="submit" disabled={loading}
            className="bg-[#003087] text-white font-semibold py-2.5 rounded-lg text-sm hover:bg-[#001f5c] transition-colors disabled:opacity-50 cursor-pointer">
            {loading ? 'Logger inn...' : 'Logg inn'}
          </button>
        </form>

        <p className="text-xs text-gray-400 text-center mt-5">
          Senterleder uten tilgang?{' '}
          <Link href="/registrer" className="text-[#003087] font-semibold hover:underline">
            Søk om tilgang
          </Link>
        </p>
      </div>
    </div>
  );
}
