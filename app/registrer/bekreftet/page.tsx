import Link from 'next/link';

export default function RegistrerBekreftetPage() {
  return (
    <div className="min-h-screen bg-[#F5F6FA] flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">
        <div className="flex items-center justify-center gap-3 mb-8">
          <span className="bg-[#E3000F] text-white font-bold text-xs px-2 py-1 rounded">NAF</span>
          <span className="font-semibold text-gray-800">Reklamasjonssystem</span>
        </div>
        <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center text-2xl mx-auto mb-4">
          ✅
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Søknad sendt</h1>
        <p className="text-sm text-gray-500 mb-6">
          Din forespørsel om tilgang er mottatt. Du vil få en e-post når en administrator har behandlet søknaden din.
        </p>
        <Link
          href="/login"
          className="text-sm font-semibold text-[#003087] hover:underline"
        >
          ← Tilbake til innlogging
        </Link>
      </div>
    </div>
  );
}
