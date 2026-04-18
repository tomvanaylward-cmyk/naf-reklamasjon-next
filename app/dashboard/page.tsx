'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, PointElement, LineElement } from 'chart.js';
import { Doughnut } from 'react-chartjs-2';
import { db, getCurrentUser, formatDateTime } from '@/lib/supabase';
import type { Case, Profile } from '@/lib/types';
import Navbar from '@/components/Navbar';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, PointElement, LineElement);

type PeriodDays = 30 | 90 | 365;

function avgDays(cases: Case[]): string {
  const closed = cases.filter(c => c.status === 'closed' && c.updated_at);
  if (!closed.length) return '–';
  const total = closed.reduce((sum, c) => {
    const diff = new Date(c.updated_at!).getTime() - new Date(c.created_at).getTime();
    return sum + diff / 86400000;
  }, 0);
  return (total / closed.length).toFixed(1);
}

function slaCompliance(cases: Case[]): string {
  const closed = cases.filter(c => c.status === 'closed');
  if (!closed.length) return '–';
  const onTime = closed.filter(c => c.sla_deadline && c.updated_at && new Date(c.updated_at) <= new Date(c.sla_deadline));
  return Math.round((onTime.length / closed.length) * 100) + '%';
}

export default function DashboardPage() {
  const router = useRouter();
  const [period, setPeriod] = useState<PeriodDays>(30);
  const [cases, setCases] = useState<Case[]>([]);
  const [agents, setAgents] = useState<Profile[]>([]);
  const [lastUpdated, setLastUpdated] = useState('');
  const [currentUser, setCurrentUser] = useState<Profile | null>(null);

  useEffect(() => {
    (async () => {
      const user = await getCurrentUser();
      if (!user) { router.push('/login'); return; }
      setCurrentUser(user);
    })();
  }, [router]);

  useEffect(() => {
    if (!currentUser) return;
    (async () => {
      const since = new Date(Date.now() - period * 86400000).toISOString();
      const [{ data: caseData }, { data: agentData }] = await Promise.all([
        db.from('cases').select('*').gte('created_at', since).order('created_at', { ascending: false }),
        db.from('profiles').select('id, email, full_name, role').eq('role', 'agent'),
      ]);
      setCases((caseData as Case[]) || []);
      setAgents((agentData as Profile[]) || []);
      setLastUpdated(formatDateTime(new Date().toISOString()));
    })();
  }, [period, currentUser]);

  const openCases = cases.filter(c => c.status !== 'closed');
  const overSLA = openCases.filter(c => c.sla_deadline && new Date(c.sla_deadline) < new Date());
  const totalEstCost = cases.reduce((s, c) => s + (c.cost_estimated || 0), 0);
  const totalActCost = cases.reduce((s, c) => s + (c.cost_actual || 0), 0);

  // Status distribution
  const statusCounts = {
    ny: cases.filter(c => c.status === 'ny').length,
    open: cases.filter(c => c.status === 'open').length,
    waiting: cases.filter(c => c.status === 'waiting').length,
    closed: cases.filter(c => c.status === 'closed').length,
  };
  const statusChart = {
    labels: ['Ny', 'Åpen', 'Venter', 'Lukket'],
    datasets: [{
      data: [statusCounts.ny, statusCounts.open, statusCounts.waiting, statusCounts.closed],
      backgroundColor: ['#6366f1', '#f59e0b', '#0ea5e9', '#10b981'],
      borderWidth: 0,
    }],
  };

  // Categories
  const categoryCounts = cases.reduce<Record<string, number>>((acc, c) => {
    acc[c.category] = (acc[c.category] || 0) + 1;
    return acc;
  }, {});
  const sortedCategories = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]);
  const maxCategoryCount = sortedCategories[0]?.[1] || 1;

  // Cost per category
  const categoryCosts = cases.reduce<Record<string, { est: number; act: number }>>((acc, c) => {
    if (!acc[c.category]) acc[c.category] = { est: 0, act: 0 };
    acc[c.category].est += c.cost_estimated || 0;
    acc[c.category].act += c.cost_actual || 0;
    return acc;
  }, {});

  // Lead time per senter
  const senterDays = cases.reduce<Record<string, number[]>>((acc, c) => {
    if (!c.senter || c.status !== 'closed' || !c.updated_at) return acc;
    if (!acc[c.senter]) acc[c.senter] = [];
    acc[c.senter].push((new Date(c.updated_at).getTime() - new Date(c.created_at).getTime()) / 86400000);
    return acc;
  }, {});
  const senterAvg = Object.entries(senterDays).map(([senter, days]) => ({
    senter,
    avg: days.reduce((a, b) => a + b, 0) / days.length,
  })).sort((a, b) => a.avg - b.avg);

  // Outcome chart
  const outcomeCounts = {
    approved: cases.filter(c => c.outcome === 'approved').length,
    partial: cases.filter(c => c.outcome === 'partial').length,
    rejected: cases.filter(c => c.outcome === 'rejected').length,
    dropped: cases.filter(c => c.outcome === 'dropped').length,
  };
  const outcomeChart = {
    labels: ['Godkjent', 'Delvis', 'Avvist', 'Trukket'],
    datasets: [{
      data: [outcomeCounts.approved, outcomeCounts.partial, outcomeCounts.rejected, outcomeCounts.dropped],
      backgroundColor: ['#10b981', '#f59e0b', '#ef4444', '#6b7280'],
      borderWidth: 0,
    }],
  };

  // Agent table
  const agentStats = agents.map(agent => {
    const agentCases = cases.filter(c => c.assigned_to === agent.id);
    const openCount = agentCases.filter(c => c.status !== 'closed').length;
    const closedCases = agentCases.filter(c => c.status === 'closed');
    const avgLead = closedCases.length
      ? (closedCases.reduce((s, c) => s + (new Date(c.updated_at || c.created_at).getTime() - new Date(c.created_at).getTime()) / 86400000, 0) / closedCases.length).toFixed(1)
      : '–';
    const onTime = closedCases.filter(c => c.sla_deadline && c.updated_at && new Date(c.updated_at) <= new Date(c.sla_deadline)).length;
    const sla = closedCases.length ? Math.round((onTime / closedCases.length) * 100) + '%' : '–';
    const estCost = agentCases.reduce((s, c) => s + (c.cost_estimated || 0), 0);
    const actCost = agentCases.reduce((s, c) => s + (c.cost_actual || 0), 0);
    return { agent, openCount, closedCount: closedCases.length, avgLead, sla, estCost, actCost };
  });

  const chartOptions = {
    plugins: { legend: { position: 'bottom' as const } },
    maintainAspectRatio: true,
  };

  if (!currentUser) {
    return <div className="min-h-screen bg-[#f5f6fa] flex items-center justify-center text-gray-500">Laster...</div>;
  }

  return (
    <div className="min-h-screen bg-[#f5f6fa] flex flex-col">
      <Navbar userName={currentUser.full_name || currentUser.email} role={currentUser.role} />

      <div className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto px-6 py-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
            <div>
              <h1 className="text-2xl font-bold text-[#003087]">Dashboard</h1>
              {lastUpdated && <p className="text-xs text-gray-400 mt-0.5">Oppdatert: {lastUpdated}</p>}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex rounded-lg overflow-hidden border border-gray-200 bg-white">
                {([30, 90, 365] as PeriodDays[]).map(p => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className={`px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer border-none
                      ${period === p ? 'bg-[#003087] text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                  >
                    {p} dager
                  </button>
                ))}
              </div>
              <Link href="/eksport" className="flex items-center gap-1.5 px-4 py-1.5 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 no-underline transition-colors">
                📊 Eksporter
              </Link>
            </div>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {/* Åpne saker */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Åpne saker</p>
              <p className="text-3xl font-bold text-[#003087]">{openCases.length}</p>
              {overSLA.length > 0 && (
                <p className="text-xs text-red-500 mt-1 font-medium">{overSLA.length} over SLA-frist</p>
              )}
              {overSLA.length === 0 && (
                <p className="text-xs text-emerald-500 mt-1 font-medium">Alle innen SLA</p>
              )}
            </div>

            {/* Snitt ledetid */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Snitt ledetid</p>
              <p className="text-3xl font-bold text-[#003087]">{avgDays(cases)} <span className="text-base font-normal text-gray-400">dager</span></p>
              <p className="text-xs text-gray-400 mt-1">For lukkede saker</p>
            </div>

            {/* SLA-overholdelse */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">SLA-overholdelse</p>
              <p className="text-3xl font-bold text-[#003087]">{slaCompliance(cases)}</p>
              <p className="text-xs text-gray-400 mt-1">Lukkede saker</p>
            </div>

            {/* Estimert kostnad */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Estimert kostnad</p>
              <p className="text-3xl font-bold text-[#003087]">{(totalEstCost / 1000).toFixed(1)} <span className="text-base font-normal text-gray-400">k kr</span></p>
              <p className="text-xs text-gray-400 mt-1">Faktisk: {(totalActCost / 1000).toFixed(1)}k kr</p>
            </div>
          </div>

          {/* Charts row 1 */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
            {/* Status fordeling */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Status fordeling</h2>
              <div className="max-w-[220px] mx-auto">
                <Doughnut data={statusChart} options={chartOptions} />
              </div>
            </div>

            {/* Saker per kategori */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Saker per kategori</h2>
              <div className="space-y-2.5">
                {sortedCategories.map(([cat, count]) => (
                  <div key={cat}>
                    <div className="flex justify-between text-xs text-gray-600 mb-1">
                      <span className="truncate pr-2">{cat}</span>
                      <span className="font-semibold">{count}</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#003087] rounded-full transition-all"
                        style={{ width: `${(count / maxCategoryCount) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
                {sortedCategories.length === 0 && <p className="text-xs text-gray-400">Ingen data</p>}
              </div>
            </div>

            {/* Utfall */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Utfall</h2>
              <div className="max-w-[220px] mx-auto">
                <Doughnut data={outcomeChart} options={chartOptions} />
              </div>
            </div>
          </div>

          {/* Charts row 2 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            {/* Kostnad per kategori */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Kostnad per kategori (kr)</h2>
              <div className="space-y-3">
                {Object.entries(categoryCosts).sort((a, b) => b[1].est - a[1].est).map(([cat, { est, act }]) => {
                  const maxVal = Math.max(...Object.values(categoryCosts).map(v => v.est), 1);
                  return (
                    <div key={cat}>
                      <div className="flex justify-between text-xs text-gray-600 mb-1">
                        <span className="truncate pr-2">{cat}</span>
                        <span className="text-gray-400">Est: {est.toLocaleString('nb-NO')} / Akt: {act.toLocaleString('nb-NO')}</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-0.5">
                        <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${(est / maxVal) * 100}%` }} />
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${(act / maxVal) * 100}%` }} />
                      </div>
                    </div>
                  );
                })}
                {Object.keys(categoryCosts).length === 0 && <p className="text-xs text-gray-400">Ingen kostnadsdata</p>}
              </div>
              <div className="flex gap-4 mt-3 text-xs text-gray-500">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-400 inline-block" /> Estimert</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> Faktisk</span>
              </div>
            </div>

            {/* Ledetid per senter */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Ledetid per senter (dager)</h2>
              <div className="space-y-2.5">
                {senterAvg.map(({ senter, avg }) => {
                  const color = avg < 2 ? 'bg-emerald-400' : avg < 4 ? 'bg-amber-400' : 'bg-red-400';
                  const textColor = avg < 2 ? 'text-emerald-600' : avg < 4 ? 'text-amber-600' : 'text-red-600';
                  const maxAvg = Math.max(...senterAvg.map(s => s.avg), 1);
                  return (
                    <div key={senter}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-600 truncate pr-2">{senter}</span>
                        <span className={`font-semibold ${textColor}`}>{avg.toFixed(1)} d</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full ${color} rounded-full`} style={{ width: `${(avg / maxAvg) * 100}%` }} />
                      </div>
                    </div>
                  );
                })}
                {senterAvg.length === 0 && <p className="text-xs text-gray-400">Ingen data for lukkede saker</p>}
              </div>
            </div>
          </div>

          {/* Agent table */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Agentabell</h2>
            {agentStats.length === 0 ? (
              <p className="text-xs text-gray-400">Ingen agenter funnet</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100">
                      <th className="text-left pb-2 pr-4">Saksbehandler</th>
                      <th className="text-right pb-2 px-3">Åpne saker</th>
                      <th className="text-right pb-2 px-3">Lukket (periode)</th>
                      <th className="text-right pb-2 px-3">Snitt ledetid</th>
                      <th className="text-right pb-2 px-3">SLA %</th>
                      <th className="text-right pb-2 px-3">Est. kostnad</th>
                      <th className="text-right pb-2 pl-3">Faktisk kostnad</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {agentStats.map(({ agent, openCount, closedCount, avgLead, sla, estCost, actCost }) => (
                      <tr key={agent.id} className="hover:bg-gray-50">
                        <td className="py-2 pr-4 font-medium text-gray-800">{agent.full_name || agent.email}</td>
                        <td className="py-2 px-3 text-right text-gray-600">{openCount}</td>
                        <td className="py-2 px-3 text-right text-gray-600">{closedCount}</td>
                        <td className="py-2 px-3 text-right text-gray-600">{avgLead}</td>
                        <td className="py-2 px-3 text-right text-gray-600">{sla}</td>
                        <td className="py-2 px-3 text-right text-gray-600">{estCost.toLocaleString('nb-NO')} kr</td>
                        <td className="py-2 pl-3 text-right text-gray-600">{actCost.toLocaleString('nb-NO')} kr</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
