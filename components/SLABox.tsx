import { formatDate } from '@/lib/supabase';
import type { Case } from '@/lib/types';

export default function SLABox({ c }: { c: Case }) {
  if (!c.sla_deadline) return <div className="text-sm text-gray-400">Ikke satt</div>;
  const deadline = new Date(c.sla_deadline), created = new Date(c.created_at), now = new Date();
  const pct      = Math.min(Math.round((now.getTime() - created.getTime()) / (deadline.getTime() - created.getTime()) * 100), 100);
  const daysLeft = Math.round((deadline.getTime() - now.getTime()) / 86400000);
  const isOver   = daysLeft < 0, isClosed = c.status === 'closed';
  const label    = isClosed ? 'Lukket' : isOver ? `${Math.abs(daysLeft)} dager over` : daysLeft === 0 ? 'Frist i dag' : `${daysLeft} dager igjen`;
  const badgeCls = isClosed ? 'bg-emerald-50 text-emerald-800' : isOver ? 'bg-red-50 text-red-700' : pct >= 70 ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800';
  const fillCls  = isClosed ? 'bg-emerald-500' : isOver ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-sm font-semibold text-gray-800">{label}</span>
        <span className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-full ${badgeCls}`}>
          {isClosed ? 'Lukket' : isOver ? 'Over fristen' : pct >= 70 ? 'Nærmer seg' : 'OK'}
        </span>
      </div>
      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${fillCls}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between text-[10px] text-gray-400 mt-1">
        <span>{formatDate(c.created_at)}</span>
        <span>{formatDate(c.sla_deadline)}</span>
      </div>
    </div>
  );
}
