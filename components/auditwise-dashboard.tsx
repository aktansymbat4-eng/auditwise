'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Activity, ArrowDownRight, ArrowUpRight, Bell, BookOpen, Bot, Check,
  ChevronDown, ChevronRight, CircleHelp, Clock3, Command, Database,
  FileCheck2, FileText, Filter, Gauge, Layers3, ListChecks, MoreHorizontal,
  Play, Plus, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles,
  Wallet, X,
} from 'lucide-react'
import type { EpisodeConfig, Finding, LedgerRecord } from '@/lib/audit-simulator'
import { ERROR_TYPES, translate, type ErrorType, type Locale } from '@/lib/i18n'

type InvoiceDocument = { doc_id: string; invoice_id: string; entity_id: string; issued_at: string; currency: string; total_minor: number; line_items?: Array<{ description: string; amount_minor: number }> }
type PaymentDocument = { doc_id: string; payment_id: string; timestamp: string; currency: string; amount_minor: number; invoice_refs: Array<{ invoice_id: string; amount_minor: number }> }
type FxRecord = { record_id: string; date: string; source_currency: string; target_currency: string; rate: string }
type EpisodeView = {
  episode_id: string
  manifest: Record<string, unknown>
  ledger: LedgerRecord[]
  invoices: InvoiceDocument[]
  payments: PaymentDocument[]
  fx: FxRecord[]
  policy: Record<string, unknown>
  potential_count?: number
  potential_by_type?: Partial<Record<ErrorType, number>>
  step_count: number
  remaining_steps: number
  terminated: boolean
  truncated: boolean
}
type Benchmark = { benchmark_id: string; episodes: number; clean_episodes: number; interacting_episodes: number; paired_checks: number; paired_checks_passed: number; coverage_by_type: Record<ErrorType, { episodes: number; findings: number }>; adversarial_checks: Record<string, boolean>; policies: Array<{ policy: string; precision: number; recall: number; f1: number; mean_reward: number; mean_steps: number }> }
type RewardMetrics = { precision: number; recall: number; f1: number; reward: number; inspection_steps: number }
type TrajectoryEntry = { episode_id?: string; step?: number; action?: Record<string, unknown> & { type?: string }; observation?: unknown; reward?: number; terminated?: boolean; truncated?: boolean }
type ActivityItem = { icon: typeof Activity; titleKey: string; detail: string; detailKind?: 'seed' | 'record' | 'document' | 'run' | 'submission' | 'finding'; titleValue?: string; timeKey: string }
type ApiResult = { error?: string; episode?: EpisodeView; findings?: Finding[]; submitted?: boolean; observation?: { result?: { submitted?: boolean; findings_count?: number; score?: RewardMetrics }; error?: string }; reward?: number; trajectory?: string }

const entityNames = ['Northstar Cloud', 'Forma Works', 'Meridian Health', 'Linear Systems', 'Atlas Freight', 'Juniper Labs', 'Cedar & Co', 'Monarch Office']
const accountLabels: Record<string, string> = {
  'Accounts payable': 'Accounts payable', 'Accounts receivable': 'Accounts receivable',
  'Cloud and operating expense': 'Cloud and operating expense', Cash: 'Cash',
  'Foreign exchange clearing': 'Foreign exchange clearing',
}
const initialActivities: ActivityItem[] = [{ icon: Activity, titleKey: 'Episode initialized', detail: 'auditwise-demo-seed-v1', detailKind: 'seed', timeKey: 'Just now' }]
const initialConfig: EpisodeConfig = {
  mode: 'train', includeClean: true, pageSize: 50,
  errorTypes: { duplicate_invoice: true, payment_allocation: true, fx_date_rate: true, period_cutoff: true },
  interactions: ['partial_fx', 'fx_period'],
  amountToleranceMinor: 0,
}

function summarizeObservation(value: unknown): string {
  if (!value || typeof value !== 'object') return String(value ?? 'No observation')
  const observation = value as { error?: string; result?: unknown; episode_id?: string; remaining_steps?: number }
  if (observation.error) return `Error: ${observation.error}`
  if (observation.result && typeof observation.result === 'object') {
    const result = observation.result as Record<string, unknown>
    if (Array.isArray(result.records)) {
      const records = result.records as Array<Record<string, unknown>>
      return `${String(result.table)} · ${records.length} records · ${records.slice(0, 3).map((record) => String(record.row_id ?? record.doc_id ?? record.record_id ?? '')).filter(Boolean).join(', ')}`
    }
    if (result.row_id || result.doc_id || result.payment_id || result.invoice_id) {
      return JSON.stringify(Object.fromEntries(Object.entries(result).slice(0, 5)))
    }
    if (result.submitted) {
      const score = result.score as RewardMetrics | undefined
      return score ? `Submitted · precision ${score.precision.toFixed(2)} · F1 ${score.f1.toFixed(2)} · reward ${score.reward.toFixed(3)}` : `Submitted ${String(result.findings_count ?? 0)} findings`
    }
    return JSON.stringify(result).slice(0, 180)
  }
  return `${observation.episode_id ?? 'Episode'} · ${observation.remaining_steps ?? 0} steps remaining`
}

export function AuditWiseDashboard({ initialSession, initialEpisode }: { initialSession: string; initialEpisode: EpisodeView }) {
  const [locale, setLocale] = useState<Locale>('EN')
  const [activeNav, setActiveNav] = useState('Overview')
  const [activeTab, setActiveTab] = useState('All records')
  const [selectedId, setSelectedId] = useState(initialEpisode.ledger[0]?.row_id ?? '')
  const [checkedRows, setCheckedRows] = useState<Set<string>>(new Set())
  const [episode, setEpisode] = useState(initialEpisode)
  const [sessionId, setSessionId] = useState(initialSession)
  const [config, setConfig] = useState<EpisodeConfig>(initialConfig)
  const [seed, setSeed] = useState('auditwise-demo-seed-v1')
  const [running, setRunning] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [query, setQuery] = useState('')
  const [candidateFindings, setCandidateFindings] = useState<Finding[]>([])
  const [score, setScore] = useState<RewardMetrics | undefined>()
  const [rewardHistory, setRewardHistory] = useState<Array<{ episode_id: string; reward: number }>>([])
  const [trajectory, setTrajectory] = useState('')
  const [benchmark, setBenchmark] = useState<Benchmark | null>(null)
  const [activities, setActivities] = useState(initialActivities)
  const [configOpen, setConfigOpen] = useState(false)
  const [findingOpen, setFindingOpen] = useState(false)
  const [findingDraft, setFindingDraft] = useState({ type: 'duplicate_invoice' as ErrorType, affectedIds: '', amountMinor: '', currency: 'USD', evidenceIds: '', explanation: '' })
  const [evidenceJson, setEvidenceJson] = useState('')
  const [notice, setNotice] = useState('')
  const t = (key: string) => translate(locale, key)

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('auditwise.locale')
      if (saved === 'EN' || saved === 'RU' || saved === 'KZ') {
        setLocale(saved)
        document.documentElement.lang = saved === 'RU' ? 'ru' : saved === 'KZ' ? 'kk' : 'en'
      }
    } catch { /* Private browsing may disable local storage; English remains available. */ }
  }, [])

  const selected = episode.ledger.find((row) => row.row_id === selectedId) ?? episode.ledger[0]
  const vendors = useMemo(() => new Map(episode.invoices.map((invoice, index) => [invoice.entity_id, invoice.line_items?.[0]?.description.replace(/ services$/, '') ?? entityNames[index % entityNames.length]])), [episode.invoices])
  const trajectoryEntries = useMemo<TrajectoryEntry[]>(() => trajectory.split('\n').filter(Boolean).map((line) => JSON.parse(line) as TrajectoryEntry), [trajectory])
  const flaggedIds = useMemo(() => new Set(candidateFindings.flatMap((finding) => finding.affected_ids)), [candidateFindings])
  const formatDate = (value: string) => new Intl.DateTimeFormat(locale === 'RU' ? 'ru-RU' : locale === 'KZ' ? 'kk-KZ' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(value))
  const formatMoney = (minor: number, currency: string) => new Intl.NumberFormat(locale === 'RU' ? 'ru-RU' : locale === 'KZ' ? 'kk-KZ' : 'en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)

  const tableRows = useMemo(() => episode.ledger.map((row) => {
    const linked = episode.invoices.find((invoice) => invoice.invoice_id === row.invoice_id)
    const payment = episode.payments.find((item) => item.payment_id === row.payment_id)
    const status = flaggedIds.has(row.row_id) ? 'Flagged' : candidateFindings.length ? 'Matched' : 'Review'
    return {
      ...row,
      date: formatDate(row.timestamp),
      accountLabel: t(accountLabels[row.account] ?? row.account),
      description: row.payment_id ? `${row.payment_id} · ${row.invoice_id ?? ''}` : `${row.invoice_id ?? row.row_id} · ${linked?.currency ?? row.currency}`,
      entity: vendors.get(row.entity_id) ?? row.entity_id,
      debit: row.debit_minor ? formatMoney(row.debit_minor, row.currency) : '—',
      credit: row.credit_minor ? formatMoney(row.credit_minor, row.currency) : '—',
      ref: row.payment_id ?? row.invoice_id ?? row.row_id,
      status: status as 'Flagged' | 'Matched' | 'Review',
      relatedPayment: payment,
    }
  }), [episode, flaggedIds, candidateFindings.length, locale, vendors])

  const visibleRows = useMemo(() => tableRows.filter((row) => {
    const matchesTab = activeTab === 'All records' || (activeTab === 'Flagged' ? row.status === 'Flagged' : row.status === 'Matched')
    const matchesSearch = `${row.row_id} ${row.account} ${row.description} ${row.ref} ${row.entity}`.toLowerCase().includes(query.toLowerCase())
    return matchesTab && matchesSearch
  }), [tableRows, activeTab, query])

  async function post(body: Record<string, unknown>): Promise<ApiResult & { session_id?: string; episode?: EpisodeView; benchmark?: Benchmark }> {
    const response = await fetch('/api/simulator', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const result = await response.json() as ApiResult & { session_id?: string; episode?: EpisodeView; benchmark?: Benchmark }
    if (!response.ok) throw new Error(result.error ?? t('Action failed'))
    return result
  }

  function pushActivity(titleKey: string, detail: string, icon: typeof Activity = Activity, detailKind?: ActivityItem['detailKind'], titleValue?: string) {
    setActivities((items) => [{ icon, titleKey, detail, detailKind, titleValue, timeKey: 'Just now' }, ...items].slice(0, 4))
  }

  async function resetEpisode() {
    try {
      setRunning(true)
      const result = await post({ operation: 'reset', seed, config })
      if (!result.session_id || !result.episode) throw new Error(t('Action failed'))
      setSessionId(result.session_id)
      setEpisode(result.episode)
      setSelectedId(result.episode.ledger[0]?.row_id ?? '')
      setCheckedRows(new Set())
      setCandidateFindings([])
      setSubmitted(false)
      setScore(undefined)
      setTrajectory('')
      setEvidenceJson('')
      setBenchmark(null)
      setNotice(t('Episode reset'))
      setActivities([{ icon: Activity, titleKey: 'Episode initialized', detail: seed, detailKind: 'seed', timeKey: 'Just now' }])
    } catch (error) { setNotice(error instanceof Error ? t(error.message) : t('Action failed')) }
    finally { setRunning(false) }
  }

  async function inspectRecord(row: LedgerRecord) {
    setSelectedId(row.row_id)
    setEvidenceJson('')
    if (episode.terminated || episode.truncated) return
    try {
      const result = await post({ operation: 'step', session_id: sessionId, action: { type: 'get_record', table: 'ledger', id: row.row_id } })
      if (result.episode) setEpisode(result.episode)
      if (result.trajectory) setTrajectory(result.trajectory)
      pushActivity('inspected', `${row.account} · ${row.payment_id ?? row.invoice_id ?? ''}`, Search, 'record', row.row_id)
    } catch (error) { setNotice(error instanceof Error ? t(error.message) : t('Action failed')) }
  }

  async function openDocument(docId: string) {
    if (episode.terminated || episode.truncated) {
      const document = [...episode.invoices, ...episode.payments].find((item) => item.doc_id === docId)
        ?? episode.fx.find((item) => `DOC-${item.record_id}` === docId)
        ?? (docId === 'DOC-POLICY-2026-11' ? { doc_id: docId, ...episode.policy } : undefined)
      setEvidenceJson(JSON.stringify(document ?? { doc_id: docId }, null, 2))
      return
    }
    try {
      const result = await post({ operation: 'step', session_id: sessionId, action: { type: 'get_document', doc_id: docId } })
      if (result.episode) setEpisode(result.episode)
      if (result.trajectory) setTrajectory(result.trajectory)
      setEvidenceJson(JSON.stringify(result.observation?.result ?? result, null, 2))
      pushActivity('Evidence opened', docId, FileCheck2, 'document')
    } catch (error) { setNotice(error instanceof Error ? t(error.message) : t('Action failed')) }
  }

  async function runAgent() {
    if (episode.terminated || episode.truncated || running) return
    try {
      setRunning(true)
      const result = await post({ operation: 'run_policy', session_id: sessionId, policy: 'reconciliation' })
      setCandidateFindings(result.findings ?? [])
      if (result.episode) setEpisode(result.episode)
      setTrajectory(result.trajectory ?? '')
      setSubmitted(false)
      setScore(undefined)
      setNotice('')
      pushActivity('Run complete', `${(result.findings ?? []).length} · ${result.episode?.step_count ?? 0}`, Bot, 'run')
    } catch (error) { setNotice(error instanceof Error ? t(error.message) : t('Action failed')) }
    finally { setRunning(false) }
  }

  async function submitFindings() {
    if (episode.terminated || episode.truncated || running) return
    try {
      setRunning(true)
      const result = await post({ operation: 'step', session_id: sessionId, action: { type: 'submit', findings: { episode_id: episode.episode_id, findings: candidateFindings } } })
      if (result.episode) setEpisode(result.episode)
      const wasSubmitted = Boolean(result.observation?.result?.submitted)
      setSubmitted(wasSubmitted)
      const terminalScore = result.observation?.result?.score
      if (terminalScore) {
        setScore(terminalScore)
        if (wasSubmitted && config.mode !== 'evaluation') setRewardHistory((items) => [...items, { episode_id: episode.episode_id, reward: terminalScore.reward }].slice(-20))
      }
      setTrajectory(result.trajectory ?? trajectory)
      setNotice(result.observation?.error ? t(result.observation.error) : '')
      if (wasSubmitted) pushActivity('Findings submitted', String(candidateFindings.length), Check, 'submission')
    } catch (error) { setNotice(error instanceof Error ? t(error.message) : t('Action failed')) }
    finally { setRunning(false) }
  }

  async function evaluateBenchmarks() {
    try {
      setRunning(true)
      const result = await post({ operation: 'benchmark', seed: `${seed}-benchmark`, episodes: 20 })
      if (result.benchmark) setBenchmark(result.benchmark)
      setActiveNav('Benchmarks')
      setNotice('')
    } catch (error) { setNotice(error instanceof Error ? t(error.message) : t('Action failed')) }
    finally { setRunning(false) }
  }

  function addFinding() {
    const affected_ids = findingDraft.affectedIds.split(/[\\s,]+/).map((id) => id.trim()).filter(Boolean)
    const evidence_ids = findingDraft.evidenceIds.split(/[\\s,]+/).map((id) => id.trim()).filter(Boolean)
    const claimed_amount_minor = Number(findingDraft.amountMinor)
    if (!affected_ids.length || !evidence_ids.length || !Number.isSafeInteger(claimed_amount_minor) || claimed_amount_minor < 0 || !/^[A-Z]{3}$/.test(findingDraft.currency) || !findingDraft.explanation.trim()) {
      setNotice(t('Complete all required finding fields.'))
      return
    }
    setCandidateFindings((items) => [...items, { type: findingDraft.type, affected_ids, evidence_ids, claimed_amount_minor, currency: findingDraft.currency, explanation: findingDraft.explanation.trim() }])
    setFindingOpen(false)
    setNotice('')
    pushActivity('Finding added', `${findingDraft.type} · ${affected_ids.join(', ')}`, Plus, 'finding')
    setFindingDraft({ type: 'duplicate_invoice', affectedIds: '', amountMinor: '', currency: 'USD', evidenceIds: '', explanation: '' })
  }

  async function configureLocale(value: string) {
    if (value !== 'EN' && value !== 'RU' && value !== 'KZ') return
    setLocale(value)
    document.documentElement.lang = value === 'RU' ? 'ru' : value === 'KZ' ? 'kk' : 'en'
    try { window.localStorage.setItem('auditwise.locale', value) } catch { /* Language remains selected for this session. */ }
  }

  const selectedInvoice = selected?.invoice_id ? episode.invoices.find((invoice) => invoice.invoice_id === selected.invoice_id) : undefined
  const selectedPayments = selected?.invoice_id ? episode.payments.filter((payment) => payment.invoice_refs.some((ref) => ref.invoice_id === selected.invoice_id)) : []
  const configType = (type: ErrorType) => Boolean(config.errorTypes?.[type] ?? true)
  const updateErrorType = (type: ErrorType, enabled: boolean) => setConfig((current) => ({ ...current, errorTypes: { ...current.errorTypes, [type]: enabled } }))
  const downloadUrl = `/api/simulator?session_id=${encodeURIComponent(sessionId)}`
  const translatedNav = (label: string) => t(label)

  return (
    <main className="audit-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" aria-label="AuditWise home"><span className="brand-mark"><ShieldCheck size={19} strokeWidth={2.2} /></span><span>auditwise<span className="brand-period">.</span></span></a>
        <div className="workspace-switch"><span className="workspace-avatar">A</span><span className="workspace-name"><strong>Acme Financial</strong><small>{t('Workspace')}</small></span><ChevronDown size={15} /></div>
        <div className="nav-section-label">{t('WORKSPACE')}</div>
        <nav className="nav-list" aria-label={t('Main navigation')}>
          <NavItem icon={Layers3} label={t('Overview')} active={activeNav === 'Overview'} onClick={() => setActiveNav('Overview')} />
          <NavItem icon={Activity} label={t('Audit episodes')} active={activeNav === 'Audit episodes'} count="1" onClick={() => setActiveNav('Audit episodes')} />
          <NavItem icon={Database} label={t('Data & evidence')} active={activeNav === 'Data & evidence'} onClick={() => setActiveNav('Data & evidence')} />
          <NavItem icon={ListChecks} label={t('Trajectories')} active={activeNav === 'Trajectories'} onClick={() => setActiveNav('Trajectories')} />
          <NavItem icon={Gauge} label={t('Benchmarks')} active={activeNav === 'Benchmarks'} onClick={() => setActiveNav('Benchmarks')} />
        </nav>
        <div className="nav-section-label nav-label-spaced">{t('DEVELOP')}</div>
        <nav className="nav-list" aria-label={t('Development navigation')}>
          <NavItem icon={Bot} label={t('Policies')} active={activeNav === 'Policies'} onClick={() => setActiveNav('Policies')} />
          <NavItem icon={BookOpen} label={t('Documentation')} active={activeNav === 'Documentation'} onClick={() => setActiveNav('Documentation')} />
        </nav>
        <div className="sidebar-bottom">
          <div className="compute-card"><div className="compute-heading"><span>{t('Monthly compute')}</span><MoreHorizontal size={16} /></div><div className="compute-value">{episode.step_count}<span> / 100 {t('steps')}</span></div><div className="compute-track"><span style={{ width: `${Math.min(episode.step_count, 100)}%` }} /></div><div className="compute-foot">{t('Deterministic local simulator')}</div></div>
          <NavItem icon={Settings2} label={t('Settings')} active={activeNav === 'Settings'} onClick={() => setActiveNav('Settings')} />
          <div className="profile-row"><span className="profile-avatar">SC</span><span className="workspace-name"><strong>Sarah Chen</strong><small>{t('Lead auditor')}</small></span><MoreHorizontal size={16} /></div>
        </div>
      </aside>

      <section className="main-area" id="overview">
        <header className="topbar"><div className="breadcrumb"><span>{t('Workspace')}</span><ChevronRight size={14} /><strong>{translatedNav(activeNav)}</strong></div><div className="topbar-actions"><button className="search-control" aria-label={t('Search')} onClick={() => { setActiveNav('Data & evidence'); document.getElementById('record-search')?.focus() }}><Search size={15} /><span>{t('Search anything...')}</span><kbd><Command size={11} /> K</kbd></button><button className="icon-button" aria-label={t('Notifications')} onClick={() => setActiveNav('Trajectories')}><Bell size={17} />{activities.length > 1 && <i />}</button><label className="locale-control"><span className="sr-only">{t('Language')}</span><select value={locale} onChange={(event) => void configureLocale(event.target.value)} aria-label={t('Language')}><option value="EN">EN</option><option value="RU">RU</option><option value="KZ">KZ</option></select></label><span className="top-avatar">SC</span></div></header>
        <div className="page-content">
          <div className="page-heading"><div><div className="eyebrow"><span className="live-dot" /> {t('FINANCIAL AUDIT WORKSPACE')}</div><h1>{activeNav === 'Overview' ? t('Audit overview') : translatedNav(activeNav)}</h1><p>{t('Monitor your audit environment and review agent performance.')}</p></div><div className="heading-actions"><button className="outline-button" onClick={() => setConfigOpen(true)}><SlidersHorizontal size={15} /> {t('Configure')}</button><button className="primary-button" onClick={runAgent} disabled={running || episode.terminated || episode.truncated}><Play size={14} fill="currentColor" /> {running ? t('Running...') : t('Run agent')}</button></div></div>
          {notice && <div className="notice" role="status" aria-live="polite"><span>{notice}</span><button onClick={() => setNotice('')} aria-label={t('Dismiss')}><X size={14} /></button></div>}
          <div className="episode-banner"><div className="banner-icon"><Activity size={18} /></div><div className="banner-copy"><div className="banner-title">{t('Active episode')} <span className="status-pill"><span /> {episode.terminated || episode.truncated ? t('COMPLETED') : t('IN PROGRESS')}</span></div><div className="banner-subtitle">{episode.episode_id} <span>·</span> {String(episode.manifest.company_name ?? 'Acme Financial')} <span>·</span> {t('November 2026 close')} <span>·</span> {t('USD base currency')}</div></div><div className="banner-meta"><div className="budget"><span>{t('STEP BUDGET')}</span><strong>{episode.step_count}<small> / 100</small></strong></div><div className="budget-line"><span style={{ width: `${Math.min(episode.step_count, 100)}%` }} /></div></div><button className="banner-more" onClick={() => setConfigOpen(true)} aria-label={t('Episode options')}><MoreHorizontal size={18} /></button></div>
          <div className="metric-grid">
            <MetricCard label={t('Ledger records')} value={String(episode.ledger.length)} change={episode.step_count ? `${episode.step_count} ${t('steps')}` : t('Not started')} note={t('Synthetic ledger records')} icon={Database} />
            <MetricCard label={t('Potential findings')} value={config.mode === 'evaluation' ? '—' : String(episode.potential_count ?? 0)} change={config.mode === 'evaluation' ? t('Evaluator-only mode') : `${episode.potential_count ?? 0} ${t('review signals')}`} note={t('Unverified patterns in source data')} icon={ShieldCheck} accent />
            <MetricCard label={t('Current reward')} value={score ? score.reward.toFixed(3) : '—'} change={score ? `${t('F1 score')} ${score.f1.toFixed(2)}` : config.mode === 'evaluation' ? t(submitted ? 'Evaluation reward withheld' : 'Evaluator-only mode') : t('Awaiting submission')} note={t('terminal score')} icon={Gauge} />
            <MetricCard label={t('Inspection steps')} value={String(episode.step_count)} change={`${episode.remaining_steps} ${t('remaining')}`} note={t('Step budget: 100')} icon={Clock3} positive={episode.remaining_steps > 0} />
          </div>

          <div className="content-grid">
            <section className="panel ledger-panel"><div className="panel-heading"><div><h2>{t('General ledger')}</h2><p>{t('Explore records and gather evidence for your findings.')}</p></div><button className="more-button" aria-label={t('Ledger options')} onClick={() => setActiveNav('Data & evidence')}><MoreHorizontal size={18} /></button></div><div className="ledger-toolbar"><div className="tabs" role="tablist" aria-label={t('Ledger filters')}>{['All records', 'Flagged', 'Matched'].map((tab) => <button key={tab} role="tab" aria-selected={activeTab === tab} className={activeTab === tab ? 'tab active' : 'tab'} onClick={() => setActiveTab(tab)}>{t(tab)}{tab === 'Flagged' && <> <span className="tab-count">{flaggedIds.size}</span></>}</button>)}</div><div className="table-actions"><label className="table-search"><Search size={14} /><input id="record-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Search records')} aria-label={t('Search records')} /></label><button className="filter-button" aria-label={t('Filter records')} onClick={() => setActiveTab('Flagged')}><Filter size={14} /></button></div></div><div className="table-wrap"><table><thead><tr><th><input type="checkbox" aria-label={t('Select all records')} checked={visibleRows.length > 0 && visibleRows.every((row) => checkedRows.has(row.row_id))} onChange={(event) => setCheckedRows((current) => { const next = new Set(current); for (const row of visibleRows) event.target.checked ? next.add(row.row_id) : next.delete(row.row_id); return next })} /></th><th>{t('ENTRY')}</th><th>{t('ACCOUNT / DESCRIPTION')}</th><th>{t('DEBIT')}</th><th>{t('CREDIT')}</th><th>{t('STATUS')}</th></tr></thead><tbody>{visibleRows.map((row) => <tr key={row.row_id} onClick={() => void inspectRecord(row)} className={selected?.row_id === row.row_id ? 'selected-row' : ''}><td><input type="checkbox" aria-label={`${t('Select')} ${row.row_id}`} checked={checkedRows.has(row.row_id)} onClick={(event) => event.stopPropagation()} onChange={(event) => setCheckedRows((current) => { const next = new Set(current); event.target.checked ? next.add(row.row_id) : next.delete(row.row_id); return next })} /></td><td><span className="entry-id">{row.row_id}</span><span className="entry-date">{row.date}</span></td><td><span className="account-name">{row.accountLabel}</span><span className="account-description">{row.description}</span></td><td className="amount">{row.debit === '—' ? <span className="muted-dash">—</span> : row.debit}</td><td className="amount">{row.credit === '—' ? <span className="muted-dash">—</span> : row.credit}</td><td><StatusPill status={row.status} t={t} /></td></tr>)}</tbody></table>{visibleRows.length === 0 && <div className="table-empty">{t('No records match your search.')}</div>}</div><div className="table-footer"><span>{t('Showing')} <strong>{visibleRows.length}</strong> {t('of')} <strong>{episode.ledger.length}</strong> {t('records')}</span><button onClick={() => setActiveTab('All records')}>{t('View all records')} <ArrowUpRight size={12} /></button></div></section>

            <aside className="right-column"><section className="panel insight-panel"><div className="panel-heading compact"><div className="section-icon"><Sparkles size={15} /></div><div><h2>{t('Selected evidence')}</h2><p>{t('Record detail & linked documents')}</p></div><button className="more-button" aria-label={t('Evidence options')} onClick={() => selected && void openDocument(selected.invoice_id ? `DOC-${selected.invoice_id}` : 'DOC-POLICY-2026-11')}><MoreHorizontal size={17} /></button></div>{selected ? <><div className="evidence-id"><span className="evidence-id-icon"><FileText size={16} /></span><div><strong>{selected.row_id}</strong><small>{formatDate(selected.timestamp)} · {selected.currency}</small></div><StatusPill status={flaggedIds.has(selected.row_id) ? 'Flagged' : candidateFindings.length ? 'Matched' : 'Review'} t={t} /></div><div className="evidence-fields"><div><span>{t('Account')}</span><strong>{t(accountLabels[selected.account] ?? selected.account)}</strong></div><div><span>{t('Entity')}</span><strong>{vendors.get(selected.entity_id) ?? selected.entity_id}</strong></div><div><span>{t('Reference')}</span><button className="inline-link" onClick={() => void openDocument(selected.payment_id ? `DOC-${selected.payment_id}` : `DOC-${selected.invoice_id}`)}>{selected.payment_id ?? selected.invoice_id ?? selected.row_id} <ArrowUpRight size={12} /></button></div><div><span>{t('Debit / Credit')}</span><strong>{selected.debit_minor ? formatMoney(selected.debit_minor, selected.currency) : '—'} / {selected.credit_minor ? formatMoney(selected.credit_minor, selected.currency) : '—'}</strong></div></div><div className="linked-docs"><div className="linked-title">{t('LINKED DOCUMENTS')} <span>{(selectedInvoice ? 1 : 0) + selectedPayments.length}</span></div>{selectedInvoice && <button className="document-row" onClick={() => void openDocument(selectedInvoice.doc_id)}><span className="doc-icon invoice"><FileText size={14} /></span><span><strong>{t('Invoice')} {selectedInvoice.invoice_id}</strong><small>{formatMoney(selectedInvoice.total_minor, selectedInvoice.currency)} · {selectedInvoice.currency}</small></span><ArrowUpRight size={14} /></button>}{selectedPayments.map((payment) => <button className="document-row" key={payment.doc_id} onClick={() => void openDocument(payment.doc_id)}><span className="doc-icon payment"><Wallet size={14} /></span><span><strong>{t('Payment')} {payment.payment_id}</strong><small>{formatDate(payment.timestamp)} · {formatMoney(payment.amount_minor, payment.currency)}</small></span><ArrowUpRight size={14} /></button>)}{evidenceJson && <pre className="evidence-json">{evidenceJson}</pre>}</div></> : <div className="table-empty">{t('No records match your search.')}</div>}</section>

              <section className="panel findings-panel"><div className="panel-heading compact"><div><h2>{t('Agent findings')}</h2><p>{submitted ? `${candidateFindings.length} ${t('findings submitted')}` : candidateFindings.length ? `${t('Draft findings')} · ${candidateFindings.length} ${t('identified')}` : t('Run the agent to collect evidence-backed findings.')}</p></div><button className="add-finding" aria-label={t('Add finding')} onClick={() => setFindingOpen(true)} disabled={running || episode.terminated || episode.truncated}><Plus size={16} /></button></div><p className="finding-explainer">{t('Potential findings include unverified patterns and legitimate split-payment distractors; drafts are agent claims awaiting evidence-based scoring.')}</p>{config.mode === 'evaluation' ? <p className="config-note">{t('Evaluation details stay with the evaluator.')}</p> : <div className="signal-grid" aria-label={t('Potential findings by type')}>{ERROR_TYPES.map((type) => <div className="signal-item" key={type}><strong>{t(type)}</strong><span>{episode.potential_by_type?.[type] ?? 0} {t((episode.potential_by_type?.[type] ?? 0) === 1 ? 'signal' : 'signals')}</span></div>)}</div>}{candidateFindings.length ? candidateFindings.map((finding, index) => <FindingItem key={`${finding.type}-${index}`} number={String(index + 1).padStart(2, '0')} title={t(finding.type)} meta={`${finding.affected_ids.join(', ')} · ${formatMoney(finding.claimed_amount_minor, finding.currency)}`} severity={finding.type === 'duplicate_invoice' ? 'High' : 'Medium'} t={t} />) : <div className="findings-empty">{t('No findings yet')}</div>}<button className={submitted ? 'submit-button submitted' : 'submit-button'} onClick={submitFindings} disabled={running || episode.terminated || episode.truncated}>{submitted ? <><Check size={15} /> {t('Findings submitted')}</> : <>{t('Review & submit findings')} <ArrowUpRight size={14} /></>}</button></section></aside>
          </div>

          <div className="bottom-grid"><section className="panel reward-panel"><div className="panel-heading compact"><div><h2>{t('Reward performance')}</h2><p>{t('Actual submitted training rewards across episodes')}</p></div><button className="period-select" onClick={evaluateBenchmarks} disabled={running}>{benchmark ? `${benchmark.episodes} ${t('episodes')}` : t('Evaluate 20 episodes')} <ChevronDown size={13} /></button></div>{rewardHistory.length ? <div className="reward-history-chart" role="img" aria-label={`${t('Episode reward history')}: ${rewardHistory.slice(-7).map((item) => item.reward.toFixed(3)).join(', ')}`}><div className="reward-axis"><span>+1</span><span>0</span><span>−1</span></div><div className="reward-history-bars"><div className="reward-zero-line" />{rewardHistory.slice(-7).map((item, index) => <div className="reward-bar-group" key={`${item.episode_id}-${index}`}><span className="reward-bar-value">{item.reward.toFixed(2)}</span><span className={`reward-bar ${item.reward < 0 ? 'negative' : 'positive'}`} style={{ height: `${Math.max(3, Math.abs(item.reward) * 42)}%` }} /><small>{item.episode_id.slice(-4)}</small></div>)}</div></div> : <div className="chart-empty">{t('Submit a training episode to build reward history from measured results.')}</div>}{benchmark ? <p className="config-note">{benchmark.clean_episodes} {t('clean episodes')} · {benchmark.interacting_episodes} {t('interacting episodes')} · {t('Paired checks')}: {benchmark.paired_checks_passed}/{benchmark.paired_checks} · {t('Scoring checks')}: {Object.values(benchmark.adversarial_checks).filter(Boolean).length}/{Object.keys(benchmark.adversarial_checks).length}<br />{t('Error-type coverage')}: {ERROR_TYPES.map((type) => `${t(type)} ${benchmark.coverage_by_type[type].episodes}/${benchmark.episodes}`).join(' · ')}</p> : null}{benchmark ? <div className="benchmark-table"><div className="benchmark-header"><span>{t('Policy')}</span><span>{t('Precision')}</span><span>{t('Recall')}</span><span>{t('F1 score')}</span><span>{t('Mean reward')}</span></div>{benchmark.policies.map((item) => <div className="benchmark-row" key={item.policy}><strong>{t(item.policy)}</strong><span>{item.precision.toFixed(2)}</span><span>{item.recall.toFixed(2)}</span><span>{item.f1.toFixed(2)}</span><span>{item.mean_reward.toFixed(2)}</span></div>)}</div> : null}<div className="chart-legend"><span><i className="legend-bar" /> {t('Episode reward')}</span><span>{rewardHistory.length} {t('submitted episodes')}</span><button onClick={evaluateBenchmarks} disabled={running}>{t('Benchmark policies')} <ArrowUpRight size={13} /></button></div></section>
          <section className="panel activity-panel"><div className="panel-heading compact"><div><h2>{activeNav === 'Trajectories' ? t('Trajectories') : t('Recent activity')}</h2><p>{t('Latest actions in this episode')}</p></div><button className="more-button" aria-label={t('Activity options')} onClick={() => setActiveNav('Trajectories')}><MoreHorizontal size={17} /></button></div>{activeNav === 'Trajectories' ? <div className="trajectory-view">{trajectory ? <><a className="download-link" href={downloadUrl} download="trajectories.jsonl">{t('Download JSONL')} <ArrowDownRight size={13} /></a><div className="trajectory-events">{trajectoryEntries.map((entry, index) => <article className="trajectory-event" key={`${entry.step ?? index}-${index}`}><div className="trajectory-event-heading"><strong>#{entry.step ?? index + 1} · {String(entry.action?.type ?? t('Action'))}</strong><span>{t('Reward')} {Number(entry.reward ?? 0).toFixed(3)}</span></div><code>{JSON.stringify(entry.action)}</code><span className="trajectory-observation">{t('Observation')}: {summarizeObservation(entry.observation)}</span><details><summary>{t('Full observation')}</summary><pre>{JSON.stringify(entry.observation, null, 2)}</pre></details></article>)}</div></> : <div className="findings-empty">{t('No trajectory entries yet.')}</div>}</div> : <div className="activity-list">{activities.map((item, index) => { const Icon = item.icon; const detailParts = item.detail.split(' · '); const title = item.titleValue ? `${item.titleValue} ${t(item.titleKey)}` : t(item.titleKey); const detail = item.detailKind === 'seed' ? `${t('Seed')}: ${item.detail}` : item.detailKind === 'record' ? `${t(detailParts[0])} · ${detailParts.slice(1).join(' · ')}` : item.detailKind === 'document' ? `${t('Document ID')}: ${item.detail}` : item.detailKind === 'run' ? `${detailParts[0]} ${t('potential findings')} · ${detailParts[1]} ${t('steps')}` : item.detailKind === 'submission' ? `${item.detail} ${t('findings')} · ${t('evidence attached')}` : item.detailKind === 'finding' ? `${t(detailParts[0])} · ${detailParts.slice(1).join(' · ')}` : t(item.detail); return <div className="activity-item" key={`${item.titleKey}-${index}`}><span className="activity-icon"><Icon size={14} /></span><div className="activity-copy"><strong>{title}</strong><small>{detail}</small></div><time>{t(item.timeKey)}</time></div> })}</div>}<button className="activity-link" onClick={() => setActiveNav(activeNav === 'Trajectories' ? 'Overview' : 'Trajectories')}>{activeNav === 'Trajectories' ? t('Recent activity') : t('View trajectory log')} <ArrowUpRight size={13} /></button></section></div>
          <footer className="page-footer"><span><span className="footer-dot" /> {t('Environment operational')}</span><span>AuditWise Simulator v0.9.0 <span className="footer-sep">·</span> {t('Synthetic data only')} <button aria-label={t('About this environment')} onClick={() => setNotice(t('Simulator is running locally with deterministic synthetic data.'))}><CircleHelp size={13} /></button></span></footer>
        </div>
      </section>

      {configOpen && <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfigOpen(false) }}><section className="config-dialog" role="dialog" aria-modal="true" aria-labelledby="config-title"><div className="config-heading"><div><h2 id="config-title">{t('Episode configuration')}</h2><p>{t('Configure an independently seeded, reproducible financial audit episode.')}</p></div><button className="more-button" onClick={() => setConfigOpen(false)} aria-label={t('Close')}><X size={17} /></button></div><label className="config-label">{t('Seed')}<input value={seed} onChange={(event) => setSeed(event.target.value)} maxLength={120} aria-label={t('Enter seed')} /></label><fieldset className="config-fieldset"><legend>{t('Financial error types')}</legend>{ERROR_TYPES.map((type) => <label className="config-check" key={type}><input type="checkbox" checked={configType(type)} onChange={(event) => updateErrorType(type, event.target.checked)} /><span>{t(type)}</span></label>)}</fieldset><fieldset className="config-fieldset"><legend>{t('Interaction scenarios')}</legend>{(['partial_fx', 'fx_period'] as const).map((scenario) => <label className="config-check" key={scenario}><input type="checkbox" checked={Boolean(config.interactions?.includes(scenario))} onChange={(event) => setConfig((current) => ({ ...current, interactions: event.target.checked ? [...(current.interactions ?? []), scenario] : (current.interactions ?? []).filter((item) => item !== scenario) }))} /><span>{t(scenario === 'partial_fx' ? 'Partial payment + FX' : 'FX + period boundary')}</span></label>)}</fieldset><label className="config-check"><input type="checkbox" checked={config.includeClean !== false} onChange={(event) => setConfig((current) => ({ ...current, includeClean: event.target.checked }))} /><span>{t('Include clean distractors')}</span></label><label className="config-label">{t('Amount tolerance (minor units)')}<input type="number" min="0" max="1000000" step="1" value={config.amountToleranceMinor ?? 0} onChange={(event) => setConfig((current) => ({ ...current, amountToleranceMinor: Number(event.target.value) }))} /></label><label className="config-label">{t('Episode mode')}<select value={config.mode ?? 'train'} onChange={(event) => setConfig((current) => ({ ...current, mode: event.target.value as 'train' | 'evaluation' }))}><option value="train">{t('Training mode')}</option><option value="evaluation">{t('Evaluation mode')}</option></select></label><p className="config-note">{t('The reward is returned only after submission in training mode. Evaluation details stay with the evaluator.')}</p><div className="dialog-actions"><button className="outline-button" onClick={() => setConfigOpen(false)}>{t('Cancel')}</button><button className="primary-button" onClick={() => { setConfigOpen(false); void resetEpisode() }} disabled={running}>{t('Save & reset')}</button></div></section></div>}
      {findingOpen && <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setFindingOpen(false) }}><section className="config-dialog finding-dialog" role="dialog" aria-modal="true" aria-labelledby="finding-title"><div className="config-heading"><div><h2 id="finding-title">{t('Add finding')}</h2><p>{t('Submit only findings supported by records and evidence.')}</p></div><button className="more-button" onClick={() => setFindingOpen(false)} aria-label={t('Close')}><X size={17} /></button></div><label className="config-label">{t('Finding type')}<select value={findingDraft.type} onChange={(event) => setFindingDraft((draft) => ({ ...draft, type: event.target.value as ErrorType }))}>{ERROR_TYPES.map((type) => <option key={type} value={type}>{t(type)}</option>)}</select></label><label className="config-label">{t('Affected records')}<input value={findingDraft.affectedIds} onChange={(event) => setFindingDraft((draft) => ({ ...draft, affectedIds: event.target.value }))} placeholder={t('Comma-separated record IDs')} /></label><div className="finding-form-row"><label className="config-label">{t('Amount (minor units)')}<input type="number" min="0" step="1" value={findingDraft.amountMinor} onChange={(event) => setFindingDraft((draft) => ({ ...draft, amountMinor: event.target.value }))} /></label><label className="config-label">{t('Currency')}<select value={findingDraft.currency} onChange={(event) => setFindingDraft((draft) => ({ ...draft, currency: event.target.value }))}><option>USD</option><option>EUR</option><option>KZT</option></select></label></div><label className="config-label">{t('Evidence IDs')}<input value={findingDraft.evidenceIds} onChange={(event) => setFindingDraft((draft) => ({ ...draft, evidenceIds: event.target.value }))} placeholder={t('Comma-separated evidence IDs')} /></label><label className="config-label">{t('Explanation')}<textarea rows={3} value={findingDraft.explanation} onChange={(event) => setFindingDraft((draft) => ({ ...draft, explanation: event.target.value }))} /></label><div className="dialog-actions"><button className="outline-button" onClick={() => setFindingOpen(false)}>{t('Cancel')}</button><button className="primary-button" onClick={addFinding}>{t('Add finding')}</button></div></section></div>}
    </main>
  )
}

function NavItem({ icon: Icon, label, active, count, onClick }: { icon: typeof Layers3; label: string; active: boolean; count?: string; onClick: () => void }) {
  return <button className={active ? 'nav-item active' : 'nav-item'} onClick={onClick} aria-label={label} title={label}><Icon size={17} strokeWidth={1.8} /><span>{label}</span>{count && <small>{count}</small>}</button>
}

function MetricCard({ label, value, change, note, icon: Icon, positive, accent }: { label: string; value: string; change: string; note: string; icon: typeof Layers3; positive?: boolean; accent?: boolean }) {
  return <div className="metric-card"><div className="metric-top"><span>{label}</span><span className={accent ? 'metric-icon alert-icon' : 'metric-icon'}><Icon size={16} /></span></div><div className="metric-value">{value}</div><div className="metric-bottom">{positive && (change.startsWith('−') ? <ArrowDownRight size={13} /> : <ArrowUpRight size={13} />)}<strong className={positive ? 'positive' : accent ? 'alert-text' : ''}>{change}</strong><span>{note}</span></div></div>
}

function StatusPill({ status, t }: { status: 'Flagged' | 'Matched' | 'Review'; t: (key: string) => string }) {
  return <span className={`row-status ${status.toLowerCase()}`}><i />{t(status)}</span>
}

function FindingItem({ number, title, meta, severity, t }: { number: string; title: string; meta: string; severity: string; t: (key: string) => string }) {
  return <div className="finding-item"><span className="finding-number">{number}</span><span className="finding-copy"><strong>{title}</strong><small>{meta}</small></span><span className={`severity ${severity.toLowerCase()}`}>{t(severity)}</span></div>
}
