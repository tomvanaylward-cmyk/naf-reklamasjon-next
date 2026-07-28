'use client';
import { useState } from 'react';
import type { SearchHit, Prisspenn } from '@/types';

export default function Page() {
  const [tekst, setTekst] = useState('');
  const [treff, setTreff] = useState<SearchHit[]>([]);
  const [spenn, setSpenn] = useState<Prisspenn | null>(null);
  const [laster, setLaster] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);
  const [harSøkt, setHarSøkt] = useState(false);

  async function søkLiknende() {
    setLaster(true);
    setFeil(null);
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tekst }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeil(data.error ?? `Søket feilet (HTTP ${res.status})`);
        setTreff([]);
        setSpenn(null);
      } else {
        setTreff(data.treff ?? []);
        setSpenn(data.prisspenn ?? null);
      }
    } catch {
      setFeil('Klarte ikke å nå søke-API-et.');
      setTreff([]);
      setSpenn(null);
    } finally {
      setLaster(false);
      setHarSøkt(true);
    }
  }

  return (
    <main style={{ maxWidth: 760, margin: '40px auto', fontFamily: 'system-ui', padding: 16 }}>
      <h1>Finn liknende saker</h1>
      <textarea
        value={tekst}
        onChange={(e) => setTekst(e.target.value)}
        rows={4}
        placeholder="Lim inn beskrivelse av ny reklamasjon…"
        style={{ width: '100%', padding: 10, boxSizing: 'border-box' }}
      />
      <button onClick={søkLiknende} disabled={laster || !tekst.trim()} style={{ marginTop: 8, padding: '8px 16px' }}>
        {laster ? 'Søker…' : 'Søk liknende saker'}
      </button>

      {feil && (
        <div style={{ background: '#fee', border: '1px solid #c99', borderRadius: 8, padding: 12, marginTop: 16 }}>
          {feil}
        </div>
      )}

      {spenn && spenn.antall > 0 && (
        <div style={{ background: '#eef', border: '1px solid #99c', borderRadius: 8, padding: 12, marginTop: 16 }}>
          <strong>Estimert prisspenn:</strong> median {spenn.median.toLocaleString('nb-NO')} kr ·{' '}
          spenn {spenn.min.toLocaleString('nb-NO')}–{spenn.max.toLocaleString('nb-NO')} kr ·{' '}
          basert på {spenn.antall} treff
        </div>
      )}

      {harSøkt && !laster && !feil && treff.length === 0 && (
        <p style={{ marginTop: 16 }}>Ingen sterkt liknende saker.</p>
      )}

      {treff.map((t) => (
        <div key={t.sak.id} style={{ border: '1px solid #ccc', borderRadius: 8, padding: 12, marginTop: 10, background: '#fff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#666', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ background: '#10b981', color: '#fff', padding: '2px 8px', borderRadius: 12 }}>
              {Math.round(t.likhet * 100)}% likhet
            </span>
            <span>
              {t.sak.tema} · {t.sak.alvorlighet} · {t.sak.status} · {t.sak.senter}
              {t.sak.tid_til_lukking_dager != null ? ` · ${t.sak.tid_til_lukking_dager} dager` : ''}
            </span>
          </div>
          <p style={{ margin: '8px 0 4px' }}>{t.sak.beskrivelse_anonymisert}</p>
          {t.sak.losning_anonymisert && (
            <p style={{ margin: '4px 0', fontSize: 14, color: '#333' }}>
              <strong>Løsning:</strong> {t.sak.losning_anonymisert}
            </p>
          )}
          <div style={{ fontSize: 13 }}>
            <strong>Kostnad:</strong>{' '}
            {t.sak.kostnad != null
              ? `${t.sak.kostnad.toLocaleString('nb-NO')} kr (${t.sak.kostnad_kilde})`
              : 'ikke oppgitt'}
          </div>
        </div>
      ))}
    </main>
  );
}
