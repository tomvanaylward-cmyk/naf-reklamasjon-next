'use client';
import type React from 'react';
import { formatDateTime } from '@/lib/supabase';
import { ML_SUGGESTIONS } from '@/lib/ml-suggestions';
import type { Case, Message, Attachment } from '@/lib/types';
import { formatFileSize } from '@/lib/attachments';

interface TimelineProps {
  activeCase:        Case;
  messages:          Message[];
  attachments:       Attachment[];
  onUseML:           (text: string) => void;
  onOpenAttachment:  (a: Attachment) => void;
}

export default function Timeline({ activeCase: c, messages, attachments, onUseML, onOpenAttachment }: TimelineProps) {
  const mlText = ML_SUGGESTIONS[c.category];
  const today  = new Date().toDateString();
  let todayInserted = false;

  type TLEntry =
    | { kind: 'message';    data: Message;    ts: number }
    | { kind: 'attachment'; data: Attachment; ts: number };

  const entries: TLEntry[] = [
    ...messages.map(m    => ({ kind: 'message'    as const, data: m, ts: new Date(m.created_at).getTime() })),
    ...attachments.map(a => ({ kind: 'attachment' as const, data: a, ts: new Date(a.created_at).getTime() })),
  ].sort((a, b) => a.ts - b.ts);

  return (
    <div className="relative pl-9">
      <div className="absolute left-2.5 top-2 bottom-2 w-0.5 bg-gray-200 rounded" />

      {/* Sak opprettet */}
      <TimelineItem dot="blue" label="Sak opprettet" labelCls="bg-blue-50 text-blue-700" time={formatDateTime(c.created_at)}>
        <div className="bg-white border border-gray-200 rounded-lg px-3.5 py-3 text-[13.5px] text-gray-700 leading-relaxed whitespace-pre-wrap">
          {c.description || '–'}
        </div>
      </TimelineItem>

      {/* ML-analyse */}
      {mlText && (
        <TimelineItem dot="amber" label="✦ ML-analyse" labelCls="bg-amber-50 text-amber-800" time="">
          <div className="bg-gradient-to-br from-amber-50 to-yellow-50 border border-yellow-300 rounded-lg px-3.5 py-3">
            <p className="text-[13px] text-amber-900 leading-relaxed mb-2">{mlText}</p>
            <button onClick={() => onUseML(mlText)}
              className="text-[12px] font-semibold text-amber-600 border-[1.5px] border-yellow-300 rounded-lg px-3 py-1 hover:bg-yellow-200 transition-colors cursor-pointer bg-transparent">
              Bruk dette svaret →
            </button>
          </div>
        </TimelineItem>
      )}

      {/* Meldinger og vedlegg */}
      {entries.map((entry, idx) => {
        if (entry.kind === 'attachment') {
          const a       = entry.data;
          const isImage = a.mime_type.startsWith('image/');
          return (
            <TimelineItem
              key={`att-${a.id}`}
              dot="gray"
              label="📎 Vedlegg"
              labelCls="bg-gray-100 text-gray-500"
              time={`${a.uploader_name ?? 'Kunde'} · ${formatDateTime(a.created_at)}`}
            >
              <button
                onClick={() => onOpenAttachment(a)}
                className="flex items-center gap-2 text-[13px] text-[#003087] hover:underline cursor-pointer bg-transparent border-none p-0"
              >
                <span>{isImage ? '🖼' : '📄'}</span>
                <span>{a.file_name}</span>
                <span className="text-gray-400">· {formatFileSize(a.file_size)}</span>
              </button>
            </TimelineItem>
          );
        }

        // message entry
        const m       = entry.data;
        const msgDate = new Date(m.created_at).toDateString();
        const showToday = !todayInserted && msgDate === today;
        if (showToday) todayInserted = true;

        const isCustomer = m.type === 'customer';
        const isInternal = m.type === 'internal';
        const boxCls = isCustomer  ? 'bg-blue-50 border-blue-200'
                     : isInternal  ? 'bg-amber-50 border-yellow-200'
                     :                'bg-emerald-50 border-emerald-200';
        const dotColor = isCustomer ? 'blue' : isInternal ? 'amber' : 'green';
        const lbl      = isCustomer ? '← Kunde' : isInternal ? '🔒 Internt' : '→ NAF';
        const lblCls   = isCustomer ? 'bg-blue-100 text-blue-700'
                       : isInternal ? 'bg-amber-50 text-amber-800'
                       :               'bg-emerald-50 text-emerald-800';
        return (
          <div key={m.id}>
            {showToday && <TodayDivider />}
            <TimelineItem dot={dotColor} label={lbl} labelCls={lblCls}
              time={`${m.sender_name} · ${formatDateTime(m.created_at)}`}>
              <div className={`border rounded-lg px-3.5 py-3 text-[13.5px] leading-relaxed whitespace-pre-wrap text-gray-700 ${boxCls}`}>
                {m.content}
              </div>
            </TimelineItem>
          </div>
        );
      })}

      {!todayInserted && <TodayDivider />}
    </div>
  );
}

const DOT_COLORS: Record<string, string> = {
  blue:  'bg-[#003087] shadow-[0_0_0_3px_rgba(0,48,135,0.2)]',
  amber: 'bg-amber-500 shadow-[0_0_0_3px_rgba(217,119,6,0.2)]',
  green: 'bg-emerald-500 shadow-[0_0_0_3px_rgba(5,150,105,0.2)]',
  gray:  'bg-gray-400',
};

function TimelineItem({ dot, label, labelCls, time, children }: {
  dot: string; label: string; labelCls: string; time: string; children: React.ReactNode;
}) {
  return (
    <div className="relative mb-5">
      <div className={`absolute -left-[26px] top-1 w-3.5 h-3.5 rounded-full border-2 border-white ${DOT_COLORS[dot] ?? DOT_COLORS.gray}`} />
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`text-[10.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${labelCls}`}>{label}</span>
        {time && <span className="text-[11px] text-gray-400 font-mono">{time}</span>}
      </div>
      {children}
    </div>
  );
}

function TodayDivider() {
  return (
    <div className="flex items-center gap-3 my-4 -ml-9 pl-9">
      <div className="flex-1 h-px bg-[#003087]/20" />
      <span className="text-[10.5px] font-bold text-[#003087]/50 uppercase tracking-widest">I dag</span>
      <div className="flex-1 h-px bg-[#003087]/20" />
    </div>
  );
}
