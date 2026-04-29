'use client';
import type React from 'react';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { db, getCurrentUser, formatDate, STATUS_LABEL, PRIO_LABEL } from '@/lib/supabase';
import { ML_SUGGESTIONS } from '@/lib/ml-suggestions';
import type { Case, Message, Profile, CaseStatus, CasePriority, CaseOutcome, Attachment, Template } from '@/lib/types';
import { uploadAttachmentAuthenticated, getSignedUrl, validateFile, formatFileSize, MAX_FILES } from '@/lib/attachments';
import { NAF_SENTRE } from '@/lib/sentre';
import Navbar from '@/components/Navbar';
import InfoRow from '@/components/InfoRow';
import Timeline from '@/components/Timeline';
import SLABox from '@/components/SLABox';
import SLATicker from '@/components/SLATicker';

const PRIO_COLORS: Record<string, string> = {
  high: '#EF4444', critical: '#7C2D12', normal: '#9CA3AF', low: '#10B981'
};

const STATUS_BORDER: Record<string, string> = {
  ny:       '#003087',
  open:     '#F59E0B',
  waiting:  '#6366F1',
  eskalert: '#EA580C',
  closed:   '#D1D5DB',
};

function relativeDate(iso: string | null | undefined): string {
  if (!iso) return '–';
  const d = new Date(iso);
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (diffDays === 0) return 'i dag';
  if (diffDays === 1) return 'i går';
  if (diffDays < 7)  return `${diffDays}d`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}u`;
  return `${Math.floor(diffDays / 30)}m`;
}

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
  const [attachments,     setAttachments]     = useState<Attachment[]>([]);
  const [attachmentError, setAttachmentError] = useState('');
  const [lightboxUrl,     setLightboxUrl]     = useState<string | null>(null);
  const [uploading,       setUploading]       = useState(false);
  const [costEst, setCostEst]           = useState('');
  const [costAct, setCostAct]           = useState('');
  const [rightTab, setRightTab]         = useState<'sak' | 'okonomi' | 'vedlegg'>('sak');
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [search, setSearch]             = useState('');
  const [templates, setTemplates]       = useState<Template[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showTransfer,    setShowTransfer]    = useState(false);
  const [transferTo,      setTransferTo]      = useState('');
  const [transferReason,  setTransferReason]  = useState('');
  const [transferring,    setTransferring]    = useState(false);
  const tlRef = useRef<HTMLDivElement>(null);

  const statusFiltered = filter === 'alle' ? allCases : allCases.filter(c => c.status === filter);
  const filteredCases = useMemo(() => {
    const q = search.trim().toLowerCase().replace(/\s/g, '');
    const base = !q ? statusFiltered : statusFiltered.filter(c => {
      const hay = [
        c.customer_name, c.customer_email, c.case_id, c.category,
        c.senter, c.reg_nr, c.company, c.order_number, c.description,
      ].filter(Boolean).join(' ').toLowerCase().replace(/\s/g, '');
      return hay.includes(q);
    });
    // Sort eskalerte saker øverst (krever handling fra reklamasjonsansvarlig).
    // Innenfor hver gruppe beholdes opprinnelig sortering (created_at desc fra Supabase).
    return [...base].sort((a, b) => {
      const aEsc = a.status === 'eskalert' ? 0 : 1;
      const bEsc = b.status === 'eskalert' ? 0 : 1;
      return aEsc - bEsc;
    });
  }, [statusFiltered, search]);
  const activeCaseIdx = activeCase ? filteredCases.findIndex(c => c.id === activeCase.id) : -1;

  const loadCases = useCallback(async () => {
    const { data } = await db.from('cases').select('*').order('created_at', { ascending: false });
    setAllCases((data as Case[]) || []);
  }, []);

  // Les ?filter=eskalert (e.l.) fra URL og forhåndsvelg ved mount.
  // Brukes f.eks. fra eskalert-banneret på dashboardet.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const f = params.get('filter');
    if (f && ['alle','ny','open','waiting','eskalert','closed'].includes(f)) {
      setFilter(f);
    }
  }, []);

  // Load user, cases, agents on mount
  useEffect(() => {
    (async () => {
      const user = await getCurrentUser();
      if (!user) { router.push('/login'); return; }
      setCurrentUser(user);
      await loadCases();
      const { data: agentData } = await db
        .from('profiles')
        .select('id, email, full_name, role, senter')
        .in('role', ['reklamasjonsansvarlig', 'overordnet', 'admin'])
        .order('full_name');
      setAgents((agentData as Profile[]) || []);
      const { data: tplData } = await db
        .from('templates')
        .select('*')
        .order('name', { ascending: true });
      setTemplates((tplData as Template[]) || []);
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
    const [{ data: msgs }, { data: atts }] = await Promise.all([
      db.from('messages').select('*').eq('case_id', id).order('created_at', { ascending: true }),
      db.from('attachments')
        .select('*, uploader:profiles!uploader_id(full_name, email)')
        .eq('case_id', id)
        .order('created_at', { ascending: true }),
    ]);
    setMessages((msgs as Message[]) || []);
    const mapped: Attachment[] = ((atts as any[]) || []).map((a: any) => ({
      ...a,
      uploader_name: a.uploader ? (a.uploader.full_name || a.uploader.email) : null,
      uploader: undefined,
    }));
    setAttachments(mapped);
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

  async function transferCase() {
    if (!activeCase || !currentUser || !transferTo) return;
    if (transferTo === activeCase.senter) { setShowTransfer(false); return; }
    setTransferring(true);
    try {
      const toSenter = transferTo;
      const reason   = transferReason.trim();

      // Bruker service-role-endepunktet for å unngå RLS-hjørner ved senter-endring.
      const { data: { session } } = await db.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        alert('Du må være innlogget for å flytte saken.');
        setTransferring(false);
        return;
      }

      const res = await fetch('/api/case-transfer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          caseId:   activeCase.id,
          toSenter,
          reason,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(`Kunne ikke flytte saken: ${json.error || `HTTP ${res.status}`}`);
        setTransferring(false);
        return;
      }

      // Senterleder mister tilgang når senter endres → lukk saken og refresh listen.
      // Andre roller beholder tilgangen og fortsetter på saken.
      if (currentUser.role === 'senterleder') {
        setActiveCase(null);
        setMessages([]);
        await loadCases();
      } else {
        // Refresh saken og meldingene fra DB så audit-meldingen kommer fram.
        const [{ data: updatedCase }, { data: updatedMessages }] = await Promise.all([
          db.from('cases').select('*').eq('id', activeCase.id).single(),
          db.from('messages').select('*').eq('case_id', activeCase.id).order('created_at', { ascending: true }),
        ]);
        if (updatedCase) {
          setActiveCase(updatedCase as Case);
          setAllCases(prev => prev.map(c => c.id === activeCase.id ? (updatedCase as Case) : c));
        }
        if (updatedMessages) setMessages(updatedMessages as Message[]);
      }
      setShowTransfer(false);
      setTransferTo('');
      setTransferReason('');
    } finally {
      setTransferring(false);
    }
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
        ? (currentUser.full_name || 'NAF Reklamasjonsansvarlig')
        : `🔒 ${currentUser.full_name || 'NAF Reklamasjonsansvarlig'}`,
      content,
      created_at: new Date().toISOString(),
    };
    await db.from('messages').insert(msg);
    if (isEmail && activeCase.status === 'ny') {
      await updateField('status', 'open');
    }
    if (isEmail) {
      db.auth.getSession().then(({ data: { session } }) => {
        fetch('/api/send-email', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({ type: 'agent_reply', to: activeCase.customer_email,
            caseId: activeCase.case_id, replyContent: content, fromName: currentUser.full_name || 'NAF Reklamasjonsansvarlig' }),
        }).catch(() => {/* email errors are non-blocking */});
      });
    }
    setMessages(prev => [...prev, { ...msg, id: crypto.randomUUID() }]);
    setReplyText('');
  }

  async function escalateCase() {
    if (!activeCase || !currentUser) return;
    const now = new Date().toISOString();

    await db.from('cases').update({
      status:      'eskalert',
      assigned_to: null,
      updated_at:  now,
    }).eq('id', activeCase.id);

    const msg: Omit<Message, 'id'> = {
      case_id:     activeCase.id,
      type:        'internal',
      sender_name: '🔁 System',
      content:     `Saken ble eskalert av ${currentUser.full_name || currentUser.email} til reklamasjonsansvarlig`,
      created_at:  now,
    };
    await db.from('messages').insert(msg);
    setMessages(prev => [...prev, { ...msg, id: crypto.randomUUID() }]);

    db.auth.getSession().then(({ data: { session } }) => {
      fetch('/api/send-email', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          type:     'escalation_notify',
          caseId:   activeCase.case_id,
          caseName: activeCase.customer_name,
          category: activeCase.category,
          senter:   activeCase.senter,
          fromName: currentUser.full_name || currentUser.email,
        }),
      }).catch(() => {});
    });

    setActiveCase(prev => prev ? { ...prev, status: 'eskalert', assigned_to: null } : prev);
    setAllCases(prev => prev.map(c =>
      c.id === activeCase.id ? { ...c, status: 'eskalert', assigned_to: null } : c
    ));
  }

  async function handleAgentFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!activeCase || !currentUser) return;
    const selected = Array.from(e.target.files ?? []);
    e.target.value = '';

    if (selected.length === 0) return;
    if (selected.length > MAX_FILES) {
      setAttachmentError(`Maks ${MAX_FILES} filer per gang`);
      return;
    }
    for (const f of selected) {
      const err = validateFile(f);
      if (err) { setAttachmentError(err); return; }
    }

    setAttachmentError('');
    setUploading(true);

    for (const f of selected) {
      const err = await uploadAttachmentAuthenticated(activeCase.id, f, currentUser.id);
      if (err) { setAttachmentError(err); break; }
    }

    setUploading(false);

    // Refresh attachments list
    const { data: atts } = await db
      .from('attachments')
      .select('*, uploader:profiles!uploader_id(full_name, email)')
      .eq('case_id', activeCase.id)
      .order('created_at', { ascending: true });
    const mapped: Attachment[] = ((atts as any[]) || []).map((a: any) => ({
      ...a,
      uploader_name: a.uploader ? (a.uploader.full_name || a.uploader.email) : null,
      uploader: undefined,
    }));
    setAttachments(mapped);
  }

  async function openAttachment(a: Attachment) {
    const url = await getSignedUrl(a.storage_path);
    if (!url) { setAttachmentError('Kunne ikke åpne fil'); return; }
    if (a.mime_type.startsWith('image/')) {
      setLightboxUrl(url);
    } else {
      window.open(url, '_blank');
    }
  }

  function useMLSuggestion(text: string) {
    setReplyText(text);
  }

  function applyTemplate(t: Template) {
    if (!activeCase) return;
    const firstName = (activeCase.customer_name || '').split(' ')[0] || activeCase.customer_name || '';
    const body = t.body
      .replaceAll('{{navn}}',     firstName)
      .replaceAll('{{fullnavn}}', activeCase.customer_name || '')
      .replaceAll('{{case_id}}',  activeCase.case_id       || '')
      .replaceAll('{{reg_nr}}',   activeCase.reg_nr        || '')
      .replaceAll('{{senter}}',   (activeCase.senter || '').replace('NAF ', ''))
      .replaceAll('{{kategori}}', activeCase.category      || '');
    setReplyText(body);
    setShowTemplates(false);
  }

  async function saveAsTemplate() {
    if (!replyText.trim() || !currentUser) return;
    const name = window.prompt('Navn på malen:');
    if (!name || !name.trim()) return;
    const { data, error } = await db.from('templates').insert({
      name:       name.trim(),
      category:   activeCase?.category ?? null,
      body:       replyText,
      created_by: currentUser.id,
    }).select().single();
    if (error) { alert('Kunne ikke lagre mal: ' + error.message); return; }
    if (data) setTemplates(prev => [...prev, data as Template].sort((a, b) => a.name.localeCompare(b.name)));
  }

  async function deleteTemplate(id: string) {
    if (!confirm('Slette denne malen?')) return;
    const { error } = await db.from('templates').delete().eq('id', id);
    if (error) { alert('Kunne ikke slette: ' + error.message); return; }
    setTemplates(prev => prev.filter(t => t.id !== id));
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

  const openCount     = allCases.filter(c => c.status === 'open' || c.status === 'waiting').length;
  const newCount      = allCases.filter(c => c.status === 'ny').length;
  const closedCount   = allCases.filter(c => c.status === 'closed').length;
  const escalatedCount = allCases.filter(c => c.status === 'eskalert').length;
  const isStaff = currentUser?.role === 'admin' || currentUser?.role === 'overordnet' || currentUser?.role === 'reklamasjonsansvarlig';
  const similarCases = activeCase
    ? allCases.filter(x => x.id !== activeCase.id && x.category === activeCase.category && x.status === 'closed').slice(0, 3)
    : [];

  // Map normalized reg_nr → all cases with that plate (for duplicate detection)
  const regNrMap = useMemo(() => {
    const map = new Map<string, Case[]>();
    for (const c of allCases) {
      if (!c.reg_nr) continue;
      const key = c.reg_nr.toUpperCase().replace(/\s/g, '');
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return map;
  }, [allCases]);

  // Other cases sharing the same reg_nr as the open case
  const regNrSiblings: Case[] = activeCase?.reg_nr
    ? (regNrMap.get(activeCase.reg_nr.toUpperCase().replace(/\s/g, '')) ?? [])
        .filter(c => c.id !== activeCase.id)
    : [];

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#F5F6FA]">
      {currentUser && (
        <Navbar userName={currentUser.full_name || currentUser.email} role={currentUser.role} />
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-[290px] flex-shrink-0 bg-[#F8F9FC] border-r border-gray-200 flex flex-col overflow-hidden">
          <div className="p-3.5 border-b border-gray-200">
            <div className="flex items-center justify-between mb-2.5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Saker</div>
              {search && (
                <span className="text-[10.5px] text-gray-400">{filteredCases.length} treff</span>
              )}
            </div>
            {/* Search */}
            <div className="relative mb-2.5">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-gray-300 pointer-events-none">🔍</span>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Søk navn, reg.nr., sak…"
                className="w-full text-[12.5px] pl-7 pr-7 py-1.5 border border-gray-200 rounded-lg bg-white outline-none focus:border-[#003087] focus:ring-2 focus:ring-[#003087]/10 placeholder-gray-300"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  aria-label="Tøm søk"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-gray-300 hover:text-gray-600 cursor-pointer bg-transparent border-none"
                >
                  ✕
                </button>
              )}
            </div>
            {/* Stats — clickable quick filters.
                For staff (admin/overordnet/reklamasjonsansvarlig) vises Eskalert i stedet for Lukket,
                fordi eskalerte saker er det som krever handling. Senterleder ser fortsatt Lukket. */}
            <div className="grid grid-cols-3 gap-1.5 mb-2.5">
              {(isStaff
                ? [['Åpne', openCount, 'open'], ['Nye', newCount, 'ny'], ['🔺 Eskalert', escalatedCount, 'eskalert']] as const
                : [['Åpne', openCount, 'open'], ['Nye', newCount, 'ny'], ['Lukket', closedCount, 'closed']] as const
              ).map(([label, count, f]) => {
                const isEscalatedCard = f === 'eskalert';
                const hasEscalations = isEscalatedCard && count > 0;
                return (
                  <button key={label} onClick={() => setFilter(filter === f ? 'alle' : f)}
                    className={`rounded-lg p-2 text-center border transition-colors cursor-pointer
                      ${filter === f
                        ? (isEscalatedCard ? 'bg-orange-600 border-orange-600 text-white' : 'bg-[#003087] border-[#003087] text-white')
                        : hasEscalations
                          ? 'bg-orange-50 border-orange-300 hover:border-orange-500'
                          : 'bg-white border-gray-200 hover:border-[#003087]/40'}`}>
                    <div className={`text-[1.2rem] font-bold font-mono
                      ${filter === f ? 'text-white' : hasEscalations ? 'text-orange-700' : 'text-[#003087]'}`}>{count}</div>
                    <div className={`text-[10px] font-semibold uppercase tracking-wide
                      ${filter === f ? 'text-white/80' : hasEscalations ? 'text-orange-700' : 'text-gray-400'}`}>{label}</div>
                  </button>
                );
              })}
            </div>
            {/* Filter pills */}
            <div className="flex gap-1 flex-wrap">
              {(['alle', 'ny', 'open', 'waiting', 'eskalert', 'closed'] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border-[1.5px] cursor-pointer transition-colors
                    ${filter === f
                      ? (f === 'eskalert' ? 'bg-orange-600 border-orange-600 text-white' : 'bg-[#003087] border-[#003087] text-white')
                      : 'bg-white border-gray-200 text-gray-500 hover:border-[#003087] hover:text-[#003087]'}`}>
                  {f === 'alle' ? 'Alle' : f === 'eskalert' ? '🔺 Eskalert' : STATUS_LABEL[f] ?? f}
                </button>
              ))}
            </div>
          </div>

          {/* Case list */}
          <div className="flex-1 overflow-y-auto py-1.5">
            {filteredCases.length === 0 ? (
              <div className="text-center py-10 text-gray-400 text-sm">Ingen saker her.</div>
            ) : (
              filteredCases.map(c => {
                const isOverdue   = c.sla_deadline && new Date(c.sla_deadline) < new Date() && c.status !== 'closed';
                const isActive    = activeCase?.id === c.id;
                const dupCount    = c.reg_nr ? (regNrMap.get(c.reg_nr.toUpperCase().replace(/\s/g, '')) ?? []).length : 0;
                const showPrio    = c.priority === 'high' || c.priority === 'critical';
                const isEscalated = c.status === 'eskalert';
                return (
                  <div key={c.id} onClick={() => openCase(c.id)}
                    className={`flex items-stretch mx-1.5 mb-0.5 rounded-lg cursor-pointer transition-colors overflow-hidden
                      ${isActive ? 'bg-blue-50 shadow-sm' : 'hover:bg-gray-50'}`}>
                    {/* Status stripe */}
                    <div className="w-[3px] flex-shrink-0 rounded-l-lg"
                      style={{ background: STATUS_BORDER[c.status] ?? '#D1D5DB' }} />
                    {/* Content */}
                    <div className="flex-1 min-w-0 px-2.5 py-2.5">
                      {/* Row 1: name + relative date */}
                      <div className="flex items-baseline justify-between gap-1.5 mb-0.5">
                        <span className={`text-[13px] font-semibold leading-snug truncate ${isActive ? 'text-[#003087]' : 'text-gray-900'}`}>
                          {c.customer_name}
                        </span>
                        <span className="text-[10.5px] text-gray-400 flex-shrink-0 tabular-nums">{relativeDate(c.created_at)}</span>
                      </div>
                      {/* Row 2: category · senter */}
                      <div className="text-[11.5px] text-gray-400 mb-1.5 truncate">
                        {c.category}
                        {c.senter && <span className="text-gray-300"> · {c.senter.replace('NAF ', '')}</span>}
                      </div>
                      {/* Row 3: tags */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {isEscalated ? (
                          <span className="text-[10px] font-bold text-white bg-orange-600 rounded px-1.5 py-0.5 tracking-wide">
                            🔺 ESKALERT
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md"
                            style={{ background: `${STATUS_BORDER[c.status]}18`, color: STATUS_BORDER[c.status] }}>
                            {STATUS_LABEL[c.status as CaseStatus] ?? c.status}
                          </span>
                        )}
                        {isOverdue && (
                          <span className="text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">SLA!</span>
                        )}
                        {showPrio && (
                          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: PRIO_COLORS[c.priority] }} />
                        )}
                        {dupCount > 1 && (
                          <span title="Flere reklamasjoner på samme reg.nr."
                            className="text-[10px] font-bold text-orange-600 bg-orange-50 border border-orange-200 rounded px-1.5 py-0.5">
                            🚗×{dupCount}
                          </span>
                        )}
                      </div>
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
              {/* Detail header — single compact row */}
              <div className="bg-[#F8F9FC] border-b border-gray-200 px-4 py-2.5 flex-shrink-0 flex items-center gap-2">
                {/* Navigation */}
                <button onClick={() => navigateCase(-1)} disabled={activeCaseIdx <= 0}
                  className="text-[12px] px-2 py-1 rounded border border-gray-200 bg-white text-gray-400 cursor-pointer hover:text-[#003087] hover:border-[#003087] disabled:opacity-30 disabled:cursor-default transition-colors">
                  ←
                </button>
                <button onClick={() => navigateCase(1)} disabled={activeCaseIdx < 0 || activeCaseIdx >= filteredCases.length - 1}
                  className="text-[12px] px-2 py-1 rounded border border-gray-200 bg-white text-gray-400 cursor-pointer hover:text-[#003087] hover:border-[#003087] disabled:opacity-30 disabled:cursor-default transition-colors">
                  →
                </button>

                {/* Case identity */}
                <div className="flex items-baseline gap-2 flex-1 min-w-0">
                  <span className="font-bold text-gray-900 text-[14px] truncate">{activeCase.customer_name}</span>
                  <span className="text-gray-300 text-[13px]">·</span>
                  <span className="text-gray-500 text-[13px] truncate">{activeCase.category}</span>
                  <span className="text-[11px] font-mono text-gray-300 flex-shrink-0">{activeCase.case_id}</span>
                </div>

                {/* Controls */}
                <select aria-label="Status" value={activeCase.status} onChange={e => updateField('status', e.target.value)}
                  className="text-[12px] font-semibold border border-gray-200 rounded-full px-2.5 py-1 cursor-pointer outline-none bg-white text-gray-700 hover:border-[#003087] transition-colors appearance-none">
                  <option value="ny">🔵 Ny</option>
                  <option value="open">🟡 Åpen</option>
                  <option value="waiting">🔷 Venter</option>
                  <option value="eskalert">🟠 Eskalert</option>
                  <option value="closed">🟢 Lukket</option>
                </select>
                <select aria-label="Prioritet" value={activeCase.priority || 'normal'} onChange={e => updateField('priority', e.target.value)}
                  className="text-[12px] border border-gray-200 rounded-full px-2.5 py-1 cursor-pointer outline-none bg-white text-gray-600 hover:border-[#003087] transition-colors appearance-none">
                  <option value="low">▽ Lav</option>
                  <option value="normal">◇ Normal</option>
                  <option value="high">⚠ Høy</option>
                  <option value="critical">🔴 Kritisk</option>
                </select>
                <select aria-label="Tildelt" value={activeCase.assigned_to || ''} onChange={e => assignCase(e.target.value)}
                  className="text-[12px] border border-gray-200 rounded-full px-2.5 py-1 cursor-pointer outline-none bg-white text-gray-600 hover:border-[#003087] transition-colors appearance-none max-w-[140px]">
                  <option value="">👤 Ikke tildelt</option>
                  {agents.map(a => <option key={a.id} value={a.id}>{a.full_name || a.email}</option>)}
                </select>

                {/* ⋯ more menu */}
                <div className="relative">
                  <button onClick={() => setShowMoreMenu(v => !v)}
                    className="text-[13px] px-2.5 py-1 rounded border border-gray-200 bg-white text-gray-400 hover:text-gray-700 hover:border-gray-300 cursor-pointer transition-colors">
                    ⋯
                  </button>
                  {showMoreMenu && (
                    <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 py-1 min-w-[180px]"
                      onMouseLeave={() => setShowMoreMenu(false)}>
                      {currentUser?.role === 'senterleder' && activeCase.status !== 'eskalert' && activeCase.status !== 'closed' && (
                        <button onClick={() => { escalateCase(); setShowMoreMenu(false); }}
                          className="w-full text-left px-4 py-2 text-[13px] text-orange-700 hover:bg-orange-50 cursor-pointer">
                          🔺 Eskaler til reklamasjonsansvarlig
                        </button>
                      )}
                      <a href="/eksport"
                        className="block px-4 py-2 text-[13px] text-gray-700 hover:bg-gray-50 no-underline">
                        📊 Eksporter sak
                      </a>
                    </div>
                  )}
                </div>
              </div>


              {/* Body: timeline + right sidebar */}
              <div className="flex flex-1 overflow-hidden">
                {/* Timeline */}
                <div ref={tlRef} className="flex-1 overflow-y-auto px-7 py-6">
                  <Timeline
                    activeCase={activeCase}
                    messages={messages}
                    attachments={attachments}
                    similarCases={similarCases}
                    onUseML={useMLSuggestion}
                    onOpenAttachment={openAttachment}
                  />
                </div>

                {/* Right panel — tabbed */}
                <div className="w-[272px] flex-shrink-0 border-l border-gray-200 bg-[#F8F9FC] flex flex-col overflow-hidden">

                  {/* SLA — always visible */}
                  <div className="px-4 pt-3 pb-2.5 border-b border-gray-200 flex-shrink-0">
                    <SLABox c={activeCase} />
                    <div className="mt-1.5">
                      <SLATicker c={activeCase} />
                    </div>
                  </div>

                  {/* Tab bar */}
                  <div className="flex border-b border-gray-200 flex-shrink-0 bg-white">
                    {(['sak', 'okonomi', 'vedlegg'] as const).map(tab => {
                      const labels: Record<string, string> = { sak: 'Sak', okonomi: 'Økonomi', vedlegg: `Vedlegg${attachments.length ? ` (${attachments.length})` : ''}` };
                      return (
                        <button key={tab} onClick={() => setRightTab(tab)}
                          className={`flex-1 text-[11.5px] font-semibold py-2 border-b-2 transition-colors cursor-pointer
                            ${rightTab === tab
                              ? 'border-[#003087] text-[#003087]'
                              : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                          {labels[tab]}
                        </button>
                      );
                    })}
                  </div>

                  {/* Tab content */}
                  <div className="flex-1 overflow-y-auto p-4">

                    {/* SAK TAB */}
                    {rightTab === 'sak' && (
                      <div className="flex flex-col gap-4">
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Kontakt</div>
                          <InfoRow label="Navn"    value={activeCase.customer_name} />
                          <InfoRow label="E-post"  value={<a href={`mailto:${activeCase.customer_email}`} className="text-[#003087] text-xs hover:underline">{activeCase.customer_email}</a>} />
                          <InfoRow label="Telefon" value={activeCase.customer_phone} />
                          {activeCase.company && <InfoRow label="Bedrift" value={activeCase.company} />}
                        </div>
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Sak</div>
                          <InfoRow label="Opprettet"     value={formatDate(activeCase.created_at)} />
                          <InfoRow label="Kundetype"     value={activeCase.customer_type} />
                          <InfoRow label="Ønsket løsning" value={activeCase.desired_resolution} />
                        </div>
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Kjøretøy</div>
                          <InfoRow label="Reg.nr"     value={<span className="font-bold tracking-widest font-mono text-[12px]">{activeCase.reg_nr || '–'}</span>} />
                          {regNrSiblings.length > 0 && (
                            <div className="mt-1.5 mb-1 bg-orange-50 border border-orange-200 rounded-lg px-2.5 py-2">
                              <div className="text-[11px] font-bold text-orange-700 mb-1.5">
                                ⚠ {regNrSiblings.length} annen{regNrSiblings.length > 1 ? 'e' : ''} sak{regNrSiblings.length > 1 ? 'er' : ''} med {activeCase.reg_nr}
                              </div>
                              <div className="flex flex-col gap-1">
                                {regNrSiblings.map(s => (
                                  <button key={s.id} onClick={() => openCase(s.id)}
                                    className="text-left text-[11px] text-orange-700 hover:text-orange-900 hover:underline cursor-pointer bg-transparent border-none p-0">
                                    {s.customer_name} · {relativeDate(s.created_at)}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="flex justify-between items-center gap-3 py-1.5 border-b border-gray-100 text-[13px]">
                            <span className="text-gray-400 text-[12px] shrink-0">Senter</span>
                            <span className="flex items-center gap-2">
                              <span className="text-gray-800 font-medium text-right">{activeCase.senter || '–'}</span>
                              <button
                                onClick={() => { setTransferTo(''); setTransferReason(''); setShowTransfer(true); }}
                                className="text-[10.5px] font-semibold text-[#003087] border border-[#003087]/30 rounded-md px-2 py-0.5 hover:bg-[#003087] hover:text-white transition-colors cursor-pointer bg-transparent"
                                title="Flytt sak til annet senter"
                              >
                                Flytt →
                              </button>
                            </span>
                          </div>
                          <InfoRow label="Besøksdato" value={formatDate(activeCase.visit_date)} />
                          <InfoRow label="Ordrenr."   value={activeCase.order_number} />
                        </div>
                        {ML_SUGGESTIONS[activeCase.category] && (
                          <div className="bg-amber-50 border border-yellow-200 rounded-lg p-3">
                            <div className="text-[10px] font-bold uppercase tracking-widest text-amber-600 mb-1.5">✦ ML-forslag</div>
                            <p className="text-[12px] text-amber-900 leading-relaxed mb-2">{ML_SUGGESTIONS[activeCase.category]}</p>
                            <button onClick={() => useMLSuggestion(ML_SUGGESTIONS[activeCase.category])}
                              className="text-[11.5px] font-semibold text-amber-700 border border-yellow-300 rounded-md px-2.5 py-1 hover:bg-yellow-100 transition-colors cursor-pointer bg-transparent">
                              Bruk svaret →
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* ØKONOMI TAB */}
                    {rightTab === 'okonomi' && (
                      <div className="flex flex-col gap-4">
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Kostnadssporing</div>
                          <div className="grid grid-cols-2 gap-2 mb-2">
                            <div>
                              <label className="text-[10.5px] text-gray-400 block mb-1">Estimert (kr)</label>
                              <input type="number" value={costEst} onChange={e => setCostEst(e.target.value)} onBlur={saveCost} placeholder="0"
                                className="w-full text-[13px] px-2.5 py-2 border border-gray-200 rounded-lg outline-none focus:border-[#003087] bg-white" />
                            </div>
                            <div>
                              <label className="text-[10.5px] text-gray-400 block mb-1">Faktisk (kr)</label>
                              <input type="number" value={costAct} onChange={e => setCostAct(e.target.value)} onBlur={saveCost} placeholder="0"
                                className="w-full text-[13px] px-2.5 py-2 border border-gray-200 rounded-lg outline-none focus:border-[#003087] bg-white" />
                            </div>
                          </div>
                          {costDiff && (
                            <div className={`text-[13px] font-semibold ${costDiffCls}`}>{costDiff}</div>
                          )}
                        </div>
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Utfall ved lukking</div>
                          <div className="flex flex-col gap-1">
                            {([
                              ['approved', '✅ Godkjent reklamasjon'],
                              ['partial',  '🟡 Delvis godkjent'],
                              ['rejected', '❌ Avvist'],
                              ['dropped',  '📁 Henlagt'],
                            ] as [CaseOutcome, string][]).map(([val, lbl]) => (
                              <label key={val}
                                className={`flex items-center gap-2 text-[13px] cursor-pointer px-2 py-1.5 rounded-lg transition-colors
                                  ${activeCase.outcome === val ? 'bg-blue-50 font-semibold text-[#003087]' : 'text-gray-600 hover:bg-gray-100'}`}>
                                <input type="radio" name="outcome" value={val} checked={activeCase.outcome === val}
                                  onChange={() => updateField('outcome', val)} className="accent-[#003087]" />
                                {lbl}
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* VEDLEGG TAB */}
                    {rightTab === 'vedlegg' && (
                      <div className="flex flex-col gap-3">
                        {attachments.length === 0 ? (
                          <p className="text-[13px] text-gray-400 py-4 text-center">Ingen vedlegg ennå</p>
                        ) : (
                          attachments.map(a => (
                            <button key={a.id} onClick={() => openAttachment(a)}
                              className="flex items-center gap-2.5 text-left w-full text-[12.5px] text-[#003087] hover:bg-blue-50 rounded-lg px-2.5 py-2 transition-colors cursor-pointer bg-transparent border border-gray-100">
                              <span className="text-[16px] flex-shrink-0">{a.mime_type.startsWith('image/') ? '🖼' : '📄'}</span>
                              <div className="min-w-0 flex-1">
                                <div className="truncate font-medium">{a.file_name}</div>
                                <div className="text-[11px] text-gray-400">{formatFileSize(a.file_size)}</div>
                              </div>
                            </button>
                          ))
                        )}
                        <label className={`mt-1 text-[12.5px] font-semibold border-[1.5px] rounded-lg px-3 py-2 transition-colors flex items-center gap-1.5 justify-center
                          ${uploading ? 'text-gray-400 border-gray-200 cursor-not-allowed' : 'text-[#003087] border-[#003087]/30 hover:bg-blue-50 cursor-pointer'}`}>
                          {uploading ? '📎 Laster opp...' : '📎 Last opp fil'}
                          <input type="file" multiple accept=".jpg,.jpeg,.png,.pdf" className="hidden" disabled={uploading} onChange={handleAgentFileUpload} />
                        </label>
                        {attachmentError && <p className="text-red-600 text-[11px]">{attachmentError}</p>}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Reply area — compose box */}
              <div className="bg-[#F8F9FC] border-t border-gray-200 px-4 py-3 flex-shrink-0">
                <div className={`rounded-xl border-2 bg-white overflow-hidden transition-colors
                  ${replyType === 'internal' ? 'border-amber-300' : 'border-[#003087]/20 focus-within:border-[#003087]/50'}`}>
                  {/* Mode tabs */}
                  <div className={`flex border-b ${replyType === 'internal' ? 'border-amber-200 bg-amber-50/60' : 'border-gray-100'}`}>
                    <button onClick={() => setReplyType('email')}
                      className={`text-[12px] font-semibold px-4 py-2 border-b-2 transition-colors cursor-pointer
                        ${replyType === 'email'
                          ? 'border-[#003087] text-[#003087] bg-white'
                          : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                      📧 Svar til kunde
                    </button>
                    <button onClick={() => setReplyType('internal')}
                      className={`text-[12px] font-semibold px-4 py-2 border-b-2 transition-colors cursor-pointer
                        ${replyType === 'internal'
                          ? 'border-amber-500 text-amber-700 bg-white'
                          : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                      🔒 Internt notat
                    </button>
                    <div className="flex-1" />
                    <span className="text-[10.5px] text-gray-300 self-center pr-3 select-none hidden sm:block">⌘↵ for å sende</span>
                  </div>
                  {/* Textarea */}
                  <textarea value={replyText} onChange={e => setReplyText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendReply(); }}
                    placeholder={replyType === 'email' ? 'Skriv svar til kunden…' : 'Skriv internt notat…'}
                    className={`w-full text-[13.5px] px-4 py-3 resize-none outline-none min-h-[110px] leading-relaxed bg-transparent
                      ${replyType === 'internal' ? 'placeholder-amber-300' : 'placeholder-gray-300'}`} />
                  {/* Footer */}
                  <div className={`flex items-center justify-between gap-2 px-3 py-2 border-t ${replyType === 'internal' ? 'border-amber-100 bg-amber-50/40' : 'border-gray-100'}`}>
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {replyType === 'email' && (
                        <div className="relative">
                          <button
                            onClick={() => setShowTemplates(v => !v)}
                            className="text-[11.5px] font-semibold text-[#003087] border border-[#003087]/20 rounded-md px-2 py-1 hover:bg-[#003087]/5 cursor-pointer bg-white transition-colors"
                          >
                            📋 Maler {templates.length > 0 && <span className="text-gray-400 font-normal">· {templates.length}</span>}
                          </button>
                          {showTemplates && (
                            <div
                              className="absolute left-0 bottom-full mb-2 bg-white border border-gray-200 rounded-xl shadow-lg z-30 w-[400px] max-h-[400px] overflow-y-auto"
                              onMouseLeave={() => setShowTemplates(false)}
                            >
                              {templates.length === 0 ? (
                                <div className="p-4 text-[12px] text-gray-400 text-center">
                                  Ingen maler enda. Skriv et svar og trykk «Lagre som mal».
                                </div>
                              ) : (
                                <>
                                  {(() => {
                                    const cat = activeCase.category;
                                    const match = templates.filter(t => t.category === cat);
                                    const generic = templates.filter(t => t.category === null);
                                    const other = templates.filter(t => t.category && t.category !== cat);
                                    const sections: [string, Template[]][] = [
                                      [`For ${cat}`, match],
                                      ['Generelle',  generic],
                                      ['Andre',      other],
                                    ].filter(([, arr]) => arr.length > 0) as [string, Template[]][];
                                    return sections.map(([label, arr]) => (
                                      <div key={label}>
                                        <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 px-3 pt-3 pb-1.5 sticky top-0 bg-white border-b border-gray-100">
                                          {label}
                                        </div>
                                        {arr.map(t => (
                                          <div
                                            key={t.id}
                                            className="group flex items-start gap-2 px-3 py-2.5 hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                                            onClick={() => applyTemplate(t)}
                                          >
                                            <div className="flex-1 min-w-0">
                                              <div className="text-[12.5px] font-semibold text-gray-800 truncate">{t.name}</div>
                                              <div className="text-[11.5px] text-gray-500 line-clamp-2 leading-snug">{t.body.replace(/\{\{[^}]+\}\}/g, s => s.slice(2,-2)).replace(/\s+/g, ' ').slice(0, 120)}…</div>
                                            </div>
                                            {t.created_by === currentUser?.id && (
                                              <button
                                                onClick={e => { e.stopPropagation(); deleteTemplate(t.id); }}
                                                className="opacity-0 group-hover:opacity-100 text-[11px] text-gray-300 hover:text-red-600 px-1 cursor-pointer bg-transparent border-none flex-shrink-0"
                                                aria-label="Slett mal"
                                              >
                                                ✕
                                              </button>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    ));
                                  })()}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      {replyType === 'email' && replyText.trim().length > 20 && (
                        <button
                          onClick={saveAsTemplate}
                          className="text-[11px] text-gray-400 hover:text-[#003087] cursor-pointer bg-transparent border-none underline-offset-2 hover:underline"
                        >
                          Lagre som mal
                        </button>
                      )}
                      <span className="text-[11px] text-gray-300 select-none truncate">
                        {replyType === 'email' ? `Til: ${activeCase.customer_email}` : 'Vises kun for reklamasjonsansvarlig'}
                      </span>
                    </div>
                    <button onClick={sendReply} disabled={!replyText.trim()}
                      className={`px-5 py-1.5 rounded-lg text-white font-semibold text-[13px] cursor-pointer transition-all disabled:opacity-35 disabled:cursor-not-allowed flex-shrink-0
                        ${replyType === 'internal'
                          ? 'bg-amber-500 hover:bg-amber-600 active:scale-95'
                          : 'bg-[#003087] hover:bg-[#001f5c] active:scale-95'}`}>
                      Send →
                    </button>
                  </div>
                </div>
              </div>

              {/* Flytt-sak-modal */}
              {showTransfer && activeCase && (
                <div
                  className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
                  onClick={() => !transferring && setShowTransfer(false)}
                >
                  <div
                    className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5"
                    onClick={e => e.stopPropagation()}
                  >
                    <h2 className="text-base font-bold text-[#003087] mb-1">Flytt sak til annet senter</h2>
                    <p className="text-[12px] text-gray-500 mb-4">
                      Saken flyttes fra <span className="font-semibold text-gray-700">{activeCase.senter || '–'}</span>.
                      Hendelsen logges automatisk på saken.
                    </p>

                    <label className="block text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1">Nytt senter</label>
                    <select
                      value={transferTo}
                      onChange={e => setTransferTo(e.target.value)}
                      disabled={transferring}
                      className="w-full text-[13px] px-3 py-2 border border-gray-300 rounded-lg bg-white outline-none focus:border-[#003087] focus:ring-2 focus:ring-[#003087]/10 mb-4"
                    >
                      <option value="">— Velg senter —</option>
                      {NAF_SENTRE.filter(s => s !== activeCase.senter).map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>

                    <label className="block text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1">
                      Begrunnelse <span className="text-gray-400 font-normal normal-case">(valgfritt)</span>
                    </label>
                    <textarea
                      value={transferReason}
                      onChange={e => setTransferReason(e.target.value)}
                      disabled={transferring}
                      placeholder="F.eks. «Kunden valgte feil senter ved registrering — service utført på Lillestrøm.»"
                      rows={3}
                      className="w-full text-[13px] px-3 py-2 border border-gray-300 rounded-lg bg-white outline-none focus:border-[#003087] focus:ring-2 focus:ring-[#003087]/10 resize-none"
                    />

                    {currentUser?.role === 'senterleder' && (
                      <div className="mt-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                        <p className="text-[12px] text-amber-800">
                          ⚠️ Du mister tilgang til denne saken etter flytting.
                        </p>
                      </div>
                    )}

                    <div className="flex justify-end gap-2 mt-5">
                      <button
                        onClick={() => setShowTransfer(false)}
                        disabled={transferring}
                        className="text-[12.5px] font-semibold text-gray-600 border border-gray-200 rounded-lg px-3.5 py-1.5 hover:bg-gray-50 transition-colors cursor-pointer bg-transparent disabled:opacity-50"
                      >
                        Avbryt
                      </button>
                      <button
                        onClick={transferCase}
                        disabled={transferring || !transferTo}
                        className="text-[12.5px] font-semibold text-white bg-[#003087] rounded-lg px-3.5 py-1.5 hover:bg-[#002060] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {transferring ? 'Flytter…' : 'Flytt sak'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Lightbox */}
              {lightboxUrl && (
                <div
                  className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center"
                  onClick={() => setLightboxUrl(null)}
                >
                  <img
                    src={lightboxUrl}
                    alt="Vedlegg"
                    className="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl object-contain"
                    onClick={e => e.stopPropagation()}
                  />
                  <button
                    onClick={() => setLightboxUrl(null)}
                    className="absolute top-4 right-4 text-white text-2xl font-bold cursor-pointer bg-transparent border-none hover:text-gray-300"
                  >
                    ✕
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
