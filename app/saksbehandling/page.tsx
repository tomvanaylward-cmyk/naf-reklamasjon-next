'use client';
import type React from 'react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { db, getCurrentUser, formatDate, STATUS_LABEL, PRIO_LABEL } from '@/lib/supabase';
import { ML_SUGGESTIONS } from '@/lib/ml-suggestions';
import type { Case, Message, Profile, CaseStatus, CasePriority, CaseOutcome } from '@/lib/types';
import Navbar from '@/components/Navbar';
import StatusBadge from '@/components/StatusBadge';
import InfoRow from '@/components/InfoRow';
import Timeline from '@/components/Timeline';
import SLABox from '@/components/SLABox';

const PRIO_COLORS: Record<string, string> = {
  high: '#EF4444', critical: '#7C2D12', normal: '#9CA3AF', low: '#10B981'
};

export default function SaksbehandlingPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser]   = useState<Profile | null>(null);
  const [allCases, setAllCases]         = useState<Case[]>([]);
  const [filter, setFilter]             = useState<string>('alle');
  const [activeCase, setActiveCase]     = useState<Case | null>(null);
  const [messages, setMessages]         = useState<Message[]>([]);
  const [agents, setAgents]             = useState<Profile[]>([]);
  const [replyType, setReplyType]       = useState<'email' | 'internal'>('email');
  const [replyText, setReplyText]       = useState('');
  const [costEst, setCostEst]           = useState('');
  const [costAct, setCostAct]           = useState('');
  const tlRef = useRef<HTMLDivElement>(null);

  const filteredCases = filter === 'alle' ? allCases : allCases.filter(c => c.status === filter);
  const activeCaseIdx = activeCase ? filteredCases.findIndex(c => c.id === activeCase.id) : -1;

  const loadCases = useCallback(async () => {
    const { data } = await db.from('cases').select('*').order('created_at', { ascending: false });
    setAllCases((data as Case[]) || []);
  }, []);

  // Load user, cases, agents on mount
  useEffect(() => {
    (async () => {
      const user = await getCurrentUser();
      if (!user) { router.push('/login'); return; }
      setCurrentUser(user);
      await loadCases();
      const { data: agentData } = await db.from('profiles').select('id, email, full_name, role').order('full_name');
      setAgents((agentData as Profile[]) || []);
    })();
  }, [router, loadCases]);

  // Supabase realtime
  useEffect(() => {
    const channel = db.channel('cases-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cases' }, () => loadCases())
      .subscribe();
    return () => { db.removeChannel(channel); };
  }, [loadCases]);

  // Scroll timeline to bottom when messages change
  useEffect(() => {
    if (tlRef.current) tlRef.current.scrollTop = tlRef.current.scrollHeight;
  }, [messages]);

  async function openCase(id: string) {
    const c = allCases.find(c => c.id === id);
    if (!c) return;
    setActiveCase(c);
    const { data: msgs } = await db.from('messages').select('*').eq('case_id', id).order('created_at', { ascending: true });
    setMessages((msgs as Message[]) || []);
    setCostEst(c.cost_estimated != null ? String(c.cost_estimated) : '');
    setCostAct(c.cost_actual    != null ? String(c.cost_actual)    : '');
  }

  function navigateCase(dir: -1 | 1) {
    const next = filteredCases[activeCaseIdx + dir];
    if (next) openCase(next.id);
  }

  async function updateField(field: keyof Case, value: string | null) {
    if (!activeCase) return;
    await db.from('cases').update({ [field]: value, updated_at: new Date().toISOString() }).eq('id', activeCase.id);
    setActiveCase(prev => prev ? { ...prev, [field]: value } : prev);
    setAllCases(prev => prev.map(c => c.id === activeCase.id ? { ...c, [field]: value } : c));
  }

  async function saveCost() {
    if (!activeCase) return;
    const est = parseFloat(costEst) || null;
    const act = parseFloat(costAct) || null;
    await db.from('cases').update({ cost_estimated: est, cost_actual: act }).eq('id', activeCase.id);
    setActiveCase(prev => prev ? { ...prev, cost_estimated: est, cost_actual: act } : prev);
  }

  async function assignCase(userId: string) {
    if (!activeCase || !currentUser) return;
    const value = userId || null;
    await db.from('cases').update({ assigned_to: value, updated_at: new Date().toISOString() }).eq('id', activeCase.id);
    const agent = agents.find(a => a.id === value);
    const agentName = agent?.full_name || agent?.email || '–';
    const msg: Omit<Message, 'id'> = {
      case_id: activeCase.id,
      type: 'internal',
      sender_name: '🔁 System',
      content: value ? `Saken ble tildelt ${agentName}` : 'Tilordning fjernet',
      created_at: new Date().toISOString(),
    };
    await db.from('messages').insert(msg);
    setMessages(prev => [...prev, { ...msg, id: crypto.randomUUID() }]);
    setActiveCase(prev => prev ? { ...prev, assigned_to: value } : prev);
    setAllCases(prev => prev.map(c => c.id === activeCase.id ? { ...c, assigned_to: value } : c));
  }

  async function sendReply() {
    const content = replyText.trim();
    if (!content || !activeCase || !currentUser) return;
    const isEmail = replyType === 'email';
    const msg: Omit<Message, 'id'> = {
      case_id: activeCase.id,
      type: isEmail ? 'agent' : 'internal',
      sender_name: isEmail
        ? (currentUser.full_name || 'Saksbehandler')
        : `🔒 ${currentUser.full_name || 'Saksbehandler'}`,
      content,
      created_at: new Date().toISOString(),
    };
    await db.from('messages').insert(msg);
    if (isEmail && activeCase.status === 'ny') {
      await updateField('status', 'open');
    }
    if (isEmail) {
      fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'agent_reply', to: activeCase.customer_email,
          caseId: activeCase.case_id, replyContent: content, fromName: currentUser.full_name || 'NAF Saksbehandler' }),
      }).catch(() => {/* email errors are non-blocking */});
    }
    setMessages(prev => [...prev, { ...msg, id: crypto.randomUUID() }]);
    setReplyText('');
  }

  function useMLSuggestion(text: string) {
    setReplyText(text);
  }

  // Cost difference display
  const est = parseFloat(costEst) || 0;
  const act = parseFloat(costAct) || 0;
  let costDiff = '';
  let costDiffCls = 'text-gray-400';
  if (est > 0 && act > 0) {
    const d = act - est, pct = Math.round(d / est * 100);
    costDiff = `${d >= 0 ? '+' : ''}${Math.round(d).toLocaleString('nb-NO')} kr (${pct >= 0 ? '+' : ''}${pct}%)`;
    costDiffCls = d > 0 ? 'text-red-600' : 'text-emerald-600';
  }

  const openCount    = allCases.filter(c => c.status === 'open' || c.status === 'waiting').length;
  const newCount     = allCases.filter(c => c.status === 'ny').length;
  const closedCount  = allCases.filter(c => c.status === 'closed').length;
  const similarCases = activeCase
    ? allCases.filter(x => x.id !== activeCase.id && x.category === activeCase.category && x.status === 'closed').slice(0, 3)
    : [];

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#F5F6FA]">
      {currentUser && (
        <Navbar userName={currentUser.full_name || currentUser.email} isAdmin={currentUser.role === 'admin'} />
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-[290px] flex-shrink-0 bg-[#F8F9FC] border-r border-gray-200 flex flex-col overflow-hidden">
          <div className="p-3.5 border-b border-gray-200">
            <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2.5">Saker</div>
            {/* Stats */}
            <div className="grid grid-cols-3 gap-1.5 mb-2.5">
              {[['Åpne', openCount], ['Nye', newCount], ['Lukket', closedCount]].map(([label, count]) => (
                <div key={label as string} className="bg-white border border-gray-200 rounded-lg p-2 text-center">
                  <div className="text-[1.2rem] font-bold text-[#003087] font-mono">{count}</div>
                  <div className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">{label}</div>
                </div>
              ))}
            </div>
            {/* Filter pills */}
            <div className="flex gap-1 flex-wrap">
              {(['alle', 'ny', 'open', 'waiting', 'closed'] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border-[1.5px] cursor-pointer transition-colors
                    ${filter === f ? 'bg-[#003087] border-[#003087] text-white' : 'bg-white border-gray-200 text-gray-500 hover:border-[#003087] hover:text-[#003087]'}`}>
                  {f === 'alle' ? 'Alle' : STATUS_LABEL[f] ?? f}
                </button>
              ))}
            </div>
          </div>

          {/* Case list */}
          <div className="flex-1 overflow-y-auto p-1.5">
            {filteredCases.length === 0 ? (
              <div className="text-center py-10 text-gray-400 text-sm">Ingen saker her.</div>
            ) : (
              filteredCases.map(c => {
                const isOverdue = c.sla_deadline && new Date(c.sla_deadline) < new Date() && c.status !== 'closed';
                return (
                  <div key={c.id} onClick={() => openCase(c.id)}
                    className={`px-3 py-2.5 rounded-lg border-[1.5px] mb-0.5 cursor-pointer transition-colors
                      ${activeCase?.id === c.id
                        ? 'bg-blue-50 border-[rgba(0,48,135,0.18)]'
                        : 'border-transparent hover:bg-gray-50'}`}>
                    <div className="flex justify-between items-start gap-1.5 mb-0.5">
                      <span className="text-[13px] font-semibold text-gray-900 leading-snug">{c.customer_name}</span>
                      <span className="text-[10px] font-mono text-gray-400 flex-shrink-0">{c.case_id}</span>
                    </div>
                    <div className="text-[11.5px] text-gray-500 mb-1.5">{c.category} · {(c.senter || '').replace('NAF ', '')}</div>
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <StatusBadge status={c.status} />
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: PRIO_COLORS[c.priority || 'normal'] }} />
                        {isOverdue && <span className="text-[10px] text-red-600 font-bold">SLA!</span>}
                      </div>
                      <span className="text-[10.5px] font-mono text-gray-400">{formatDate(c.created_at)}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Detail panel */}
        <div className="flex-1 flex flex-col overflow-hidden bg-white">
          {!activeCase ? (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-300 gap-3">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
                <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
              </svg>
              <p className="text-sm">Velg en sak fra listen</p>
            </div>
          ) : (
            <>
              {/* Detail header */}
              <div className="bg-[#F8F9FC] border-b border-gray-200 px-5 py-3 flex-shrink-0">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => navigateCase(-1)} disabled={activeCaseIdx <= 0}
                      className="text-[12px] font-semibold px-2.5 py-1 rounded-lg border-[1.5px] border-gray-200 bg-white text-gray-500 cursor-pointer hover:border-[#003087] hover:text-[#003087] disabled:opacity-35 disabled:cursor-default transition-colors">
                      ← Forrige
                    </button>
                    <button onClick={() => navigateCase(1)} disabled={activeCaseIdx < 0 || activeCaseIdx >= filteredCases.length - 1}
                      className="text-[12px] font-semibold px-2.5 py-1 rounded-lg border-[1.5px] border-gray-200 bg-white text-gray-500 cursor-pointer hover:border-[#003087] hover:text-[#003087] disabled:opacity-35 disabled:cursor-default transition-colors">
                      Neste →
                    </button>
                  </div>
                  <div className="flex-1 text-[1rem] font-bold text-gray-900 tracking-tight">
                    {activeCase.customer_name} · {activeCase.category}
                  </div>
                  <a href="/eksport" className="text-[12px] font-semibold px-3 py-1.5 rounded-lg border-[1.5px] border-gray-200 bg-white text-gray-500 hover:border-[#003087] hover:text-[#003087] transition-colors no-underline">
                    📊 Eksporter
                  </a>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11.5px] font-mono text-gray-400">{activeCase.case_id}</span>
                  <select aria-label="Status" value={activeCase.status} onChange={e => updateField('status', e.target.value)}
                    className="text-[12px] font-semibold border-[1.5px] border-gray-200 rounded-full px-3 py-1 cursor-pointer outline-none bg-white text-gray-700 hover:border-[#003087] transition-colors appearance-none">
                    <option value="ny">🔵 Ny</option>
                    <option value="open">🟡 Åpen</option>
                    <option value="waiting">🔷 Venter på kunde</option>
                    <option value="closed">🟢 Lukket</option>
                  </select>
                  <select aria-label="Prioritet" value={activeCase.priority || 'normal'} onChange={e => updateField('priority', e.target.value)}
                    className="text-[12px] font-semibold border-[1.5px] border-gray-200 rounded-full px-3 py-1 cursor-pointer outline-none bg-white text-gray-700 hover:border-[#003087] transition-colors appearance-none">
                    <option value="low">▽ Lav</option>
                    <option value="normal">◇ Normal</option>
                    <option value="high">⚠ Høy</option>
                    <option value="critical">🔴 Kritisk</option>
                  </select>
                  <select aria-label="Tildelt saksbehandler" value={activeCase.assigned_to || ''} onChange={e => assignCase(e.target.value)}
                    className="text-[12px] font-semibold border-[1.5px] border-gray-200 rounded-full px-3 py-1 cursor-pointer outline-none bg-white text-gray-700 hover:border-[#003087] transition-colors appearance-none">
                    <option value="">👤 Ikke tildelt</option>
                    {agents.map(a => (
                      <option key={a.id} value={a.id}>{a.full_name || a.email}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Body: timeline + right sidebar */}
              <div className="flex flex-1 overflow-hidden">
                {/* Timeline */}
                <div ref={tlRef} className="flex-1 overflow-y-auto px-7 py-6">
                  <Timeline
                    activeCase={activeCase}
                    messages={messages}
                    similarCases={similarCases}
                    onUseML={useMLSuggestion}
                  />
                </div>

                {/* Right sidebar */}
                <div className="w-[300px] flex-shrink-0 border-l border-gray-200 bg-[#F8F9FC] overflow-y-auto p-4 flex flex-col gap-3.5">
                  {/* SLA */}
                  <div>
                    <div className="text-[10.5px] font-bold uppercase tracking-widest text-gray-400 mb-2 pb-1.5 border-b border-gray-200">SLA-frist</div>
                    <SLABox c={activeCase} />
                  </div>

                  {/* ML */}
                  {ML_SUGGESTIONS[activeCase.category] && (
                    <div>
                      <div className="text-[10.5px] font-bold uppercase tracking-widest text-gray-400 mb-2 pb-1.5 border-b border-gray-200">✦ ML-forslag</div>
                      <p className="text-[13px] text-gray-700 leading-relaxed mb-2">{ML_SUGGESTIONS[activeCase.category]}</p>
                      <button onClick={() => useMLSuggestion(ML_SUGGESTIONS[activeCase.category])}
                        className="text-[12px] font-semibold text-amber-600 border-[1.5px] border-yellow-300 rounded-lg px-3 py-1 hover:bg-yellow-100 transition-colors cursor-pointer bg-transparent">
                        Bruk dette svaret →
                      </button>
                    </div>
                  )}

                  {/* Kostnad */}
                  <div>
                    <div className="text-[10.5px] font-bold uppercase tracking-widest text-gray-400 mb-2 pb-1.5 border-b border-gray-200">Kostnadssporing</div>
                    <div className="grid grid-cols-2 gap-2 mb-1.5">
                      <div>
                        <label className="text-[10.5px] text-gray-400 block mb-1">Estimert (kr)</label>
                        <input type="number" value={costEst} onChange={e => setCostEst(e.target.value)} onBlur={saveCost} placeholder="0"
                          className="w-full text-[12.5px] px-2 py-1.5 border border-gray-200 rounded-lg outline-none focus:border-[#003087] bg-white" />
                      </div>
                      <div>
                        <label className="text-[10.5px] text-gray-400 block mb-1">Faktisk (kr)</label>
                        <input type="number" value={costAct} onChange={e => setCostAct(e.target.value)} onBlur={saveCost} placeholder="0"
                          className="w-full text-[12.5px] px-2 py-1.5 border border-gray-200 rounded-lg outline-none focus:border-[#003087] bg-white" />
                      </div>
                    </div>
                    <div className={`text-[12px] ${costDiff ? costDiffCls : 'text-gray-400'}`}>
                      {costDiff || 'Fyll inn begge felt'}
                    </div>
                  </div>

                  {/* Utfall */}
                  <div>
                    <div className="text-[10.5px] font-bold uppercase tracking-widest text-gray-400 mb-2 pb-1.5 border-b border-gray-200">Utfall ved lukking</div>
                    <div className="flex flex-col gap-1">
                      {([
                        ['approved', 'Godkjent reklamasjon'],
                        ['partial',  'Delvis godkjent'],
                        ['rejected', 'Avvist'],
                        ['dropped',  'Henlagt'],
                      ] as [CaseOutcome, string][]).map(([val, lbl]) => (
                        <label key={val}
                          className={`flex items-center gap-2 text-[13px] cursor-pointer px-1.5 py-1 rounded-lg transition-colors
                            ${activeCase.outcome === val ? 'font-semibold text-[#003087]' : 'text-gray-600 hover:bg-gray-100'}`}>
                          <input type="radio" name="outcome" value={val} checked={activeCase.outcome === val}
                            onChange={() => updateField('outcome', val)}
                            className="accent-[#003087]" />
                          {lbl}
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Saksinformasjon */}
                  <div>
                    <div className="text-[10.5px] font-bold uppercase tracking-widest text-gray-400 mb-2 pb-1.5 border-b border-gray-200">Saksinformasjon</div>
                    <InfoRow label="Opprettet"     value={formatDate(activeCase.created_at)} />
                    <InfoRow label="Kundetype"     value={activeCase.customer_type} />
                    <InfoRow label="E-post"        value={<a href={`mailto:${activeCase.customer_email}`} className="text-[#003087] text-xs">{activeCase.customer_email}</a>} />
                    <InfoRow label="Telefon"       value={activeCase.customer_phone} />
                    {activeCase.company && <InfoRow label="Bedrift" value={activeCase.company} />}
                    <InfoRow label="Ønsket løsning" value={activeCase.desired_resolution} />
                  </div>

                  {/* Kjøretøy */}
                  <div>
                    <div className="text-[10.5px] font-bold uppercase tracking-widest text-gray-400 mb-2 pb-1.5 border-b border-gray-200">Kjøretøy og verksted</div>
                    <InfoRow label="Reg.nr"     value={<span className="font-bold tracking-widest font-mono">{activeCase.reg_nr || '–'}</span>} />
                    <InfoRow label="Senter"     value={activeCase.senter} />
                    <InfoRow label="Dato besøk" value={formatDate(activeCase.visit_date)} />
                    <InfoRow label="Ordrenr."   value={activeCase.order_number} />
                  </div>
                </div>
              </div>

              {/* Reply area */}
              <div className="bg-[#F8F9FC] border-t border-gray-200 px-5 py-3 flex-shrink-0">
                <div className="flex gap-1.5 mb-2">
                  <button onClick={() => setReplyType('email')}
                    className={`text-[12px] font-semibold px-3 py-1.5 rounded-lg border-[1.5px] cursor-pointer transition-colors
                      ${replyType === 'email' ? 'bg-[#003087] border-[#003087] text-white' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                    📧 Svar til kunde
                  </button>
                  <button onClick={() => setReplyType('internal')}
                    className={`text-[12px] font-semibold px-3 py-1.5 rounded-lg border-[1.5px] cursor-pointer transition-colors
                      ${replyType === 'internal' ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                    🔒 Internt notat
                  </button>
                </div>
                <div className="flex gap-2 items-end">
                  <textarea value={replyText} onChange={e => setReplyText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendReply(); }}
                    placeholder={replyType === 'email' ? 'Skriv svar til kunden...' : 'Skriv internt notat...'}
                    className="flex-1 text-[13.5px] border-[1.5px] border-gray-200 rounded-xl px-3.5 py-2.5 resize-none outline-none min-h-[62px] leading-relaxed focus:border-[#003087] focus:ring-2 focus:ring-[#003087]/8 bg-white" />
                  <button onClick={sendReply} disabled={!replyText.trim()}
                    className={`h-10 px-4 rounded-xl text-white font-semibold text-sm cursor-pointer transition-colors disabled:opacity-40
                      ${replyType === 'internal' ? 'bg-amber-500 hover:bg-amber-600' : 'bg-[#003087] hover:bg-[#001f5c]'}`}>
                    Send
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
