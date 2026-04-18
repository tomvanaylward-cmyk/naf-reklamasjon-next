'use client';
import { useState } from 'react';
import type React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

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

export default function RegistrerPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email,    setEmail]    = useState('');
  const [senter,   setSenter]   = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!senter) { setError('Velg et senter.'); return; }

    setLoading(true);
    try {
      const res = await fetch('/api/admin/register', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ full_name: fullName, email, senter }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Noe gikk galt. Prøv igjen.');
        return;
      }
      router.push('/registrer/bekreftet');
    } catch {
      setError('Noe gikk galt. Sjekk internettforbindelsen din.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F5F6FA] flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
        <div className="flex items-center gap-3 mb-8">
          <span className="bg-[#E3000F] text-white font-bold text-xs px-2 py-1 rounded">NAF</span>
          <span className="font-semibold text-gray-800">Reklamasjonssystem</span>
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-1">Søk om tilgang</h1>
        <p className="text-sm text-gray-400 mb-6">
          For senterledere. En administrator godkjenner søknaden din.
        </p>

        {error && (
          <div className="bg-red-50 text-red-700 border border-red-200 rounded-lg px-4 py-3 text-sm mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">Fullt navn</label>
            <input
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              required
              placeholder="Ola Nordmann"
              className="border-[1.5px] border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#003087] focus:ring-2 focus:ring-[#003087]/10"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">E-post</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="ola@naf.no"
              className="border-[1.5px] border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#003087] focus:ring-2 focus:ring-[#003087]/10"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">Senter</label>
            <select
              value={senter}
              onChange={e => setSenter(e.target.value)}
              required
              className="border-[1.5px] border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#003087] focus:ring-2 focus:ring-[#003087]/10 bg-white text-gray-800"
            >
              <option value="">Velg ditt senter…</option>
              {SENTRE.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="bg-[#003087] text-white font-semibold py-2.5 rounded-lg text-sm hover:bg-[#001f5c] transition-colors disabled:opacity-50 cursor-pointer mt-1"
          >
            {loading ? 'Sender søknad…' : 'Send søknad'}
          </button>
        </form>

        <p className="text-xs text-gray-400 text-center mt-5">
          Har du allerede tilgang?{' '}
          <Link href="/login" className="text-[#003087] font-semibold hover:underline">
            Logg inn
          </Link>
        </p>
      </div>
    </div>
  );
}
