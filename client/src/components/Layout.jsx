import { useEffect, useState, useRef } from 'react';
import { NavLink, Outlet, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api, { fmtDateTime } from '../utils/api';

// Grouped navigation; items appear only when the user holds the permission (server still enforces).
const SECTIONS = [
  { title: 'Overview', items: [{ to: '/', label: 'Dashboard', icon: 'grid-1x2', perm: 'dashboard:view', end: true }] },
  {
    title: 'Sales',
    items: [
      { to: '/leads', label: 'Leads', icon: 'funnel', perm: 'leads:read' },
      { to: '/customers', label: 'Customers', icon: 'people', perm: 'customers:read' },
      { to: '/opportunities', label: 'Opportunities', icon: 'briefcase', perm: 'opportunities:read' },
      { to: '/pipeline', label: 'Pipeline', icon: 'kanban', perm: 'opportunities:read' }
    ]
  },
  {
    title: 'Engagement',
    items: [
      { to: '/followups', label: 'Follow-Ups', icon: 'calendar2-check', perm: 'followups:read' },
      { to: '/activities', label: 'Activities', icon: 'lightning-charge', perm: 'activities:read' }
    ]
  },
  { title: 'Insights', items: [{ to: '/reports', label: 'Reports', icon: 'pie-chart', perm: ['reports:view', 'audit:read'] }] },
  {
    title: 'Administration',
    items: [
      { to: '/users', label: 'Users', icon: 'person-badge', perm: ['users:read', 'users:manage'] },
      { to: '/roles', label: 'Roles & Permissions', icon: 'shield-check', perm: ['roles:manage', 'users:read'] },
      { to: '/audit', label: 'Audit Log', icon: 'clock-history', perm: 'audit:read' }
    ]
  }
];

export const initials = (name = '') => name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const nav = useNavigate();
  const box = useRef();
  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return undefined; }
    const t = setTimeout(() => api.get('/search', { params: { q } }).then((r) => setRes(r.data.data)).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setRes(null); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);
  const go = (path) => { setQ(''); setRes(null); nav(path); };
  const groups = res ? [['Customers', res.customers, '/customers', 'people'], ['Leads', res.leads, '/leads', 'funnel'], ['Opportunities', res.opportunities, '/opportunities', 'briefcase']] : [];
  return (
    <div className="search-box" ref={box}>
      <i className="bi bi-search" />
      <input className="form-control" type="search" placeholder="Search customers, leads, deals…" aria-label="Global search" value={q} onChange={(e) => setQ(e.target.value)} />
      {res && (
        <div className="card position-absolute w-100 mt-2 p-2" style={{ zIndex: 1050 }}>
          {groups.every(([, items]) => !items.length) && <div className="small text-muted p-2">No matches</div>}
          {groups.map(([label, items, base, icon]) => items.length > 0 && (
            <div key={label} className="mb-1">
              <div className="side-section mt-1 mb-1">{label}</div>
              {items.map((i) => (
                <button key={i.id} className="side-link w-100 border-0 bg-transparent text-start" onClick={() => go(`${base}/${i.id}`)}>
                  <i className={`bi bi-${icon}`} /><span className="small">{i.title}<br /><span className="text-muted">{i.subtitle}</span></span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Notifications() {
  const { can } = useAuth();
  const [n, setN] = useState(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!can('followups:read')) return undefined;
    const load = () => api.get('/notifications').then((r) => setN(r.data.data)).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [can]);
  if (!n) return null;
  const count = n.overdue + n.dueToday;
  return (
    <div className="position-relative">
      <button className="icon-btn" aria-label={`${count} notifications`} onClick={() => setOpen(!open)}>
        <i className="bi bi-bell" />{count > 0 && <span className="dot">{count}</span>}
      </button>
      {open && (
        <div className="card position-absolute end-0 mt-2 p-0" style={{ width: 340, zIndex: 1050 }}>
          <div className="px-3 py-2 border-bottom d-flex justify-content-between small">
            <strong>Follow-up reminders</strong><span><span className="text-danger fw-bold">{n.overdue}</span> overdue · {n.dueToday} today</span>
          </div>
          {n.items.length === 0 && <div className="px-3 py-3 small text-muted">You're all caught up.</div>}
          {n.items.map((f) => (
            <Link key={f.id} to="/followups" className="d-block px-3 py-2 border-bottom text-decoration-none text-body small" onClick={() => setOpen(false)}>
              <div className="d-flex justify-content-between"><span className="fw-semibold text-truncate">{f.subject}</span>{f.isOverdue && <span className="badge bg-danger-subtle text-danger-emphasis">Overdue</span>}</div>
              <div className="text-muted">{fmtDateTime(f.followUpDate)} · {f.relatedName}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { user, logout, can } = useAuth();
  const nav = useNavigate();
  const [sidebar, setSidebar] = useState(false);
  const allowed = (perm) => (Array.isArray(perm) ? can(...perm) : can(perm));
  const roleLabel = { SalesExecutive: 'Sales Executive' }[user.role] || user.role;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebar ? 'open' : ''}`}>
        <div className="sidebar-inner">
          <div className="brand">
            <div className="brand-mark">A</div>
            <div className="brand-name">AcxiomCRM<small>Sales workspace</small></div>
          </div>
          <nav className="side-nav" aria-label="Main navigation">
            {SECTIONS.map((s) => {
              const items = s.items.filter((m) => allowed(m.perm));
              if (!items.length) return null;
              return (
                <div key={s.title}>
                  <div className="side-section">{s.title}</div>
                  {items.map((m) => (
                    <NavLink key={m.to} to={m.to} end={m.end} onClick={() => setSidebar(false)} className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}>
                      <i className={`bi bi-${m.icon}`} />{m.label}
                    </NavLink>
                  ))}
                </div>
              );
            })}
          </nav>
          <div className="side-user">
            <div className="avatar">{initials(user.name)}</div>
            <div className="who"><strong>{user.name}</strong><span>{roleLabel}</span></div>
            <button className="btn btn-sm btn-light btn-icon" title="Logout" aria-label="Logout" onClick={async () => { await logout(); nav('/login'); }}><i className="bi bi-box-arrow-right" /></button>
          </div>
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <button className="icon-btn d-lg-none" aria-label="Toggle menu" onClick={() => setSidebar(!sidebar)}><i className="bi bi-list" /></button>
          <GlobalSearch />
          <div className="ms-auto d-flex align-items-center gap-2">
            <Notifications />
            <Link to="/change-password" className="icon-btn" title="Change password" aria-label="Change password"><i className="bi bi-key" /></Link>
          </div>
        </header>
        <main className="content"><Outlet /></main>
        <footer className="app-footer"><span>© {new Date().getFullYear()} AcxiomCRM</span><span>{user.username} · {roleLabel}</span></footer>
      </div>
    </div>
  );
}
