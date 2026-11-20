'use client'

import { useMemo, useState } from 'react'
import {
  Activity, ArrowDownRight, ArrowUpRight, Bell, BookOpen, Bot, Check,
  ChevronDown, ChevronRight, CircleHelp, Clock3, Command, Database,
  FileCheck2, FileText, Filter, Gauge, Layers3, ListChecks, MoreHorizontal,
  Play, Plus, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles,
  Wallet, X,
} from 'lucide-react'

type LedgerRow = {
  id: string; date: string; account: string; description: string; entity: string;
  debit: string; credit: string; currency: string; ref: string; status: 'Flagged' | 'Matched' | 'Review'
}

const ledgerRows: LedgerRow[] = [
  { id: 'JE-20481', date: 'Nov 18, 2026', account: 'Accounts payable', description: 'Northstar Cloud · INV-8821', entity: 'Northstar Cloud', debit: '—', credit: '12,840.00', currency: 'USD', ref: 'PAY-9927', status: 'Flagged' },
  { id: 'JE-20480', date: 'Nov 18, 2026', account: 'Cloud infrastructure', description: 'Northstar Cloud · INV-8821', entity: 'Northstar Cloud', debit: '12,840.00', credit: '—', currency: 'USD', ref: 'PAY-9927', status: 'Flagged' },
  { id: 'JE-20479', date: 'Nov 17, 2026', account: 'Accounts payable', description: 'Northstar Cloud · INV-8821', entity: 'Northstar Cloud', debit: '—', credit: '12,840.00', currency: 'USD', ref: 'PAY-9918', status: 'Flagged' },
  { id: 'JE-20478', date: 'Nov 17, 2026', account: 'Cloud infrastructure', description: 'Northstar Cloud · INV-8821', entity: 'Northstar Cloud', debit: '12,840.00', credit: '—', currency: 'USD', ref: 'PAY-9918', status: 'Flagged' },
  { id: 'JE-20477', date: 'Nov 17, 2026', account: 'Office & operations', description: 'Monthly workspace · INV-2026-11', entity: 'Forma Works', debit: '4,250.00', credit: '—', currency: 'USD', ref: 'PAY-9916', status: 'Matched' },
  { id: 'JE-20476', date: 'Nov 16, 2026', account: 'Accounts receivable', description: 'Customer payment · INV-7712', entity: 'Meridian Health', debit: '—', credit: '8,600.00', currency: 'USD', ref: 'PAY-9914', status: 'Review' },
  { id: 'JE-20475', date: 'Nov 15, 2026', account: 'Software subscriptions', description: 'Annual license · INV-6092', entity: 'Linear Systems', debit: '2,400.00', credit: '—', currency: 'USD', ref: 'PAY-9908', status: 'Matched' },
]

const activitySeed = [
  { icon: FileCheck2, title: 'Invoice INV-8821 inspected', detail: 'Matched against 2 payment records', time: 'Just now' },
  { icon: Search, title: 'Ledger entries filtered', detail: 'Showing 7 of 1,248 records', time: '2 min ago' },
  { icon: ShieldCheck, title: 'Episode initialized', detail: 'seed: 2026-11-demo-04', time: '5 min ago' },
]

export function AuditWiseDashboard() {
  const [activeNav, setActiveNav] = useState('Overview')
  const [activeTab, setActiveTab] = useState('All records')
  const [selected, setSelected] = useState<LedgerRow>(ledgerRows[0])
  const [steps, setSteps] = useState(3)
  const [running, setRunning] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [query, setQuery] = useState('')
  const [activities, setActivities] = useState(activitySeed)

  const visibleRows = useMemo(() => ledgerRows.filter((row) => {
    const matchesTab = activeTab === 'All records' || (activeTab === 'Flagged' ? row.status === 'Flagged' : row.status === 'Matched')
    const matchesSearch = `${row.id} ${row.account} ${row.description} ${row.ref}`.toLowerCase().includes(query.toLowerCase())
    return matchesTab && matchesSearch
  }), [activeTab, query])

  const inspect = (row: LedgerRow) => {
    setSelected(row)
    setSteps((value) => Math.min(value + 1, 100))
    setActivities((items) => [{ icon: Search, title: `${row.id} inspected`, detail: `${row.account} · ${row.ref}`, time: 'Just now' }, ...items].slice(0, 4))
  }

  const startEpisode = () => {
    setRunning((value) => !value)
    setSubmitted(false)
    setSteps((value) => Math.min(value + 1, 100))
    setActivities((items) => [{ icon: Activity, title: running ? 'Episode paused' : 'Agent run started', detail: running ? 'Trajectory saved · 4 steps' : 'Systematic reconciliation policy', time: 'Just now' }, ...items].slice(0, 4))
  }

  const submitFindings = () => {
    setSubmitted(true)
    setRunning(false)
    setSteps((value) => Math.min(value + 1, 100))
    setActivities((items) => [{ icon: Check, title: 'Findings submitted', detail: '2 findings · evidence attached', time: 'Just now' }, ...items].slice(0, 4))
  }

  return (
    <main className="audit-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" aria-label="AuditWise home"><span className="brand-mark"><ShieldCheck size={19} strokeWidth={2.2} /></span><span>auditwise<span className="brand-period">.</span></span></a>
        <div className="workspace-switch"><span className="workspace-avatar">A</span><span className="workspace-name"><strong>Acme Financial</strong><small>Workspace</small></span><ChevronDown size={15} /></div>
        <div className="nav-section-label">WORKSPACE</div>
        <nav className="nav-list" aria-label="Main navigation">
          <NavItem icon={Layers3} label="Overview" active={activeNav === 'Overview'} onClick={() => setActiveNav('Overview')} />
          <NavItem icon={Activity} label="Audit episodes" active={activeNav === 'Audit episodes'} count="12" onClick={() => setActiveNav('Audit episodes')} />
          <NavItem icon={Database} label="Data & evidence" active={activeNav === 'Data & evidence'} onClick={() => setActiveNav('Data & evidence')} />
          <NavItem icon={ListChecks} label="Trajectories" active={activeNav === 'Trajectories'} onClick={() => setActiveNav('Trajectories')} />
          <NavItem icon={Gauge} label="Benchmarks" active={activeNav === 'Benchmarks'} onClick={() => setActiveNav('Benchmarks')} />
        </nav>
        <div className="nav-section-label nav-label-spaced">DEVELOP</div>
        <nav className="nav-list" aria-label="Development navigation">
          <NavItem icon={Bot} label="Policies" active={activeNav === 'Policies'} onClick={() => setActiveNav('Policies')} />
          <NavItem icon={BookOpen} label="Documentation" active={activeNav === 'Documentation'} onClick={() => setActiveNav('Documentation')} />
        </nav>
        <div className="sidebar-bottom">
          <div className="compute-card"><div className="compute-heading"><span>Monthly compute</span><MoreHorizontal size={16} /></div><div className="compute-value">68.4 <span>/ 100 hrs</span></div><div className="compute-track"><span /></div><div className="compute-foot">Resets Dec 1, 2026</div></div>
          <NavItem icon={Settings2} label="Settings" active={activeNav === 'Settings'} onClick={() => setActiveNav('Settings')} />
          <div className="profile-row"><span className="profile-avatar">SC</span><span className="workspace-name"><strong>Sarah Chen</strong><small>Lead auditor</small></span><MoreHorizontal size={16} /></div>
        </div>
      </aside>

      <section className="main-area" id="overview">
        <header className="topbar"><div className="breadcrumb"><span>Workspace</span><ChevronRight size={14} /><strong>{activeNav}</strong></div><div className="topbar-actions"><button className="search-control" aria-label="Search"><Search size={15} /><span>Search anything...</span><kbd><Command size={11} /> K</kbd></button><button className="icon-button" aria-label="Notifications"><Bell size={17} /><i /></button><span className="top-avatar">SC</span></div></header>
        <div className="page-content">
          <div className="page-heading"><div><div className="eyebrow"><span className="live-dot" /> FINANCIAL AUDIT WORKSPACE</div><h1>{activeNav === 'Overview' ? 'Audit overview' : activeNav}</h1><p>Monitor your audit environment and review agent performance.</p></div><div className="heading-actions"><button className="outline-button" onClick={() => { setSteps(0); setSubmitted(false); setRunning(false) }}><SlidersHorizontal size={15} /> Configure</button><button className="primary-button" onClick={startEpisode}><Play size={14} fill="currentColor" /> {running ? 'Pause agent' : 'Run agent'}</button></div></div>
          <div className="episode-banner"><div className="banner-icon"><Activity size={18} /></div><div className="banner-copy"><div className="banner-title">Active episode <span className="status-pill"><span /> IN PROGRESS</span></div><div className="banner-subtitle">ACME-2026-11-04 <span>·</span> November 2026 close <span>·</span> USD base currency</div></div><div className="banner-meta"><div className="budget"><span>STEP BUDGET</span><strong>{steps}<small> / 100</small></strong></div><div className="budget-line"><span style={{ width: `${Math.min(steps,100)}%` }} /></div></div><button className="banner-more" aria-label="Episode options"><MoreHorizontal size={18} /></button></div>
          <div className="metric-grid">
            <MetricCard label="Records analyzed" value="1,248" change="+12.8%" note="vs. previous episode" icon={Database} positive />
            <MetricCard label="Potential findings" value={submitted ? '2' : '08'} change={submitted ? '2 submitted' : '3 high priority'} note="across 4 categories" icon={ShieldCheck} accent />
            <MetricCard label="Current reward" value={submitted ? '+0.74' : '—'} change={submitted ? 'F1 score 0.92' : 'Awaiting submission'} note="terminal score" icon={Gauge} />
            <MetricCard label="Avg. steps / episode" value="24.6" change="−8.2%" note="more efficient this week" icon={Clock3} positive />
          </div>

          <div className="content-grid">
            <section className="panel ledger-panel"><div className="panel-heading"><div><h2>General ledger</h2><p>Explore records and gather evidence for your findings.</p></div><button className="more-button" aria-label="Ledger options"><MoreHorizontal size={18} /></button></div><div className="ledger-toolbar"><div className="tabs" role="tablist" aria-label="Ledger filters">{['All records', 'Flagged', 'Matched'].map((tab) => <button key={tab} role="tab" aria-selected={activeTab === tab} className={activeTab === tab ? 'tab active' : 'tab'} onClick={() => setActiveTab(tab)}>{tab}{tab === 'Flagged' && <span className="tab-count">4</span>}</button>)}</div><div className="table-actions"><label className="table-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search records" aria-label="Search records" /></label><button className="filter-button" aria-label="Filter records"><Filter size={14} /></button></div></div><div className="table-wrap"><table><thead><tr><th><input type="checkbox" aria-label="Select all records" /></th><th>ENTRY</th><th>ACCOUNT / DESCRIPTION</th><th>DEBIT</th><th>CREDIT</th><th>STATUS</th></tr></thead><tbody>{visibleRows.map((row) => <tr key={row.id} onClick={() => inspect(row)} className={selected.id === row.id ? 'selected-row' : ''}><td><input type="checkbox" aria-label={`Select ${row.id}`} onClick={(event) => event.stopPropagation()} /></td><td><span className="entry-id">{row.id}</span><span className="entry-date">{row.date}</span></td><td><span className="account-name">{row.account}</span><span className="account-description">{row.description}</span></td><td className="amount">{row.debit === '—' ? <span className="muted-dash">—</span> : `$${row.debit}`}</td><td className="amount">{row.credit === '—' ? <span className="muted-dash">—</span> : `$${row.credit}`}</td><td><StatusPill status={row.status} /></td></tr>)}</tbody></table>{visibleRows.length === 0 && <div className="table-empty">No records match your search.</div>}</div><div className="table-footer"><span>Showing <strong>{visibleRows.length}</strong> of 1,248 records</span><button onClick={() => { setActiveTab('All records'); setQuery('') }}>View all records <ChevronRight size={13} /></button></div></section>

            <aside className="right-column"><section className="panel insight-panel"><div className="panel-heading compact"><div className="section-icon"><Sparkles size={15} /></div><div><h2>Selected evidence</h2><p>Record detail & linked documents</p></div><button className="more-button" aria-label="Evidence options"><MoreHorizontal size={17} /></button></div><div className="evidence-id"><span className="evidence-id-icon"><FileText size={16} /></span><div><strong>{selected.id}</strong><small>{selected.date} · {selected.currency}</small></div><StatusPill status={selected.status} /></div><div className="evidence-fields"><div><span>Account</span><strong>{selected.account}</strong></div><div><span>Entity</span><strong>{selected.entity}</strong></div><div><span>Reference</span><button className="inline-link" onClick={() => inspect(selected)}>{selected.ref} <ArrowUpRight size={12} /></button></div><div><span>Debit / Credit</span><strong>{selected.debit} / {selected.credit} {selected.currency}</strong></div></div><div className="linked-docs"><div className="linked-title">LINKED DOCUMENTS <span>2</span></div><button className="document-row"><span className="doc-icon invoice"><FileText size={14} /></span><span><strong>Invoice INV-8821</strong><small>PDF · $12,840.00 USD</small></span><ArrowUpRight size={14} /></button><button className="document-row"><span className="doc-icon payment"><Wallet size={14} /></span><span><strong>Payment PAY-9927</strong><small>Nov 18, 2026 · $12,840.00</small></span><ArrowUpRight size={14} /></button></div></section>

              <section className="panel findings-panel"><div className="panel-heading compact"><div><h2>Agent findings</h2><p>{submitted ? '2 findings submitted' : 'Draft findings · 2 identified'}</p></div><button className="add-finding" aria-label="Add finding"><Plus size={16} /></button></div><FindingItem number="01" title="Duplicate invoice payment" meta="INV-8821 · $12,840.00 USD" severity="High" /><FindingItem number="02" title="Payment allocation mismatch" meta="INV-7704 · $3,200.00 USD" severity="Medium" /><button className={submitted ? 'submit-button submitted' : 'submit-button'} onClick={submitFindings}>{submitted ? <><Check size={15} /> Findings submitted</> : <>Review & submit findings <ArrowUpRight size={14} /></>}</button></section></aside>
          </div>

          <div className="bottom-grid"><section className="panel reward-panel"><div className="panel-heading compact"><div><h2>Reward performance</h2><p>Agent quality across recent episodes</p></div><button className="period-select">Last 7 episodes <ChevronDown size={13} /></button></div><div className="chart-area"><div className="chart-y"><span>1.0</span><span>0.5</span><span>0.0</span><span>−0.5</span></div><div className="chart-main"><div className="chart-gridlines"><i /><i /><i /><i /></div><div className="chart-bars">{[.62,.77,.55,.88,.73,.91,.82].map((height, index) => <div className="bar-group" key={index}><div className="bar" style={{ height: `${height * 100}%` }}><span>{['0.62','0.77','0.55','0.88','0.73','0.91','0.82'][index]}</span></div><small>{['Nov 12','Nov 13','Nov 14','Nov 15','Nov 16','Nov 17','Today'][index]}</small></div>)}</div></div></div><div className="chart-legend"><span><i className="legend-bar" /> Episode reward</span><span><i className="legend-line" /> Baseline 0.65</span><button onClick={() => setActiveNav('Benchmarks')}>View benchmarks <ArrowUpRight size={13} /></button></div></section>
          <section className="panel activity-panel"><div className="panel-heading compact"><div><h2>Recent activity</h2><p>Latest actions in this episode</p></div><button className="more-button" aria-label="Activity options"><MoreHorizontal size={17} /></button></div><div className="activity-list">{activities.map((item, index) => { const Icon = item.icon; return <div className="activity-item" key={`${item.title}-${index}`}><span className="activity-icon"><Icon size={14} /></span><div className="activity-copy"><strong>{item.title}</strong><small>{item.detail}</small></div><time>{item.time}</time></div> })}</div><button className="activity-link" onClick={() => setActiveNav('Trajectories')}>View trajectory log <ArrowUpRight size={13} /></button></section></div>
          <footer className="page-footer"><span><span className="footer-dot" /> Environment operational</span><span>AuditWise Simulator v0.8.2 <span className="footer-sep">·</span> Synthetic data only <button aria-label="About this environment"><CircleHelp size={13} /></button></span></footer>
        </div>
      </section>
    </main>
  )
}

function NavItem({ icon: Icon, label, active, count, onClick }: { icon: typeof Layers3; label: string; active: boolean; count?: string; onClick: () => void }) {
  return <button className={active ? 'nav-item active' : 'nav-item'} onClick={onClick}><Icon size={17} strokeWidth={1.8} /><span>{label}</span>{count && <small>{count}</small>}</button>
}

function MetricCard({ label, value, change, note, icon: Icon, positive, accent }: { label: string; value: string; change: string; note: string; icon: typeof Layers3; positive?: boolean; accent?: boolean }) {
  return <div className="metric-card"><div className="metric-top"><span>{label}</span><span className={accent ? 'metric-icon alert-icon' : 'metric-icon'}><Icon size={16} /></span></div><div className="metric-value">{value}</div><div className="metric-bottom">{positive && (change.startsWith('−') ? <ArrowDownRight size={13} /> : <ArrowUpRight size={13} />)}<strong className={positive ? 'positive' : accent ? 'alert-text' : ''}>{change}</strong><span>{note}</span></div></div>
}

function StatusPill({ status }: { status: LedgerRow['status'] }) {
  return <span className={`row-status ${status.toLowerCase()}`}><i />{status}</span>
}

function FindingItem({ number, title, meta, severity }: { number: string; title: string; meta: string; severity: string }) {
  return <div className="finding-item"><span className="finding-number">{number}</span><span className="finding-copy"><strong>{title}</strong><small>{meta}</small></span><span className={`severity ${severity.toLowerCase()}`}>{severity}</span></div>
}
