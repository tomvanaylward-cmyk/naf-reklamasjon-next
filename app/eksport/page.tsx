'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { db, getCurrentUser, formatDate, formatDateTime, STATUS_LABEL, PRIO_LABEL } from '@/lib/supabase';
import type { Case, Profile, CaseStatus } from '@/lib/types';
import Navbar from '@/components/Navbar';

const CATEGORIES = [
  'Verkstedtjenester', 'Dekkskift', 'Hjulskift', 'Bilpleie', 'Elbil', 'Rådgiving', 'Annet',
];

export default function EksportPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<Profile | null>(null);
  const [statusFilter, setStatusFilter] = useState<'alle' | CaseStatus>('alle');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [periodDays, setPeriodDays] = useState<30 | 90 | 180 | 365>(90);
  const [searchId, setSearchId] = useState('');
  const [searchResult, setSearchResult] = useState<Case | null | 'not-found'>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const user = await getCurrentUser();
      if (!user) { router.push('/login'); return; }
      setCurrentUser(user);
    })();
  }, [router]);

  async function fetchFilteredCases(): Promise<Case[]> {
    const since = new Date(Date.now() - periodDays * 86400000).toISOString();
    let q = db.from('cases').select('*').gte('created_at', since).order('created_at', { ascending: false });
    if (statusFilter !== 'alle') q = q.eq('status', statusFilter);
    if (categoryFilter) q = q.eq('category', categoryFilter);
    const { data } = await q;
    return (data as Case[]) || [];
  }

  async function exportExcel() {
    setLoading(true);
    let url = '';
    try {
      const ExcelJS = (await import('exceljs')).default;
      const cases = await fetchFilteredCases();

      if (cases.length === 0) {
        alert('Ingen saker funnet med gjeldende filter.');
        setLoading(false);
        return;
      }

      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Saker');

      ws.columns = [
        { header: 'Saksnummer',           key: 'case_id',          width: 20 },
        { header: 'Kunde',                key: 'customer_name',    width: 25 },
        { header: 'E-post',               key: 'customer_email',   width: 30 },
        { header: 'Telefon',              key: 'customer_phone',   width: 18 },
        { header: 'Kategori',             key: 'category',         width: 22 },
        { header: 'Senter',               key: 'senter',           width: 22 },
        { header: 'Status',               key: 'status',           width: 14 },
        { header: 'Prioritet',            key: 'priority',         width: 12 },
        { header: 'Opprettet',            key: 'created_at',       width: 20 },
        { header: 'SLA-frist',            key: 'sla_deadline',     width: 20 },
        { header: 'Utfall',               key: 'outcome',          width: 20 },
        { header: 'Est. kostnad (kr)',     key: 'cost_estimated',   width: 18 },
        { header: 'Faktisk kostnad (kr)', key: 'cost_actual',      width: 18 },
        { header: 'Reg.nr',              key: 'reg_nr',            width: 14 },
        { header: 'Ordrenr',             key: 'order_number',      width: 14 },
        { header: 'Beskrivelse',          key: 'description',      width: 40 },
      ];

      // Style header row — NAF blue
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF003087' },
      };

      for (const c of cases) {
        ws.addRow({
          case_id:          c.case_id,
          customer_name:    c.customer_name,
          customer_email:   c.customer_email,
          customer_phone:   c.customer_phone || '',
          category:         c.category,
          senter:           c.senter || '',
          status:           STATUS_LABEL[c.status] || c.status,
          priority:         PRIO_LABEL[c.priority] || c.priority,
          created_at:       formatDate(c.created_at),
          sla_deadline:     formatDate(c.sla_deadline),
          outcome:          c.outcome || '',
          cost_estimated:   c.cost_estimated || '',
          cost_actual:      c.cost_actual || '',
          reg_nr:           c.reg_nr || '',
          order_number:     c.order_number || '',
          description:      c.description || '',
        });
      }

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `naf-reklamasjon-eksport-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
    } catch (err) {
      console.error('Excel export failed:', err);
      alert('Eksport feilet. Prøv igjen.');
    } finally {
      if (url) URL.revokeObjectURL(url);
      setLoading(false);
    }
  }

  async function exportListPDF() {
    setLoading(true);
    try {
      const { jsPDF } = await import('jspdf');
      const autoTable = (await import('jspdf-autotable')).default;
      const cases = await fetchFilteredCases();
      const doc = new jsPDF({ orientation: 'landscape' });
      doc.setFillColor(0, 48, 135);
      doc.rect(0, 0, 297, 18, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(13);
      doc.text('NAF Reklamasjonssystem – Saksliste', 14, 12);
      doc.setFontSize(9);
      doc.text(`Eksportert: ${new Date().toLocaleDateString('nb-NO')}`, 220, 12);
      autoTable(doc, {
        startY: 22,
        head: [['Saksnr', 'Kunde', 'Kategori', 'Senter', 'Status', 'Prioritet', 'Opprettet', 'SLA-frist', 'Utfall']],
        body: cases.map(c => [
          c.case_id, c.customer_name, c.category, c.senter || '–',
          STATUS_LABEL[c.status] || c.status, PRIO_LABEL[c.priority] || c.priority,
          formatDate(c.created_at), formatDate(c.sla_deadline), c.outcome || '–',
        ]),
        headStyles: { fillColor: [0, 48, 135], fontSize: 8 },
        bodyStyles: { fontSize: 8 },
        alternateRowStyles: { fillColor: [245, 246, 250] },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        didDrawPage: (data: any) => {
          doc.setFontSize(8);
          doc.setTextColor(150);
          doc.text(`Side ${data.pageNumber} av ${data.pageCount}`, data.settings.margin.left, doc.internal.pageSize.height - 5);
        },
      });
      doc.save(`naf-saker-${new Date().toISOString().slice(0, 10)}.pdf`);
    } finally {
      setLoading(false);
    }
  }

  async function searchCase() {
    if (!searchId.trim()) return;
    setLoading(true);
    try {
      const { data } = await db.from('cases').select('*').ilike('case_id', `%${searchId.trim()}%`).single();
      setSearchResult((data as Case) || 'not-found');
    } finally {
      setLoading(false);
    }
  }

  async function exportSinglePDF() {
    if (!searchResult || searchResult === 'not-found') return;
    const c = searchResult as Case;
    setLoading(true);
    try {
      const { data: msgs } = await db.from('messages').select('*').eq('case_id', c.id).order('created_at', { ascending: true });
      const { jsPDF } = await import('jspdf');
      const autoTable = (await import('jspdf-autotable')).default;
      const doc = new jsPDF();
      doc.setFillColor(0, 48, 135);
      doc.rect(0, 0, 210, 18, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(13);
      doc.text(`NAF Saksrapport – ${c.case_id}`, 14, 12);
      doc.setTextColor(0, 0, 0);
      let y = 28;
      const addRow = (label: string, value: string) => {
        doc.setFontSize(9); doc.setTextColor(100); doc.text(label, 14, y);
        doc.setTextColor(0); doc.text(value || '–', 70, y); y += 6;
      };
      addRow('Kunde:', c.customer_name);
      addRow('E-post:', c.customer_email);
      addRow('Kategori:', c.category);
      addRow('Status:', STATUS_LABEL[c.status] || c.status);
      addRow('Opprettet:', formatDate(c.created_at));
      addRow('SLA-frist:', formatDate(c.sla_deadline));
      addRow('Utfall:', c.outcome || '–');
      addRow('Reg.nr:', c.reg_nr || '–');
      y += 4;
      if (msgs && msgs.length > 0) {
        autoTable(doc, {
          startY: y,
          head: [['Tidspunkt', 'Avsender', 'Type', 'Innhold']],
          body: (msgs as { created_at: string; sender_name: string; type: string; content: string }[]).map(m => [
            formatDateTime(m.created_at), m.sender_name, m.type, m.content,
          ]),
          headStyles: { fillColor: [0, 48, 135], fontSize: 8 },
          bodyStyles: { fontSize: 8 },
        });
      }
      doc.save(`naf-sak-${c.case_id}.pdf`);
    } finally {
      setLoading(false);
    }
  }

  if (!currentUser) {
    return <div className="min-h-screen bg-[#f5f6fa] flex items-center justify-center text-gray-500">Laster...</div>;
  }

  return (
    <div className="min-h-screen bg-[#f5f6fa] flex flex-col">
      <Navbar userName={currentUser.full_name || currentUser.email} role={currentUser.role} />

      <div className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <h1 className="text-2xl font-bold text-[#003087] mb-6">Eksport</h1>

          {/* Filters */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Filterinnstillinger</h2>
            <div className="flex flex-wrap gap-4">
              {/* Period */}
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1.5">Periode</label>
                <div className="flex rounded-lg overflow-hidden border border-gray-200">
                  {([30, 90, 180, 365] as const).map(p => (
                    <button
                      key={p}
                      onClick={() => setPeriodDays(p)}
                      className={`px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer border-none
                        ${periodDays === p ? 'bg-[#003087] text-white' : 'text-gray-600 hover:bg-gray-50 bg-white'}`}
                    >
                      {p}d
                    </button>
                  ))}
                </div>
              </div>

              {/* Status */}
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1.5">Status</label>
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value as 'alle' | CaseStatus)}
                  className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#003087]/20"
                >
                  <option value="alle">Alle statuser</option>
                  <option value="ny">Ny</option>
                  <option value="open">Åpen</option>
                  <option value="waiting">Venter</option>
                  <option value="closed">Lukket</option>
                </select>
              </div>

              {/* Category */}
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1.5">Kategori</label>
                <select
                  value={categoryFilter}
                  onChange={e => setCategoryFilter(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#003087]/20"
                >
                  <option value="">Alle kategorier</option>
                  {CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Bulk export buttons */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Eksporter alle filtrerte saker</h2>
            <div className="flex gap-3 flex-wrap">
              <button
                onClick={exportExcel}
                disabled={loading}
                className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors cursor-pointer border-none"
              >
                📊 Eksporter til Excel
              </button>
              <button
                onClick={exportListPDF}
                disabled={loading}
                className="flex items-center gap-2 px-5 py-2.5 bg-[#003087] hover:bg-[#002065] disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors cursor-pointer border-none"
              >
                📄 Eksporter PDF-liste
              </button>
            </div>
            {loading && <p className="text-xs text-gray-400 mt-3">Behandler...</p>}
          </div>

          {/* Single case export */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Eksporter enkelt sak</h2>
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                placeholder="Søk saksnummer (f.eks. NAF-2024-001)"
                value={searchId}
                onChange={e => setSearchId(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && searchCase()}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#003087]/20"
              />
              <button
                onClick={searchCase}
                disabled={loading || !searchId.trim()}
                className="px-4 py-2 bg-[#003087] hover:bg-[#002065] disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors cursor-pointer border-none"
              >
                Søk
              </button>
            </div>

            {/* Search result */}
            {searchResult === 'not-found' && (
              <div className="bg-red-50 border border-red-100 rounded-lg p-3 text-sm text-red-600">
                Ingen sak funnet med saksnummer «{searchId}»
              </div>
            )}

            {searchResult && searchResult !== 'not-found' && (
              <div className="border border-gray-100 rounded-lg p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-sm font-semibold text-[#003087]">{(searchResult as Case).case_id}</p>
                    <p className="text-xs text-gray-500">{(searchResult as Case).customer_name} · {(searchResult as Case).customer_email}</p>
                  </div>
                  <button
                    onClick={exportSinglePDF}
                    disabled={loading}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#003087] hover:bg-[#002065] disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors cursor-pointer border-none"
                  >
                    📄 Eksporter PDF
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                  <div className="text-gray-500">Kategori: <span className="text-gray-800">{(searchResult as Case).category}</span></div>
                  <div className="text-gray-500">Status: <span className="text-gray-800">{STATUS_LABEL[(searchResult as Case).status]}</span></div>
                  <div className="text-gray-500">Opprettet: <span className="text-gray-800">{formatDate((searchResult as Case).created_at)}</span></div>
                  <div className="text-gray-500">SLA-frist: <span className="text-gray-800">{formatDate((searchResult as Case).sla_deadline)}</span></div>
                  <div className="text-gray-500">Utfall: <span className="text-gray-800">{(searchResult as Case).outcome || '–'}</span></div>
                  <div className="text-gray-500">Senter: <span className="text-gray-800">{(searchResult as Case).senter || '–'}</span></div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
