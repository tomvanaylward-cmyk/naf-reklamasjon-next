'use client';
import { useEffect, useState } from 'react';
import { db } from '@/lib/supabase';
import type { KunnskapsTreff, Prisspenn } from '@/lib/kunnskapsbase';

export default function LiknendeSaker({ caseId }: { caseId: string }) {
  const [treff, setTreff] = useState<KunnskapsTreff[]>([]);
  const [spenn, setSpenn] = useState<Prisspenn | null>(null);
  const [tilstand, setTilstand] = useState<'laster' | 'klar' | 'skjult' | 'feil'>('laster');
  const [visAlle, setVisAlle] = useState(false);
  const [feedbackGitt, setFeedbackGitt] = useState(false);

  useEffect(() => {
    let avbrutt = false;
    (async () => {
      setTilstand('laster'); setVisAlle(false); setFeedbackGitt(false);
      const { data: { session } } = await db.auth.getSession();
      if (!session) { setTilstand('skjult'); return; }
      try {
        const res = await fetch('/api/kunnskapsbase/liknende', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ caseId }),
        });
        const data = await res.json();
        if (avbrutt) return;
        if (!res.ok || data.aktiv === false) { setTilstand('skjult'); return; }
        setTreff(data.treff ?? []);
        setSpenn(data.prisspenn ?? null);
        setTilstand('klar');
      } catch { if (!avbrutt) setTilstand('feil'); }
    })();
    return () => { avbrutt = true; };
  }, [caseId]);

  async function giFeedback(nyttig: boolean) {
    setFeedbackGitt(true);
    const { data: { session } } = await db.auth.getSession();
    if (!session) return;
    fetch('/api/kunnskapsbase/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ caseId, nyttig }),
    }).catch(() => {});
  }

  if (tilstand === 'skjult') return null;

  return (
    <div className="bg-indigo-50/60 border border-indigo-200 rounded-xl p-3">
      <div className="text-[11px] font-bold uppercase tracking-wider text-indigo-900 mb-2">
        🔎 Liknende saker
      </div>

      {tilstand === 'laster' && <div className="text-[12px] text-gray-500">Søker…</div>}
      {tilstand === 'feil' && <div className="text-[12px] text-gray-500">Utilgjengelig akkurat nå.</div>}

      {tilstand === 'klar' && treff.length === 0 && (
        <div className="text-[12px] text-gray-500">Ingen sterkt liknende saker.</div>
      )}

      {tilstand === 'klar' && treff.length > 0 && (
        <>
          {spenn && spenn.antall > 0 && (
            <div className="bg-indigo-100 rounded-lg px-2.5 py-1.5 text-[12px] text-indigo-900 mb-2">
              <strong>Prisspenn:</strong> median {spenn.median.toLocaleString('nb-NO')} kr ·{' '}
              {spenn.min.toLocaleString('nb-NO')}–{spenn.max.toLocaleString('nb-NO')} kr · {spenn.antall} treff
            </div>
          )}
          {(visAlle ? treff : treff.slice(0, 3)).map((t) => (
            <div key={t.id} className="bg-white border border-gray-200 rounded-lg p-2.5 mb-1.5 text-[12px]">
              <div className="flex items-center justify-between gap-2 text-gray-500 mb-1">
                <span className="bg-emerald-500 text-white px-1.5 py-0.5 rounded-full text-[11px] font-semibold">
                  {Math.round(t.likhet * 100)}%
                </span>
                <span className="truncate">
                  {[t.tema, t.senter, t.tid_til_lukking_dager != null ? `${t.tid_til_lukking_dager} d` : null]
                    .filter(Boolean).join(' · ')}
                </span>
              </div>
              <p className="text-gray-800 line-clamp-2 m-0">{t.beskrivelse_anonymisert}</p>
              {t.losning_anonymisert && (
                <p className="text-gray-600 m-0 mt-1"><strong>Løsning:</strong> <span className="line-clamp-2">{t.losning_anonymisert}</span></p>
              )}
              <div className="text-gray-500 mt-1">
                <strong>Kostnad:</strong>{' '}
                {t.kostnad != null ? `${Number(t.kostnad).toLocaleString('nb-NO')} kr` : 'ikke oppgitt'}
              </div>
            </div>
          ))}
          {treff.length > 3 && (
            <button onClick={() => setVisAlle((v) => !v)}
              className="text-[12px] text-indigo-700 hover:underline cursor-pointer bg-transparent border-0 p-0">
              {visAlle ? 'Vis færre' : `Vis alle ${treff.length} treff`}
            </button>
          )}
          <div className="flex items-center gap-1.5 mt-2 text-[11px] text-gray-400">
            {feedbackGitt ? 'Takk for tilbakemeldingen!' : (
              <>Hjalp dette?
                <button onClick={() => giFeedback(true)} className="cursor-pointer bg-white border border-gray-200 rounded px-1.5 hover:border-emerald-400">👍</button>
                <button onClick={() => giFeedback(false)} className="cursor-pointer bg-white border border-gray-200 rounded px-1.5 hover:border-red-300">👎</button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
