// app/svar/[case_id]/page.tsx
import { adminDb } from '@/lib/admin-api';
import type { Message } from '@/lib/types';
import ReplyForm from './ReplyForm';

interface Props {
  params:       Promise<{ case_id: string }>;
  searchParams: Promise<{ token?: string }>;
}

export default async function SvarPage({ params, searchParams }: Props) {
  const { case_id }  = await params;
  const { token }    = await searchParams;

  const { data: caseRow, error: caseErr } = await adminDb
    .from('cases')
    .select('id, case_id, status, reply_token, customer_name, category, senter')
    .eq('case_id', case_id)
    .single();
  if (caseErr) console.error('[svar] case lookup failed:', caseErr.message);

  // Invalid case or token mismatch — show same generic error for both (don't reveal which)
  if (!caseRow || !token || token !== caseRow.reply_token) {
    return <InvalidState />;
  }

  if (caseRow.status === 'closed') {
    return <ClosedState />;
  }

  const { data: msgs, error: msgsErr } = await adminDb
    .from('messages')
    .select('id, type, sender_name, content, created_at')
    .eq('case_id', caseRow.id)
    .not('type', 'eq', 'internal')   // never show internal notes to customers
    .order('created_at', { ascending: false })
    .limit(3);
  if (msgsErr) console.error('[svar] messages lookup failed:', msgsErr.message);

  const contextMessages = ((msgs ?? []) as Pick<Message, 'id' | 'type' | 'sender_name' | 'content' | 'created_at'>[]).reverse();

  return (
    <div className="min-h-screen bg-[#F5F6FA]">
      <header className="bg-[#003087] px-6 py-4 flex items-center gap-3">
        <span className="bg-[#E3000F] text-white font-bold text-xs px-2 py-1 rounded">NAF</span>
        <span className="text-white font-semibold text-[15px]">Reklamasjonssystem</span>
      </header>
      <main className="max-w-xl mx-auto px-4 py-8">
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <div className="bg-[#F8F9FC] border-b border-gray-200 px-6 py-4">
            <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
              Din reklamasjon
            </div>
            <div className="text-[16px] font-bold text-gray-900 font-mono">{caseRow.case_id}</div>
            <div className="text-[13px] text-gray-500 mt-0.5">
              {caseRow.category}
              {caseRow.senter ? ` · ${caseRow.senter.replace('NAF ', '')}` : ''}
            </div>
          </div>
          <ReplyForm
            caseId={caseRow.case_id}
            caseUuid={caseRow.id}
            customerName={caseRow.customer_name}
            messages={contextMessages}
          />
        </div>
      </main>
    </div>
  );
}

function InvalidState() {
  return (
    <div className="min-h-screen bg-[#F5F6FA] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl border border-gray-200 p-8 max-w-md text-center shadow-sm">
        <div className="text-4xl mb-4">🔒</div>
        <h1 className="text-[16px] font-bold text-gray-900 mb-2">Ugyldig lenke</h1>
        <p className="text-[13px] text-gray-500 leading-relaxed">
          Lenken er ugyldig eller utløpt. Ta kontakt med oss direkte.
        </p>
      </div>
    </div>
  );
}

function ClosedState() {
  return (
    <div className="min-h-screen bg-[#F5F6FA] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl border border-gray-200 p-8 max-w-md text-center shadow-sm">
        <div className="text-4xl mb-4">✅</div>
        <h1 className="text-[16px] font-bold text-gray-900 mb-2">Saken er avsluttet</h1>
        <p className="text-[13px] text-gray-500 leading-relaxed">
          Denne saken er ferdigbehandlet. Har du nye spørsmål? Ta kontakt med oss direkte.
        </p>
      </div>
    </div>
  );
}
