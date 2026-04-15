'use client';
import { useState } from 'react';
import { db } from '@/lib/supabase';
import { calculateSLADeadline } from '@/lib/sla';

const KATEGORIER = [
  'Dekkskifte',
  'EU-kontroll',
  'Lakkskade',
  'Mekanisk arbeid',
  'Faktura / pris',
  'Kundebehandling',
  'Annet',
];

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

function generateCaseId(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `NAF-${year}${month}-${rand}`;
}

type Step = 'form' | 'success';

export default function NyReklamasjonPage() {
  const [step, setStep] = useState<Step>('form');
  const [caseId, setCaseId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    customer_name: '',
    customer_email: '',
    customer_phone: '',
    customer_type: 'privat',
    company: '',
    category: '',
    senter: '',
    description: '',
    desired_resolution: '',
    reg_nr: '',
    visit_date: '',
    order_number: '',
  });

  function set(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const id = generateCaseId();
    const slaDeadline = calculateSLADeadline(new Date().toISOString(), form.company || null);

    const { error: dbError } = await db.from('cases').insert({
      case_id:            id,
      customer_name:      form.customer_name,
      customer_email:     form.customer_email,
      customer_phone:     form.customer_phone || null,
      customer_type:      form.customer_type,
      company:            form.company || null,
      category:           form.category,
      senter:             form.senter || null,
      description:        form.description,
      desired_resolution: form.desired_resolution || null,
      reg_nr:             form.reg_nr || null,
      visit_date:         form.visit_date || null,
      order_number:       form.order_number || null,
      status:             'ny',
      priority:           'normal',
      sla_deadline:       slaDeadline,
      created_at:         new Date().toISOString(),
    });

    if (dbError) {
      setError('Noe gikk galt. Prøv igjen eller kontakt oss direkte.');
      setLoading(false);
      return;
    }

    // Send confirmation email (non-blocking)
    fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'case_received',
        to: form.customer_email,
        caseId: id,
      }),
    }).catch(() => {});

    setCaseId(id);
    setStep('success');
    setLoading(false);
  }

  if (step === 'success') {
    return (
      <div className="min-h-screen bg-[#F5F6FA] flex items-center justify-center p-4">
        <div className="w-full max-w-lg bg-white rounded-2xl border border-gray-200 shadow-sm p-10 text-center">
          <div className="w-14 h-14 rounded-full bg-emerald-50 border-2 border-emerald-200 flex items-center justify-center mx-auto mb-5">
            <svg className="w-7 h-7 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Reklamasjon mottatt</h1>
          <p className="text-gray-500 text-sm mb-6 leading-relaxed">
            Vi har mottatt din reklamasjon og sender deg en bekreftelse på e-post. En saksbehandler vil ta kontakt innen 2 virkedager.
          </p>
          <div className="bg-[#F5F6FA] border border-gray-200 rounded-xl px-5 py-4 mb-6">
            <div className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-1">Saksnummer</div>
            <div className="text-xl font-bold text-[#003087] font-mono tracking-wide">{caseId}</div>
          </div>
          <p className="text-xs text-gray-400">Ta vare på saksnummeret — du kan bruke det om du trenger å følge opp saken.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F6FA]">
      {/* Header */}
      <div className="bg-[#003087] shadow-[0_2px_16px_rgba(0,48,135,0.35)]">
        <div className="max-w-2xl mx-auto px-6 py-4 flex items-center gap-3">
          <span className="bg-[#E3000F] text-white font-bold text-xs px-2 py-1 rounded">NAF</span>
          <span className="text-white font-semibold text-[15px]">Reklamasjonsservice</span>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Send inn reklamasjon</h1>
          <p className="text-gray-500 text-sm leading-relaxed">
            Har du hatt en dårlig opplevelse hos oss? Fyll ut skjemaet under, så behandler vi saken din så raskt som mulig.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-6">

          {/* Kontaktinformasjon */}
          <Section title="Kontaktinformasjon">
            <div className="grid grid-cols-2 gap-3">
              <RadioCard
                label="Privatperson"
                checked={form.customer_type === 'privat'}
                onChange={() => set('customer_type', 'privat')}
              />
              <RadioCard
                label="Bedrift"
                checked={form.customer_type === 'bedrift'}
                onChange={() => set('customer_type', 'bedrift')}
              />
            </div>

            <Field label="Fullt navn" required>
              <input type="text" value={form.customer_name} onChange={e => set('customer_name', e.target.value)}
                placeholder="Ola Nordmann" required className={inputCls} />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="E-postadresse" required>
                <input type="email" value={form.customer_email} onChange={e => set('customer_email', e.target.value)}
                  placeholder="ola@eksempel.no" required className={inputCls} />
              </Field>
              <Field label="Telefonnummer">
                <input type="tel" value={form.customer_phone} onChange={e => set('customer_phone', e.target.value)}
                  placeholder="+47 900 00 000" className={inputCls} />
              </Field>
            </div>

            {form.customer_type === 'bedrift' && (
              <Field label="Bedriftsnavn">
                <input type="text" value={form.company} onChange={e => set('company', e.target.value)}
                  placeholder="Bedrift AS" className={inputCls} />
              </Field>
            )}
          </Section>

          {/* Om reklamasjonen */}
          <Section title="Om reklamasjonen">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Kategori" required>
                <select value={form.category} onChange={e => set('category', e.target.value)} required className={inputCls}>
                  <option value="">Velg kategori</option>
                  {KATEGORIER.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              </Field>
              <Field label="NAF-senter">
                <select value={form.senter} onChange={e => set('senter', e.target.value)} className={inputCls}>
                  <option value="">Velg senter</option>
                  {SENTRE.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </div>

            <Field label="Beskriv hva som gikk galt" required>
              <textarea value={form.description} onChange={e => set('description', e.target.value)}
                placeholder="Fortell oss hva som skjedde, så detaljert som mulig..."
                required rows={5} className={`${inputCls} resize-none`} />
            </Field>

            <Field label="Hva ønsker du som løsning?">
              <textarea value={form.desired_resolution} onChange={e => set('desired_resolution', e.target.value)}
                placeholder="F.eks. refusjon, reparasjon, ny kontroll..."
                rows={3} className={`${inputCls} resize-none`} />
            </Field>
          </Section>

          {/* Kjøretøy og besøk */}
          <Section title="Kjøretøy og besøk">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Reg.nr">
                <input type="text" value={form.reg_nr} onChange={e => set('reg_nr', e.target.value.toUpperCase())}
                  placeholder="AB 12345" className={`${inputCls} font-mono tracking-widest uppercase`} />
              </Field>
              <Field label="Besøksdato">
                <input type="date" value={form.visit_date} onChange={e => set('visit_date', e.target.value)}
                  className={inputCls} />
              </Field>
              <Field label="Ordrenummer">
                <input type="text" value={form.order_number} onChange={e => set('order_number', e.target.value)}
                  placeholder="123456" className={inputCls} />
              </Field>
            </div>
          </Section>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
              {error}
            </div>
          )}

          <button type="submit" disabled={loading}
            className="bg-[#003087] text-white font-semibold py-3.5 rounded-xl text-sm hover:bg-[#001f5c] transition-colors disabled:opacity-50 cursor-pointer w-full">
            {loading ? 'Sender inn...' : 'Send reklamasjon'}
          </button>

          <p className="text-xs text-gray-400 text-center leading-relaxed">
            Ved å sende inn samtykker du til at NAF behandler opplysningene dine for å håndtere reklamasjonen.
            Les mer i vår{' '}
            <a href="https://www.naf.no/personvern" target="_blank" rel="noopener noreferrer"
              className="underline hover:text-gray-600">personvernerklæring</a>.
          </p>
        </form>
      </div>
    </div>
  );
}

const inputCls = 'w-full border-[1.5px] border-gray-200 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#003087] focus:ring-2 focus:ring-[#003087]/8 bg-white text-gray-900 transition-colors';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6 flex flex-col gap-4">
      <h2 className="text-[11px] font-bold uppercase tracking-widest text-gray-400 pb-2 border-b border-gray-100">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold text-gray-600">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

function RadioCard({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <button type="button" onClick={onChange}
      className={`flex items-center gap-2.5 px-4 py-2.5 rounded-lg border-[1.5px] cursor-pointer transition-all text-sm font-medium
        ${checked ? 'border-[#003087] bg-blue-50 text-[#003087]' : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'}`}>
      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0
        ${checked ? 'border-[#003087]' : 'border-gray-300'}`}>
        {checked && <div className="w-2 h-2 rounded-full bg-[#003087]" />}
      </div>
      {label}
    </button>
  );
}
