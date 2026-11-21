import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Chart as ChartJS, ArcElement, BarElement, CategoryScale, LinearScale, LineElement, PointElement, Filler, Tooltip, Legend } from 'chart.js';
import { Doughnut, Bar, Line } from 'react-chartjs-2';
import api, { fmtMoney, fmtDateTime, parseError } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { Loading, Badge } from '../components/ui';
import { initials } from '../components/Layout';

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, LineElement, PointElement, Filler, Tooltip, Legend);
ChartJS.defaults.font.family = "'Plus Jakarta Sans', system-ui, sans-serif";
ChartJS.defaults.color = '#64748b';

// Palette shared by all charts
const LEAD_COLORS = { New: '#94a3b8', Contacted: '#6366f1', Qualified: '#0f766e', Unqualified: '#f59e0b', Converted: '#16a34a', Lost: '#e11d48' };
const STAGE_COLORS = { Qualification: '#94a3b8', Proposal: '#6366f1', Negotiation: '#f59e0b', Won: '#0f766e', Lost: '#f97362' };
const grid = { color: '#eef2f1' };
const compact = (v) => (v >= 1e7 ? `${(v / 1e7).toFixed(1)}Cr` : v >= 1e5 ? `${(v / 1e5).toFixed(1)}L` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : v);

const Stat = ({ icon, tone, label, value, sub, to }) => (
  <div className="col-6 col-xl-3">
    <Link to={to} className="text-decoration-none">
      <div className="card h-100"><div className="stat">
        <div className={`stat-icon tone-${tone}`}><i className={`bi bi-${icon}`} /></div>
        <div><div className="stat-value">{value}</div><div className="stat-label">{label}</div>{sub && <div className="small mt-1">{sub}</div>}</div>
      </div></div>
    </Link>
  </div>
);

const Mini = ({ label, value, tone }) => (
  <div className="col-6 col-md-3"><div className="mini-stat d-flex align-items-center gap-2">
    <span className={`rounded-circle tone-${tone}`} style={{ width: 10, height: 10, display: 'inline-block' }} />
    <div><div className="v">{value}</div><div className="l">{label}</div></div>
  </div></div>
);

const RANGES = [['', 'All time'], ['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['custom', 'Custom']];

export default function Dashboard() {
  const { user } = useAuth();
  const [filters, setFilters] = useState({ range: '', from: '', to: '' });
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const setF = (k, v) => setFilters((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
    api.get('/dashboard', { params }).then((r) => setData(r.data.data)).catch((e) => setError(parseError(e).message));
  }, [filters]);

  if (error) return <div className="alert alert-danger">{error}</div>;
  if (!data) return <Loading />;
  const c = data.cards;
  const ch = data.charts;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const scopeText = { all: 'Showing all company records', team: 'Showing you and your team', own: 'Showing your assigned records' }[data.scope];
  const leadTotal = ch.leadStatus.reduce((s, x) => s + x.count, 0);
  const maxOpen = Math.max(1, ...(data.teamPerformance || []).map((t) => t.openAmount + t.wonAmount));

  return (
    <>
      {/* Hero */}
      <div className="hero mb-4">
        <div className="row g-4 align-items-center position-relative" style={{ zIndex: 1 }}>
          <div className="col-lg-5">
            <div className="hero-label">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
            <h1 className="h3 fw-bold text-white mt-1 mb-1">{greet}, {user.name.split(' ')[0]}</h1>
            <div className="opacity-75 small mb-3">{scopeText}</div>
            <div className="d-flex flex-wrap gap-2">
              <select className="form-select form-select-sm w-auto" aria-label="Date range" value={filters.range} onChange={(e) => setF('range', e.target.value)}>
                {RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              {filters.range === 'custom' && <>
                <input type="date" className="form-control form-control-sm w-auto" aria-label="From date" value={filters.from} onChange={(e) => setF('from', e.target.value)} />
                <input type="date" className="form-control form-control-sm w-auto" aria-label="To date" value={filters.to} onChange={(e) => setF('to', e.target.value)} />
              </>}
            </div>
          </div>
          <div className="col-sm-4 col-lg-3 hero-split">
            <div className="hero-label">Total pipeline value</div>
            <div className="hero-kpi">{fmtMoney(c.totalPipelineValue)}</div>
            <div className="small opacity-75">{c.openOpportunities} open opportunities</div>
          </div>
          <div className="col-sm-4 col-lg-2 hero-split">
            <div className="hero-label">Weighted</div>
            <div className="fs-4 fw-bold">{fmtMoney(c.weightedPipelineValue)}</div>
            <div className="small opacity-75">Amount × Probability</div>
          </div>
          <div className="col-sm-4 col-lg-2 hero-split">
            <div className="hero-label">Won value</div>
            <div className="fs-4 fw-bold">{fmtMoney(c.wonValue)}</div>
            <div className="small opacity-75">Win rate {c.winRate}%</div>
          </div>
        </div>
      </div>

      {/* Primary stats */}
      <div className="row g-3 mb-3">
        <Stat icon="people" tone="teal" label="Total Customers" value={c.totalCustomers} to="/customers" />
        <Stat icon="funnel" tone="indigo" label="Total Leads" value={c.totalLeads} sub={<span className="text-muted">{c.openLeads} open leads</span>} to="/leads" />
        <Stat icon="briefcase" tone="amber" label="Total Opportunities" value={c.totalOpportunities} sub={<span className="text-muted">{c.openOpportunities} open</span>} to="/opportunities" />
        <Stat icon="calendar2-check" tone="coral" label="Pending Follow-Ups" value={c.pendingFollowUps} sub={c.overdueFollowUps > 0 ? <span className="text-danger fw-semibold">{c.overdueFollowUps} overdue</span> : <span className="text-muted">none overdue</span>} to="/followups" />
      </div>
      <div className="row g-3 mb-4">
        <Mini label="Open Leads" value={c.openLeads} tone="indigo" />
        <Mini label="Open Opportunities" value={c.openOpportunities} tone="amber" />
        <Mini label="Won Opportunities" value={c.wonOpportunities} tone="green" />
        <Mini label="Lost Opportunities" value={c.lostOpportunities} tone="rose" />
      </div>

      {/* Charts */}
      <div className="row g-3 mb-3">
        <div className="col-lg-8"><div className="card h-100"><div className="card-body">
          <div className="card-title-sm">Monthly Sales <span className="small text-muted fw-normal">Won vs lost value by close month</span></div>
          <div style={{ height: 280 }}>
            <Line data={{ labels: ch.monthlySales.map((m) => new Date(`${m.month}-01`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })), datasets: [
              { label: 'Won', data: ch.monthlySales.map((m) => m.wonAmount), borderColor: '#0f766e', backgroundColor: 'rgba(15,118,110,.12)', fill: true, cubicInterpolationMode: 'monotone', pointRadius: 3 },
              { label: 'Lost', data: ch.monthlySales.map((m) => m.lostAmount), borderColor: '#f97362', backgroundColor: 'rgba(249,115,98,.06)', fill: true, cubicInterpolationMode: 'monotone', pointRadius: 3, borderDash: [5, 4] }
            ] }} options={{ maintainAspectRatio: false, plugins: { legend: { position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 8 } }, tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${fmtMoney(x.raw)}` } } },
              scales: { y: { grid, ticks: { callback: compact } }, x: { grid: { display: false } } } }} />
          </div>
        </div></div></div>
        <div className="col-lg-4"><div className="card h-100"><div className="card-body">
          <div className="card-title-sm">Lead Status <span className="small text-muted fw-normal">{leadTotal} leads</span></div>
          <div style={{ height: 170 }} className="position-relative">
            <Doughnut data={{ labels: ch.leadStatus.map((s) => s.status), datasets: [{ data: ch.leadStatus.map((s) => s.count), backgroundColor: ch.leadStatus.map((s) => LEAD_COLORS[s.status]), borderWidth: 2, borderColor: '#fff' }] }}
              options={{ maintainAspectRatio: false, cutout: '72%', plugins: { legend: { display: false } } }} />
          </div>
          <div className="row g-1 mt-3 small">
            {ch.leadStatus.map((s) => (
              <div key={s.status} className="col-6 d-flex align-items-center gap-2">
                <span className="rounded-circle" style={{ width: 8, height: 8, background: LEAD_COLORS[s.status] }} />
                <span className="text-muted">{s.status}</span><span className="ms-auto fw-semibold me-2">{s.count}</span>
              </div>
            ))}
          </div>
        </div></div></div>
      </div>

      <div className="row g-3 mb-3">
        <div className="col-lg-5"><div className="card h-100"><div className="card-body">
          <div className="card-title-sm">Opportunity Pipeline <Link to="/pipeline" className="small fw-semibold">Open board →</Link></div>
          <div style={{ height: 240 }}>
            <Bar data={{ labels: ch.opportunityPipeline.map((s) => s.stage), datasets: [{ label: 'Amount', data: ch.opportunityPipeline.map((s) => s.amount), backgroundColor: ch.opportunityPipeline.map((s) => STAGE_COLORS[s.stage]), borderRadius: 6, barThickness: 18 }] }}
              options={{ indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (x) => `${fmtMoney(x.raw)} · ${ch.opportunityPipeline[x.dataIndex].count} deals` } } },
                scales: { x: { grid, ticks: { callback: compact } }, y: { grid: { display: false } } } }} />
          </div>
        </div></div></div>
        <div className="col-lg-7"><div className="card h-100"><div className="card-body">
          <div className="card-title-sm">Upcoming Follow-Ups <Link to="/followups" className="small fw-semibold">View all →</Link></div>
          {data.upcomingFollowUps.length === 0 && <p className="text-muted small">Nothing scheduled.</p>}
          {data.upcomingFollowUps.map((f) => {
            const d = new Date(f.followUpDate);
            return (
              <div key={f.id} className="feed-item">
                <div className="feed-date"><b>{d.getDate()}</b><span>{d.toLocaleDateString('en-IN', { month: 'short' })}</span></div>
                <div className="flex-grow-1 min-w-0">
                  <div className="fw-semibold">{f.subject}</div>
                  <div className="small text-muted">{f.relatedType}: {f.relatedName} · {f.assignedTo?.name}</div>
                </div>
                <div className="text-end small"><Badge value={f.followUpType} /><div className="text-muted mt-1">{d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div></div>
              </div>
            );
          })}
        </div></div></div>
      </div>

      <div className="row g-3 mb-3">
        <div className={data.teamPerformance ? 'col-lg-5' : 'col-12'}><div className="card h-100"><div className="card-body">
          <div className="card-title-sm">Recent Activities <Link to="/activities" className="small fw-semibold">View all →</Link></div>
          {data.recentActivities.length === 0 && <p className="text-muted small">No activity yet.</p>}
          {data.recentActivities.map((a) => (
            <div key={a.id} className="feed-item">
              <div className="stat-icon tone-teal" style={{ width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center' }}>
                <i className={`bi bi-${{ Call: 'telephone', Meeting: 'people', Email: 'envelope', Task: 'check2-square' }[a.activityType]}`} />
              </div>
              <div className="flex-grow-1"><div className="fw-semibold">{a.subject}</div><div className="small text-muted">{a.customer?.name || a.lead?.name} · {a.assignedTo?.name}</div></div>
              <div className="small text-muted text-nowrap">{new Date(a.activityDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</div>
            </div>
          ))}
        </div></div></div>

        {data.teamPerformance && (
          <div className="col-lg-7"><div className="card h-100"><div className="card-body">
            <div className="card-title-sm">Team Performance <span className="small text-muted fw-normal">Open + won pipeline per person</span></div>
            {data.teamPerformance.map((t) => (
              <div key={t.userId} className="d-flex align-items-center gap-3 py-2">
                <div className="avatar">{initials(t.name)}</div>
                <div className="flex-grow-1">
                  <div className="d-flex justify-content-between small">
                    <span className="fw-semibold">{t.name} <span className="text-muted fw-normal">· {t.leads} leads · {t.convertedLeads} converted</span></span>
                    <span><span className="text-success fw-semibold">{t.won}W</span> / <span className="text-danger">{t.lost}L</span></span>
                  </div>
                  <div className="bar-track mt-1"><div className="bar-fill" style={{ width: `${((t.openAmount + t.wonAmount) / maxOpen) * 100}%` }} /></div>
                  <div className="d-flex justify-content-between small text-muted mt-1"><span>Open {fmtMoney(t.openAmount)}</span><span>Won {fmtMoney(t.wonAmount)}</span></div>
                </div>
              </div>
            ))}
          </div></div></div>
        )}
      </div>

      {data.security && (
        <div className="card"><div className="card-body">
          <div className="card-title-sm">Security Overview <Link to="/audit" className="small fw-semibold">Audit log →</Link></div>
          <div className="row g-3 mb-3">
            {[['Total users', data.security.totalUsers, 'person', 'teal'], ['Active users', data.security.activeUsers, 'person-check', 'green'], ['Locked accounts', data.security.lockedUsers, 'lock', 'rose'], ['Logins (7 days)', data.security.loginsLast7Days, 'box-arrow-in-right', 'indigo'], ['Failed logins (7 days)', data.security.failedLoginsLast7Days, 'exclamation-octagon', 'coral']].map(([l, v, i, t]) => (
              <div key={l} className="col-6 col-md"><div className="mini-stat d-flex align-items-center gap-2"><div className={`stat-icon tone-${t}`} style={{ width: 34, height: 34, borderRadius: 9, display: 'grid', placeItems: 'center' }}><i className={`bi bi-${i}`} /></div><div><div className="v">{v}</div><div className="l">{l}</div></div></div></div>
            ))}
          </div>
          <div className="table-responsive"><table className="table table-sm mb-0">
            <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Module</th><th>Result</th></tr></thead>
            <tbody>{data.security.recentAudit.map((a) => <tr key={a.id}><td className="text-nowrap">{fmtDateTime(a.createdDate)}</td><td>{a.userName}</td><td>{a.action}</td><td>{a.entityName}</td><td><Badge value={a.result} /></td></tr>)}</tbody>
          </table></div>
        </div></div>
      )}
    </>
  );
}
