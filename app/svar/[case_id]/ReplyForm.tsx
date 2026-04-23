// app/svar/[case_id]/ReplyForm.tsx
'use client';
import { useMemo, useState } from 'react';
import type { Message } from '@/lib/types';
import { formatDate } from '@/lib/supabase';
import { validateFile, formatFileSize } from '@/lib/attachments';

interface Props {
  caseId:       string;   // human-readable e.g. "NAF-202604-8440"
  caseUuid:     string;   // UUID (unused — /api/attachments/upload resolves human-readable ID server-side)
  customerName: string;   // reserved for future greeting / personalisation
  messages:     Pick<Message, 'id' | 'type' | 'sender_name' | 'content' | 'created_at'>[];
}

export default function ReplyForm({ caseId, caseUuid: _caseUuid, customerName: _customerName, messages }: Props) {
  const [content,    setContent]    = useState('');
  const [file,       setFile]       = useState<File | null>(null);
  const [fileError,  setFileError]  = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done,       setDone]       = useState(false);
  const [error,      setError]      = useState('');

  // Read token once at mount — avoids re-reading if the URL ever changes client-side
  const token = useMemo(
    () => new URLSearchParams(window.location.search).get('token') ?? '',
    [],
  );

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    e.target.value = '';
    if (!f) return;
    const err = validateFile(f);
    if (err) { setFileError(err); return; }
    setFileError('');
    setFile(f);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = content.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError('');

    try {
      // 1. Submit text reply
      const res = await fetch('/api/customer-reply', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ case_id: caseId, token, content: trimmed }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? 'Noe gikk galt. Prøv igjen.');
        return;
      }

      // 2. Upload file if selected — fire and forget, don't block success message
      if (file) {
        const fd = new FormData();
        fd.append('case_id', caseId);
        fd.append('token',   token);   // validated server-side against cases.reply_token
        fd.append('files',   file);
        fetch('/api/attachments/upload', { method: 'POST', body: fd }).catch(() => {});
      }

      setDone(true);
    } catch {
      setError('Nettverksfeil. Sjekk internettforbindelsen og prøv igjen.');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Success state ────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="px-6 py-12 text-center">
        <div className="text-4xl mb-4" aria-hidden="true">✅</div>
        <h2 className="text-[16px] font-bold text-gray-900 mb-2">Takk for svaret ditt!</h2>
        <p className="text-[13px] text-gray-500 leading-relaxed">
          Vi behandler meldingen og kommer tilbake til deg så snart som mulig.
        </p>
      </div>
    );
  }

  // ── Form ─────────────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} className="p-6">

      {/* Previous messages for context (parent passes at most 3) */}
      {messages.length > 0 && (
        <div className="mb-5">
          <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">
            Tidligere meldinger
          </div>
          <div className="flex flex-col gap-2">
            {messages.slice(-3).map(m => (
              <div
                key={m.id}
                className={`text-[12px] rounded-lg px-3 py-2.5 ${
                  m.type === 'customer'
                    ? 'bg-gray-50 text-gray-700'
                    : 'bg-blue-50 text-[#003087]'
                }`}
              >
                <div className="font-semibold mb-0.5 text-[11px]">
                  {m.sender_name} · {formatDate(m.created_at)}
                </div>
                <div className="leading-relaxed line-clamp-3">{m.content}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reply textarea */}
      <div className="mb-4">
        <label className="block text-[12px] font-semibold text-gray-700 mb-1.5">
          Din melding til NAF <span className="text-red-500">*</span>
        </label>
        <textarea
          value={content}
          onChange={e => { setContent(e.target.value); setError(''); }}
          placeholder="Skriv din melding her…"
          required
          maxLength={5000}
          rows={5}
          className="w-full text-[13.5px] border-[1.5px] border-gray-200 rounded-xl px-3.5 py-2.5
                     resize-none outline-none leading-relaxed
                     focus:border-[#003087] focus:ring-2 focus:ring-[#003087]/10"
        />
        <div className="text-[11px] text-gray-400 text-right mt-0.5">
          {content.length}/5000
        </div>
      </div>

      {/* Optional file attachment */}
      <div className="mb-5">
        <div className="text-[12px] font-semibold text-gray-700 mb-1.5">
          Vedlegg <span className="text-gray-400 font-normal">(valgfritt)</span>
        </div>
        {file ? (
          <div className="flex items-center gap-2 text-[12.5px] text-gray-700
                          bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
            <span className="text-base" aria-hidden="true">{file.type.startsWith('image/') ? '🖼' : '📄'}</span>
            <span className="flex-1 truncate">{file.name}</span>
            <span className="text-gray-400 flex-shrink-0">{formatFileSize(file.size)}</span>
            <button
              type="button"
              onClick={() => { setFile(null); setFileError(''); }}
              className="text-gray-400 hover:text-red-600 cursor-pointer bg-transparent border-none"
              aria-label="Fjern vedlegg"
            >
              ✕
            </button>
          </div>
        ) : (
          <label className="flex items-center gap-2 text-[12.5px] font-semibold text-[#003087]
                            border-[1.5px] border-[#003087]/30 rounded-lg px-3 py-2
                            hover:bg-blue-50 cursor-pointer w-fit transition-colors">
            <span aria-hidden="true">📎</span>
            Legg til fil
            <span className="text-gray-400 font-normal text-[11.5px]">JPG, PNG, PDF · maks 10 MB</span>
            <input
              type="file"
              accept=".jpg,.jpeg,.png,.pdf"
              className="hidden"
              onChange={handleFileChange}
            />
          </label>
        )}
        {fileError && (
          <p className="text-red-600 text-[11px] mt-1">{fileError}</p>
        )}
      </div>

      {/* Submit error */}
      {error && (
        <div className="mb-4 text-[12.5px] text-red-700 bg-red-50
                        border border-red-200 rounded-lg px-3 py-2.5">
          {error}
        </div>
      )}

      {/* Submit button */}
      <button
        type="submit"
        disabled={submitting || !content.trim()}
        className="w-full bg-[#003087] text-white font-semibold text-[14px] py-3
                   rounded-xl hover:bg-[#001f5c] transition-colors cursor-pointer
                   disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.99]"
      >
        {submitting ? 'Sender…' : 'Send svar →'}
      </button>
    </form>
  );
}
