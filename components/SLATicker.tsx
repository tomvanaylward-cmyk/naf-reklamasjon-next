'use client';
import { useState, useEffect } from 'react';
import { getCompanySLADays } from '@/lib/sla';
import type { Case } from '@/lib/types';

export default function SLATicker({ c }: { c: Case }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  if (!c.sla_deadline) return null;

  // Vis kun ticker for bedriftskunder med tight SLA
  const isCompanySLA = getCompanySLADays(c.company) !== null;
  if (!isCompanySLA) return null;

  const deadline  = new Date(c.sla_deadline);
  const isClosed  = c.status === 'closed';
  const msLeft    = deadline.getTime() - now.getTime();
  const isOver    = msLeft < 0;
  const absMsLeft = Math.abs(msLeft);

  const totalMins = Math.floor(absMsLeft / 60000);
  const hours     = Math.floor(totalMins / 60);
  const mins      = totalMins % 60;

  let display = '';
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remH  = hours % 24;
    display = `${days}d ${remH}t ${mins}m`;
  } else {
    display = `${hours}t ${mins}m`;
  }

  const urgency = isClosed
    ? 'closed'
    : isOver
      ? 'over'
      : msLeft < 2 * 3600000   // under 2 timer
        ? 'critical'
        : msLeft < 6 * 3600000  // under 6 timer
          ? 'warning'
          : 'ok';

  const styles = {
    closed:   { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', dot: 'bg-emerald-500', label: 'Lukket' },
    over:     { bg: 'bg-red-50 border-red-200',         text: 'text-red-700',     dot: 'bg-red-500',     label: `${display} over fristen` },
    critical: { bg: 'bg-red-50 border-red-200',         text: 'text-red-700',     dot: 'bg-red-500 animate-pulse', label: `${display} igjen` },
    warning:  { bg: 'bg-amber-50 border-amber-200',     text: 'text-amber-800',   dot: 'bg-amber-500',   label: `${display} igjen` },
    ok:       { bg: 'bg-blue-50 border-blue-200',       text: 'text-[#003087]',   dot: 'bg-[#003087]',   label: `${display} igjen` },
  }[urgency];

  return (
    <div className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border ${styles.bg}`}>
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${styles.dot}`} />
      <div className="flex flex-col min-w-0">
        <span className={`text-[11px] font-bold uppercase tracking-wider ${styles.text}`}>
          {isClosed ? 'SLA-frist overholdt' : isOver ? 'Over SLA-frist' : 'SLA nedtelling'}
        </span>
        <span className={`text-[15px] font-bold font-mono tabular-nums leading-tight ${styles.text}`}>
          {isClosed ? '✓' : styles.label}
        </span>
      </div>
      {c.company && (
        <span className="ml-auto text-[10.5px] font-semibold text-gray-400 flex-shrink-0">
          {c.company}
        </span>
      )}
    </div>
  );
}
