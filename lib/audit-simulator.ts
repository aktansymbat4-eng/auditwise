import { randomUUID } from 'node:crypto'
import { ERROR_TYPES, type ErrorType } from './i18n'

export { ERROR_TYPES }
export type TableName = 'ledger' | 'invoices' | 'payments' | 'fx' | 'policy'
export type InteractionScenario = 'partial_fx' | 'fx_period'

export interface EpisodeConfig {
  mode?: 'train' | 'evaluation'
  errorTypes?: Partial<Record<ErrorType, boolean>>
  includeClean?: boolean
  interactions?: InteractionScenario[]
  pageSize?: number
}

export interface LedgerRecord {
  row_id: string
  timestamp: string
  account: string
  debit_minor: number
  credit_minor: number
  currency: string
  entity_id: string
  invoice_id: string | null
  payment_id: string | null
}

export interface InvoiceDocument {
  doc_id: string
  invoice_id: string
  entity_id: string
  issued_at: string
  due_at: string
  currency: string
  total_minor: number
  line_items: Array<{ description: string; amount_minor: number }>
}

export interface PaymentDocument {
  doc_id: string
  payment_id: string
  timestamp: string
  currency: string
  amount_minor: number
  invoice_refs: Array<{ invoice_id: string; amount_minor: number }>
}

export interface FxRecord {
  record_id: string
  date: string
  source_currency: string
  target_currency: string
  rate: string
}

export interface Finding {
  type: ErrorType
  affected_ids: string[]
  claimed_amount_minor: number
  currency: string
  evidence_ids: string[]
  explanation: string
}

interface TruthIssue {
  issue_id: string
  type: ErrorType
  affected_ids: string[]
  expected_amount_minor: number
  currency: string
  acceptable_evidence: string[][]
}

interface GeneratedEpisode {
  manifest: Record<string, unknown>
  policy: Record<string, unknown>
  ledger: LedgerRecord[]
  invoices: InvoiceDocument[]
  payments: PaymentDocument[]
  fx: FxRecord[]
  truth: TruthIssue[]
  provenance: Array<Record<string, unknown>>
}

interface Session {
  episodeId: string
  seed: number | string
  config: Required<Pick<EpisodeConfig, 'mode' | 'includeClean' | 'pageSize'>> & EpisodeConfig
  data: GeneratedEpisode
  stepCount: number
  terminated: boolean
  truncated: boolean
  trajectory: Array<Record<string, unknown>>
  createdAt: number
}

export type SimulatorAction =
  | { type: 'list_records'; table: TableName; cursor?: string | null; limit?: number }
  | { type: 'get_record'; table: TableName; id: string }
  | { type: 'get_document'; doc_id: string }
  | { type: 'calculator'; expression: string }
  | { type: 'submit'; findings: { episode_id: string; findings: Finding[] } }

export interface SimulatorObservation {
  episode_id: string
  task: string
  manifest: Record<string, unknown>
  policy: Record<string, unknown>
  remaining_steps: number
  result?: unknown
  error?: string
}

export interface StepResult {
  observation: SimulatorObservation
  reward: number
  terminated: boolean
  truncated: boolean
  info: Record<string, unknown>
}

export interface ResetResult {
  session_id: string
  observation: SimulatorObservation
  info: Record<string, unknown>
}

const sessionHost = globalThis as typeof globalThis & { __auditwiseSimulatorSessions?: Map<string, Session> }
const sessions = sessionHost.__auditwiseSimulatorSessions ?? (sessionHost.__auditwiseSimulatorSessions = new Map<string, Session>())
const MAX_STEPS = 100
const MAX_FINDINGS = 30
const MAX_EVIDENCE = 10
const MAX_EXPLANATION = 1000
const MAX_SESSION_AGE_MS = 60 * 60 * 1000
const VENDORS = ['Northstar Cloud', 'Forma Works', 'Meridian Health', 'Linear Systems', 'Atlas Freight', 'Juniper Labs', 'Cedar & Co', 'Monarch Office']
const COMPANIES = ['Acme Financial', 'Silver Pine Holdings', 'Juniper Ridge Group', 'Meridian Commerce']
const TIMEZONES = [
  { name: 'UTC', offset: '+00:00' },
  { name: 'Asia/Almaty', offset: '+05:00' },
  { name: 'America/New_York', offset: '-05:00' },
  { name: 'Europe/Warsaw', offset: '+01:00' },
]
const CURRENCIES = ['USD', 'USD', 'USD', 'EUR', 'KZT']

function seedNumber(seed: number | string): number {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0
  let hash = 2166136261
  for (const char of String(seed)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return hash >>> 0
}

function randomFor(seed: number | string) {
  let state = seedNumber(seed) || 0x9e3779b9
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 0x100000000
  }
}

function iso(day: number, hour = 12, offset = '+00:00'): string {
  return `2026-11-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00${offset}`
}

function nextId(prefix: string, index: number): string {
  return `${prefix}-${String(index).padStart(5, '0')}`
}

function makePair(
  ledger: LedgerRecord[],
  index: number,
  timestamp: string,
  debitAccount: string,
  creditAccount: string,
  amount: number,
  currency: string,
  entity: string,
  invoiceId: string | null,
  paymentId: string | null,
): string[] {
  const debitId = nextId('JE', index)
  const creditId = nextId('JE', index + 1)
  ledger.push({ row_id: debitId, timestamp, account: debitAccount, debit_minor: amount, credit_minor: 0, currency, entity_id: entity, invoice_id: invoiceId, payment_id: paymentId })
  ledger.push({ row_id: creditId, timestamp, account: creditAccount, debit_minor: 0, credit_minor: amount, currency, entity_id: entity, invoice_id: invoiceId, payment_id: paymentId })
  return [debitId, creditId]
}

function generateEpisode(seed: number | string, config: EpisodeConfig): GeneratedEpisode {
  const rand = randomFor(seed)
  const salt = seedNumber(seed) % 10000
  const timezone = TIMEZONES[seedNumber(seed) % TIMEZONES.length]
  const enabled: Record<ErrorType, boolean> = {
    duplicate_invoice: config.errorTypes?.duplicate_invoice ?? true,
    payment_allocation: config.errorTypes?.payment_allocation ?? true,
    fx_date_rate: config.errorTypes?.fx_date_rate ?? true,
    period_cutoff: config.errorTypes?.period_cutoff ?? true,
  }
  const interactions = (config.interactions ?? ['partial_fx']).filter((scenario) => {
    if (scenario === 'partial_fx') return enabled.payment_allocation && enabled.fx_date_rate
    return enabled.fx_date_rate && enabled.period_cutoff
  })
  const data: GeneratedEpisode = {
    manifest: {
      schema_version: '1.0', episode_id: '', company_name: COMPANIES[seedNumber(seed) % COMPANIES.length], base_currency: 'USD', period_start: '2026-11-01', period_end: '2026-11-30',
      timezone: timezone.name, rounding: 'half_up', minor_unit_exponent: { USD: 2, EUR: 2, KZT: 2 },
    },
    policy: { fx_rate_date: 'payment_date', period_boundary: 'inclusive', rounding: 'half_up', base_currency: 'USD' },
    ledger: [], invoices: [], payments: [], fx: [], truth: [], provenance: [],
  }
  const fxRate = (date: string, currency: string) => currency === 'EUR' ? (date < '2026-11-15' ? '1.0800' : '1.1000') : currency === 'KZT' ? '0.0021' : '1.0000'
  data.fx.push(
    { record_id: `FX-${salt}-USD-20261101`, date: '2026-11-01', source_currency: 'USD', target_currency: 'USD', rate: '1.0000' },
    { record_id: `FX-${salt}-EUR-20261101`, date: '2026-11-01', source_currency: 'EUR', target_currency: 'USD', rate: '1.0800' },
    { record_id: `FX-${salt}-EUR-20261115`, date: '2026-11-15', source_currency: 'EUR', target_currency: 'USD', rate: '1.1000' },
    { record_id: `FX-${salt}-KZT-20261101`, date: '2026-11-01', source_currency: 'KZT', target_currency: 'USD', rate: '0.0021' },
  )

  const issues: TruthIssue[] = []
  let entryIndex = 20400 + salt * 1000
  const issueEvidence = (ids: string[], evidence: string[]) => [Array.from(new Set([...ids, ...evidence])).sort()]
  const invoiceCount = 48
  const duplicateIndex = salt % invoiceCount
  const allocationIndex = (salt + 1) % invoiceCount
  const interactionFxIndex = (salt + 2) % invoiceCount
  const periodIndex = (salt + 3) % invoiceCount
  const cleanPairIndices = config.includeClean === false ? [] : Array.from({ length: invoiceCount }, (_, index) => index)
    .filter((index) => ![duplicateIndex, allocationIndex, interactionFxIndex, periodIndex].includes(index))
    .slice(0, 2)
  const cleanPairAmount = Math.round((150 + rand() * 920) * 100)
  for (let index = 0; index < invoiceCount; index++) {
    const vendor = VENDORS[(index + salt) % VENDORS.length]
    const invoiceNumber = 8800 + salt * 100 + index
    const invoiceId = `INV-${invoiceNumber}`
    const entityId = `ENT-${String(salt * 100 + index + 1).padStart(6, '0')}`
    const currency = cleanPairIndices.includes(index) ? 'USD' : CURRENCIES[(index + salt) % CURRENCIES.length]
    const amount = cleanPairIndices.includes(index)
      ? (cleanPairIndices.indexOf(index) === 0 ? cleanPairAmount : data.invoices[cleanPairIndices[0]].total_minor)
      : Math.round((150 + rand() * 920) * 100)
    const issuedDay = 2 + Math.floor(rand() * 24)
    const invoiceDate = iso(issuedDay, 12, timezone.offset)
    const paymentDate = iso(Math.min(29, issuedDay + 2), 15, timezone.offset)
    const isMisallocationIssue = enabled.payment_allocation && index === allocationIndex
    const isPartialPaymentIssue = enabled.payment_allocation && interactions.includes('partial_fx') && index === interactionFxIndex
    const isAllocationIssue = isMisallocationIssue || isPartialPaymentIssue
    const isFxIssue = enabled.fx_date_rate && (index === interactionFxIndex || (interactions.includes('fx_period') && index === periodIndex))
    const isPeriodIssue = enabled.period_cutoff && index === periodIndex
    const isDuplicateIssue = enabled.duplicate_invoice && index === duplicateIndex
    const transactionCurrency = isFxIssue ? 'EUR' : currency
    const paymentCurrency = transactionCurrency
    const paymentId = `PAY-${9900 + salt * 100 + index}`
    const paymentAmount = isPartialPaymentIssue ? Math.round(amount * 0.62) : amount
    const misallocatedAmount = isMisallocationIssue ? Math.round(paymentAmount * 0.38) : 0
    const correctlyAllocatedAmount = paymentAmount - misallocatedAmount
    const issueIndices = new Set([duplicateIndex, allocationIndex, interactionFxIndex, periodIndex])
    const misallocatedInvoiceIndex = cleanPairIndices[1] ?? Array.from({ length: invoiceCount }, (_, candidate) => candidate).find((candidate) => candidate !== index && !issueIndices.has(candidate)) ?? (index + 1) % invoiceCount
    const misallocatedInvoiceId = `INV-${8800 + salt * 100 + misallocatedInvoiceIndex}`
    const invoiceDoc: InvoiceDocument = {
      doc_id: `DOC-${invoiceId}`, invoice_id: invoiceId, entity_id: entityId, issued_at: invoiceDate, due_at: iso(Math.min(30, issuedDay + 14), 12, timezone.offset), currency: transactionCurrency,
      total_minor: amount, line_items: [{ description: `${vendor} services`, amount_minor: amount }],
    }
    const paymentDoc: PaymentDocument = {
      doc_id: `DOC-${paymentId}`, payment_id: paymentId, timestamp: paymentDate, currency: paymentCurrency, amount_minor: paymentAmount,
      invoice_refs: [
        { invoice_id: invoiceId, amount_minor: correctlyAllocatedAmount },
        ...(misallocatedAmount ? [{ invoice_id: misallocatedInvoiceId, amount_minor: misallocatedAmount }] : []),
      ],
    }
    data.invoices.push(invoiceDoc)
    data.payments.push(paymentDoc)

    const invoiceRows = makePair(data.ledger, entryIndex, invoiceDate, 'Cloud and operating expense', 'Accounts payable', amount, transactionCurrency, entityId, invoiceId, null)
    entryIndex += 2
    const paymentRows = makePair(data.ledger, entryIndex, paymentDate, 'Accounts payable', 'Cash', paymentAmount, paymentCurrency, entityId, invoiceId, paymentId)
    entryIndex += 2

    if (isAllocationIssue) {
      issues.push({ issue_id: `ISS-${invoiceId}-allocation`, type: 'payment_allocation', affected_ids: paymentRows, expected_amount_minor: amount - correctlyAllocatedAmount, currency: transactionCurrency, acceptable_evidence: [[...paymentRows, invoiceDoc.doc_id, paymentDoc.doc_id].sort()] })
      data.provenance.push(isMisallocationIssue
        ? { change: 'payment_partially_allocated_to_wrong_invoice', invoice_id: invoiceId, misallocated_invoice_id: misallocatedInvoiceId, misallocated_amount_minor: misallocatedAmount }
        : { change: 'payment_amount_reduced', invoice_id: invoiceId, from_minor: amount, to_minor: paymentAmount })
    }

    if (isDuplicateIssue) {
      const duplicateRows = makePair(data.ledger, entryIndex, invoiceDate, 'Cloud and operating expense', 'Accounts payable', amount, transactionCurrency, entityId, invoiceId, null)
      entryIndex += 2
      const duplicatePaymentId = `${paymentId}-DUP`
      const duplicatePaymentDoc: PaymentDocument = {
        doc_id: `DOC-${duplicatePaymentId}`, payment_id: duplicatePaymentId, timestamp: paymentDate, currency: paymentCurrency, amount_minor: amount,
        invoice_refs: [{ invoice_id: invoiceId, amount_minor: amount }],
      }
      data.payments.push(duplicatePaymentDoc)
      makePair(data.ledger, entryIndex, paymentDate, 'Accounts payable', 'Cash', amount, paymentCurrency, entityId, invoiceId, duplicatePaymentId)
      entryIndex += 2
      issues.push({ issue_id: `ISS-${invoiceId}-duplicate`, type: 'duplicate_invoice', affected_ids: duplicateRows, expected_amount_minor: amount, currency: transactionCurrency, acceptable_evidence: issueEvidence([...invoiceRows, ...duplicateRows], [invoiceDoc.doc_id]) })
      data.provenance.push({ change: 'duplicate_invoice_payment_added', invoice_id: invoiceId, row_ids: duplicateRows })
    }

    if (isFxIssue && transactionCurrency !== 'USD') {
      const baseRate = fxRate(paymentDate.slice(0, 10), transactionCurrency)
      const selectedRate = baseRate === '1.1000' ? '1.0800' : '1.1000'
      const correctBase = Math.round(paymentAmount * Number(baseRate))
      const recordedBase = Math.round(paymentAmount * Number(selectedRate))
      const fxId = transactionCurrency === 'EUR'
        ? `FX-${salt}-EUR-${baseRate === '1.1000' ? '20261115' : '20261101'}`
        : `FX-${salt}-KZT-20261101`
      const fxRows = makePair(data.ledger, entryIndex, paymentDate, 'Foreign exchange clearing', 'Cash', recordedBase, 'USD', entityId, invoiceId, paymentId)
      entryIndex += 2
      const policyDocId = 'DOC-POLICY-2026-11'
      issues.push({ issue_id: `ISS-${invoiceId}-fx`, type: 'fx_date_rate', affected_ids: fxRows, expected_amount_minor: Math.abs(correctBase - recordedBase), currency: 'USD', acceptable_evidence: [[...fxRows, invoiceDoc.doc_id, paymentDoc.doc_id, fxId, policyDocId].sort()] })
      data.provenance.push({ change: 'fx_rate_selection_changed', invoice_id: invoiceId, expected_rate: baseRate, applied_rate: selectedRate })
    } else if (transactionCurrency !== 'USD') {
      const rate = fxRate(paymentDate.slice(0, 10), transactionCurrency)
      makePair(data.ledger, entryIndex, paymentDate, 'Foreign exchange clearing', 'Cash', Math.round(paymentAmount * Number(rate)), 'USD', entityId, invoiceId, paymentId)
      entryIndex += 2
    }

    if (isPeriodIssue) {
      const lateRecordIds = data.ledger.filter((row) => row.invoice_id === invoiceId && row.payment_id === null).map((row) => row.row_id)
      for (const row of data.ledger) if (lateRecordIds.includes(row.row_id)) row.timestamp = `2026-12-01T00:15:00${timezone.offset}`
      issues.push({ issue_id: `ISS-${invoiceId}-period`, type: 'period_cutoff', affected_ids: lateRecordIds, expected_amount_minor: amount, currency: transactionCurrency, acceptable_evidence: issueEvidence(lateRecordIds, [invoiceDoc.doc_id, 'DOC-POLICY-2026-11']) })
      data.provenance.push({ change: 'posting_timestamp_moved_across_period_boundary', invoice_id: invoiceId, row_ids: lateRecordIds })
    }
  }

  // A plausible split payment and repeated invoice amounts act as clean distractors.
  if (config.includeClean !== false) {
    const splitInvoice = data.invoices[cleanPairIndices[0]]
    if (splitInvoice) {
      const splitPayment = data.payments.find((payment) => payment.invoice_refs.some((ref) => ref.invoice_id === splitInvoice.invoice_id))
      if (splitPayment) {
        const splitFirst = Math.floor(splitPayment.amount_minor * 0.4)
        const splitSecond = splitPayment.amount_minor - splitFirst
        splitPayment.amount_minor = splitFirst
        splitPayment.invoice_refs = [{ invoice_id: splitInvoice.invoice_id, amount_minor: splitFirst }]
        for (const row of data.ledger.filter((item) => item.payment_id === splitPayment.payment_id)) {
          if (row.debit_minor) row.debit_minor = splitFirst
          if (row.credit_minor) row.credit_minor = splitFirst
        }
        const secondId = `PAY-${9900 + salt * 100 + invoiceCount + 1}`
        const splitDate = iso(26, 15, timezone.offset)
        data.payments.push({ doc_id: `DOC-${secondId}`, payment_id: secondId, timestamp: splitDate, currency: splitInvoice.currency, amount_minor: splitSecond, invoice_refs: [{ invoice_id: splitInvoice.invoice_id, amount_minor: splitSecond }] })
        const entity = splitInvoice.entity_id
        makePair(data.ledger, entryIndex, splitDate, 'Accounts payable', 'Cash', splitSecond, splitInvoice.currency, entity, splitInvoice.invoice_id, secondId)
        entryIndex += 2
      }
    }
    const reversalId = `PAY-${9900 + salt * 100 + invoiceCount + 2}`
    const reversalDate = iso(27, 11, timezone.offset)
    data.payments.push({ doc_id: `DOC-${reversalId}`, payment_id: reversalId, timestamp: reversalDate, currency: 'USD', amount_minor: 18500, invoice_refs: [] })
    makePair(data.ledger, entryIndex, reversalDate, 'Cash', 'Accounts receivable', 18500, 'USD', data.invoices[5]?.entity_id ?? 'ENT-000', null, reversalId)
  }

  data.ledger.sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.row_id.localeCompare(right.row_id))
  data.manifest.episode_id = `AUD-${seedNumber(seed).toString(16).toUpperCase().padStart(8, '0')}`
  data.manifest.record_count = data.ledger.length
  data.manifest.document_count = data.invoices.length + data.payments.length + data.fx.length + 1
  data.truth = issues
  return data
}

function baseObservation(session: Session, result?: unknown, error?: string): SimulatorObservation {
  return {
    episode_id: session.episodeId,
    task: 'Inspect the synthetic company records, collect sufficient evidence, and submit any supported financial findings.',
    manifest: session.data.manifest,
    policy: session.data.policy,
    remaining_steps: Math.max(0, MAX_STEPS - session.stepCount),
    ...(result !== undefined ? { result } : {}),
    ...(error ? { error } : {}),
  }
}

export function resetEpisode(seed: number | string, config: EpisodeConfig = {}): ResetResult {
  const normalizedConfig = {
    ...config,
    mode: config.mode ?? 'train',
    includeClean: config.includeClean ?? true,
    pageSize: config.pageSize ?? 50,
  } satisfies Required<Pick<EpisodeConfig, 'mode' | 'includeClean' | 'pageSize'>> & EpisodeConfig
  const data = generateEpisode(seed, normalizedConfig)
  const sessionId = randomUUID()
  const session: Session = {
    episodeId: String(data.manifest.episode_id), seed, config: normalizedConfig, data,
    stepCount: 0, terminated: false, truncated: false, trajectory: [], createdAt: Date.now(),
  }
  sessions.set(sessionId, session)
  for (const [id, existing] of sessions) if (Date.now() - existing.createdAt > MAX_SESSION_AGE_MS) sessions.delete(id)
  return { session_id: sessionId, observation: baseObservation(session), info: {} }
}

function tableRecords(session: Session, table: TableName): unknown[] {
  if (table === 'ledger') return session.data.ledger
  if (table === 'invoices') return session.data.invoices
  if (table === 'payments') return session.data.payments
  if (table === 'fx') return session.data.fx
  if (table === 'policy') return [{ doc_id: 'DOC-POLICY-2026-11', ...session.data.policy }]
  return []
}

function safeCalculate(expression: string): number {
  if (typeof expression !== 'string' || expression.length === 0 || expression.length > 128 || !/^[\d\s.+\-*/()]+$/.test(expression)) throw new Error('Calculator accepts arithmetic expressions only.')
  const tokens = expression.match(/\d+(?:\.\d+)?|[()+\-*/]/g) ?? []
  const normalized = expression.replace(/\s/g, '')
  if (!tokens.length || tokens.join('') !== normalized) throw new Error('Invalid arithmetic expression.')
  const output: string[] = []
  const operators: string[] = []
  const precedence: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, 'u-': 3, 'u+': 3 }
  let expectsValue = true
  for (const token of tokens) {
    if (/^\d/.test(token)) { if (!expectsValue) throw new Error('Invalid arithmetic expression.'); output.push(token); expectsValue = false; continue }
    if (token === '(') { if (!expectsValue) throw new Error('Invalid arithmetic expression.'); operators.push(token); continue }
    if (token === ')') {
      if (expectsValue) throw new Error('Invalid arithmetic expression.')
      while (operators.length && operators.at(-1) !== '(') output.push(operators.pop()!)
      if (operators.pop() !== '(') throw new Error('Invalid arithmetic expression.')
      expectsValue = false
      continue
    }
    const operator = expectsValue ? (token === '-' ? 'u-' : token === '+' ? 'u+' : '') : token
    if (!operator) throw new Error('Invalid arithmetic expression.')
    while (operators.length && operators.at(-1) !== '(' && precedence[operators.at(-1)!] >= precedence[operator]) output.push(operators.pop()!)
    operators.push(operator)
    expectsValue = true
  }
  if (expectsValue) throw new Error('Invalid arithmetic expression.')
  while (operators.length) { const operator = operators.pop()!; if (operator === '(') throw new Error('Invalid arithmetic expression.'); output.push(operator) }
  const values: number[] = []
  for (const token of output) {
    if (/^\d/.test(token)) values.push(Number(token))
    else if (token === 'u-' || token === 'u+') { const value = values.pop(); if (value === undefined) throw new Error('Invalid arithmetic expression.'); values.push(token === 'u-' ? -value : value) }
    else {
      const right = values.pop(); const left = values.pop()
      if (left === undefined || right === undefined) throw new Error('Invalid arithmetic expression.')
      if (token === '/' && right === 0) throw new Error('Division by zero.')
      values.push(token === '+' ? left + right : token === '-' ? left - right : token === '*' ? left * right : left / right)
    }
  }
  if (values.length !== 1 || !Number.isFinite(values[0])) throw new Error('Invalid arithmetic expression.')
  return Number(values[0].toFixed(8))
}

function normalizeIds(ids: string[]): string[] { return [...new Set(ids)].sort() }
function evidenceMatches(given: string[], accepted: string[][]): boolean {
  const evidence = new Set(given)
  return accepted.some((set) => set.every((id) => evidence.has(id)))
}

export function scoreFindings(truth: TruthIssue[], findings: Finding[], inspectionSteps: number) {
  const unmatchedTruth = new Set(truth.map((_, index) => index))
  let tp = 0
  let fp = 0
  for (const finding of findings) {
    const index = [...unmatchedTruth].find((truthIndex) => {
      const expected = truth[truthIndex]
      return expected.type === finding.type
        && expected.currency === finding.currency
        && Math.abs(expected.expected_amount_minor - finding.claimed_amount_minor) <= 1
        && JSON.stringify(normalizeIds(expected.affected_ids)) === JSON.stringify(normalizeIds(finding.affected_ids))
        && evidenceMatches(finding.evidence_ids, expected.acceptable_evidence)
    })
    if (index === undefined) fp++
    else { tp++; unmatchedTruth.delete(index) }
  }
  const fn = unmatchedTruth.size
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp)
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn)
  const f1 = tp === 0 && fp === 0 && fn === 0 ? 1 : (2 * tp) / (2 * tp + fp + fn)
  const reward = Math.max(-1, Math.min(1, 2 * f1 - 1 - 0.002 * inspectionSteps))
  return { tp, fp, fn, precision, recall, f1, reward, inspection_steps: inspectionSteps }
}

function validateSubmission(value: unknown): { episode_id: string; findings: Finding[] } {
  if (!value || typeof value !== 'object') throw new Error('Invalid findings payload.')
  const input = value as { episode_id?: unknown; findings?: unknown }
  if (typeof input.episode_id !== 'string' || !Array.isArray(input.findings) || input.findings.length > MAX_FINDINGS) throw new Error('Invalid findings payload.')
  const findings = input.findings.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid findings payload.')
    const finding = item as Partial<Finding>
    if (!ERROR_TYPES.includes(finding.type as ErrorType) || !Array.isArray(finding.affected_ids) || finding.affected_ids.length === 0 || finding.affected_ids.length > 50 || finding.affected_ids.some((id) => typeof id !== 'string' || id.length > 100) || !Number.isSafeInteger(finding.claimed_amount_minor) || (finding.claimed_amount_minor as number) < 0 || typeof finding.currency !== 'string' || !/^[A-Z]{3}$/.test(finding.currency) || !Array.isArray(finding.evidence_ids) || finding.evidence_ids.length > MAX_EVIDENCE || finding.evidence_ids.some((id) => typeof id !== 'string' || id.length > 120) || typeof finding.explanation !== 'string' || !finding.explanation.trim() || finding.explanation.length > MAX_EXPLANATION) throw new Error('Invalid findings payload.')
    return finding as Finding
  })
  return { episode_id: input.episode_id, findings }
}

function knownIds(session: Session): Set<string> {
  return new Set([
    ...session.data.ledger.map((row) => row.row_id),
    ...session.data.invoices.map((doc) => doc.doc_id), ...session.data.invoices.map((doc) => doc.invoice_id),
    ...session.data.payments.map((doc) => doc.doc_id), ...session.data.payments.map((doc) => doc.payment_id),
    ...session.data.fx.map((row) => row.record_id), 'DOC-POLICY-2026-11',
  ])
}

function takeAction(session: Session, action: SimulatorAction): unknown {
  if (!action || typeof action !== 'object' || typeof action.type !== 'string') throw new Error('Unknown action.')
  switch (action.type) {
    case 'list_records': {
      const table = action.table
      if (!['ledger', 'invoices', 'payments', 'fx', 'policy'].includes(table)) throw new Error('Unknown table.')
      const records = tableRecords(session, table)
      const limit = Math.max(1, Math.min(50, Number.isInteger(action.limit) ? action.limit! : session.config.pageSize))
      const start = action.cursor ? Number.parseInt(action.cursor, 10) : 0
      if (!Number.isSafeInteger(start) || start < 0 || start > records.length) throw new Error('Invalid cursor.')
      const next = start + limit
      return { table, records: records.slice(start, next), next_cursor: next < records.length ? String(next) : null, total: records.length }
    }
    case 'get_record': {
      if (!['ledger', 'invoices', 'payments', 'fx', 'policy'].includes(action.table)) throw new Error('Unknown table.')
      const record = tableRecords(session, action.table).find((item) => {
        const value = item as Record<string, unknown>
        return [value.row_id, value.doc_id, value.invoice_id, value.payment_id, value.record_id].includes(action.id)
      })
      if (!record) throw new Error('Record not found.')
      return record
    }
    case 'get_document': {
      const document = [...session.data.invoices, ...session.data.payments].find((item) => item.doc_id === action.doc_id)
      if (document) return document
      if (action.doc_id === 'DOC-POLICY-2026-11') return { doc_id: action.doc_id, ...session.data.policy }
      const fxDocument = session.data.fx.find((item) => `DOC-${item.record_id}` === action.doc_id)
      if (fxDocument) return fxDocument
      throw new Error('Document not found.')
    }
    case 'calculator': return { expression: action.expression, result: safeCalculate(action.expression) }
    case 'submit': {
      const payload = validateSubmission(action.findings)
      if (payload.episode_id !== session.episodeId) throw new Error('Episode ID does not match the active episode.')
      const available = knownIds(session)
      if (payload.findings.some((finding) => [...finding.affected_ids, ...finding.evidence_ids].some((id) => !available.has(id)))) throw new Error('Unknown record or evidence ID.')
      return { submitted: true, findings_count: payload.findings.length, score: scoreFindings(session.data.truth, payload.findings, Math.max(0, session.stepCount - 1)) }
    }
    default: throw new Error('Unknown action.')
  }
}

export function stepEpisode(sessionId: string, action: SimulatorAction): StepResult {
  const session = sessions.get(sessionId)
  if (!session) throw new Error('Episode session not found or expired. Reset to start a new episode.')
  if (session.terminated || session.truncated) throw new Error('Episode has already ended.')
  session.stepCount++
  let result: unknown
  let error: string | undefined
  let reward = 0
  if (action?.type === 'submit') {
    try {
      result = takeAction(session, action)
      session.terminated = true
      const submitted = result as { findings_count: number; score: ReturnType<typeof scoreFindings> }
      reward = session.config.mode === 'train' ? submitted.score.reward : 0
      result = session.config.mode === 'train'
        ? { submitted: true, findings_count: submitted.findings_count, score: submitted.score }
        : { submitted: true, findings_count: submitted.findings_count }
    } catch {
      session.terminated = true
      reward = session.config.mode === 'train' ? -1 : 0
      error = 'Invalid findings payload.'
    }
  } else if (session.stepCount >= MAX_STEPS) {
    session.truncated = true
    result = undefined
  } else {
    try { result = takeAction(session, action) }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Action failed.' }
  }
  const observation = session.truncated
    ? {} as SimulatorObservation
    : baseObservation(session, result, error)
  const step = { action, observation, reward, terminated: session.terminated, truncated: session.truncated }
  session.trajectory.push({ episode_id: session.episodeId, step: session.stepCount, ...step })
  return { observation, reward, terminated: session.terminated, truncated: session.truncated, info: {} }
}

export function trajectoryJsonl(sessionId: string): string {
  const session = sessions.get(sessionId)
  if (!session) throw new Error('Episode session not found or expired.')
  return session.trajectory.map((item) => JSON.stringify(item)).join('\n') + (session.trajectory.length ? '\n' : '')
}

export function getSessionSnapshot(sessionId: string) {
  const session = sessions.get(sessionId)
  if (!session) throw new Error('Episode session not found or expired.')
  return { episode_id: session.episodeId, step_count: session.stepCount, terminated: session.terminated, truncated: session.truncated, ledger: session.data.ledger, invoices: session.data.invoices, payments: session.data.payments, fx: session.data.fx }
}

function evaluateHeuristic(data: GeneratedEpisode, seed: number | string) {
  const findings: Finding[] = []
  const add = (type: ErrorType, ids: string[], amount: number, currency: string, evidence: string[], explanation: string) => {
    findings.push({ type, affected_ids: ids, claimed_amount_minor: amount, currency, evidence_ids: evidence, explanation })
  }
  const invoiceGroups = new Map<string, LedgerRecord[]>()
  for (const row of data.ledger.filter((item) => item.payment_id === null && item.invoice_id)) {
    invoiceGroups.set(row.invoice_id!, [...(invoiceGroups.get(row.invoice_id!) ?? []), row])
  }
  for (const [invoiceId, rows] of invoiceGroups) {
    const debitRows = rows.filter((row) => row.debit_minor > 0)
    const creditRows = rows.filter((row) => row.credit_minor > 0)
    if (debitRows.length > 1 && creditRows.length > 1) {
      const doc = data.invoices.find((item) => item.invoice_id === invoiceId)
      const duplicateRows = [debitRows.at(-1)!, creditRows.at(-1)!]
      if (doc) add('duplicate_invoice', duplicateRows.map((row) => row.row_id), doc.total_minor, doc.currency, [doc.doc_id, ...rows.map((row) => row.row_id)], 'Repeated invoice posting for the same vendor document.')
    }
  }
  for (const invoice of data.invoices) {
    const payments = data.payments.filter((item) => item.invoice_refs.some((ref) => ref.invoice_id === invoice.invoice_id))
    const allocated = payments.reduce((sum, item) => sum + item.invoice_refs.filter((ref) => ref.invoice_id === invoice.invoice_id).reduce((inner, ref) => inner + ref.amount_minor, 0), 0)
    if (allocated < invoice.total_minor) {
      const paymentIds = new Set(payments.map((item) => item.payment_id))
      const affected = data.ledger.filter((row) => row.invoice_id === invoice.invoice_id && row.payment_id && paymentIds.has(row.payment_id) && (row.account === 'Accounts payable' || (row.account === 'Cash' && row.currency === invoice.currency))).map((row) => row.row_id)
      add('payment_allocation', affected, invoice.total_minor - allocated, invoice.currency, [invoice.doc_id, ...payments.map((item) => item.doc_id), ...affected], 'Payment allocation does not reconcile to the invoice total.')
    }
  }
  for (const fx of data.fx.filter((item) => item.source_currency !== item.target_currency)) {
    for (const payment of data.payments.filter((item) => item.currency === fx.source_currency)) {
      const expectedRate = data.fx
        .filter((item) => item.source_currency === payment.currency && item.target_currency === 'USD' && item.date <= payment.timestamp.slice(0, 10))
        .sort((left, right) => right.date.localeCompare(left.date))[0]
      if (!expectedRate || expectedRate.record_id !== fx.record_id) continue
      const fxRows = data.ledger.filter((row) => row.payment_id === payment.payment_id && row.currency === 'USD' && (row.account === 'Foreign exchange clearing' || row.account === 'Cash'))
      if (!fxRows.some((row) => row.account === 'Foreign exchange clearing')) continue
      const expectedBase = Math.round(payment.amount_minor * Number(expectedRate.rate))
      const recordedBase = fxRows.reduce((sum, row) => sum + row.debit_minor + row.credit_minor, 0) / 2
      if (recordedBase !== expectedBase) {
        const invoiceId = payment.invoice_refs[0]?.invoice_id
        const invoice = data.invoices.find((item) => item.invoice_id === invoiceId)
        const fxEvidence = fxRows.map((row) => row.row_id)
        const fxId = data.fx.find((item) => item.record_id === expectedRate.record_id)?.record_id
        if (invoice && fxId) add('fx_date_rate', fxEvidence, Math.abs(recordedBase - expectedBase), 'USD', [invoice.doc_id, payment.doc_id, fxId, 'DOC-POLICY-2026-11', ...fxEvidence], 'Recorded conversion differs from the policy rate for the payment date.')
      }
    }
  }
  const outOfPeriod = data.ledger.filter((row) => row.timestamp.slice(0, 10) > '2026-11-30' && row.invoice_id)
  for (const invoiceId of new Set(outOfPeriod.map((row) => row.invoice_id!))) {
    const rows = outOfPeriod.filter((row) => row.invoice_id === invoiceId && row.payment_id === null)
    const invoice = data.invoices.find((item) => item.invoice_id === invoiceId)
    if (rows.length && invoice && invoice.issued_at.slice(0, 10) <= '2026-11-30') add('period_cutoff', rows.map((row) => row.row_id), invoice.total_minor, invoice.currency, [invoice.doc_id, 'DOC-POLICY-2026-11', ...rows.map((row) => row.row_id)], 'Invoice was posted outside its reporting period.')
  }
  return findings.slice(0, 30)
}

function potentialSignals(data: GeneratedEpisode) {
  const findings = evaluateHeuristic(data, 'signal-scan')
  const byType = Object.fromEntries(ERROR_TYPES.map((type) => [type, findings.filter((finding) => finding.type === type).length])) as Record<ErrorType, number>
  const reconciledSplitPayments = data.invoices.filter((invoice) => {
    const payments = data.payments.filter((payment) => payment.invoice_refs.some((reference) => reference.invoice_id === invoice.invoice_id))
    const allocated = payments.reduce((sum, payment) => sum + payment.invoice_refs.filter((reference) => reference.invoice_id === invoice.invoice_id).reduce((amount, reference) => amount + reference.amount_minor, 0), 0)
    return payments.length > 1 && allocated === invoice.total_minor
  }).length
  byType.payment_allocation += reconciledSplitPayments
  return { count: Object.values(byType).reduce((total, count) => total + count, 0), byType }
}

function createOracleFindings(session: Session): Finding[] {
  return session.data.truth.slice(0, MAX_FINDINGS).map((issue) => ({ type: issue.type, affected_ids: [...issue.affected_ids], claimed_amount_minor: issue.expected_amount_minor, currency: issue.currency, evidence_ids: [...issue.acceptable_evidence[0]], explanation: 'Evidence-backed reference finding for evaluator calibration.' }))
}

export function runBaselines(options: { seed?: number | string; episodes?: number } = {}) {
  const episodeCount = Math.max(4, Math.min(40, Math.floor(options.episodes ?? 20)))
  const firstSeed = options.seed ?? 'auditwise-benchmark-v1'
  const aggregate = new Map<string, { tp: number; fp: number; fn: number; reward: number; steps: number }>()
  const policies = ['random', 'reconciliation', 'mark_all', 'oracle'] as const
  const started = Date.now()
  const benchmarkSessionIds: string[] = []
  for (let index = 0; index < episodeCount; index++) {
    const cleanCount = Math.floor(episodeCount / 4)
    const interactionCount = Math.floor(episodeCount / 4)
    const clean = index < cleanCount
    const isInteraction = index >= cleanCount && index < cleanCount + interactionCount
    const interaction = isInteraction ? [index % 2 === 0 ? 'partial_fx' : 'fx_period'] as InteractionScenario[] : []
    const reset = resetEpisode(`${firstSeed}-${index}`, { mode: 'train', includeClean: true, interactions: interaction, errorTypes: clean ? Object.fromEntries(ERROR_TYPES.map((type) => [type, false])) as Record<ErrorType, boolean> : undefined })
    benchmarkSessionIds.push(reset.session_id)
    const session = sessions.get(reset.session_id)!
    for (const policy of policies) {
      const sessionClone = { ...session, stepCount: 0 }
      let findings: Finding[]
      let steps = 1
      if (policy === 'oracle') findings = createOracleFindings(sessionClone)
      else if (policy === 'reconciliation') { findings = evaluateHeuristic(sessionClone.data, `${firstSeed}-${index}`); steps = Math.min(20, 4 + sessionClone.data.invoices.length) }
      else if (policy === 'random') { findings = []; steps = 1 + Math.floor(randomFor(`${firstSeed}-${index}-random`)() * 15) }
      else {
        findings = sessionClone.data.ledger.slice(0, MAX_FINDINGS).map((row) => ({ type: 'duplicate_invoice' as const, affected_ids: [row.row_id], claimed_amount_minor: row.debit_minor || row.credit_minor, currency: row.currency, evidence_ids: [row.row_id], explanation: 'Flag every record.' }))
        steps = 1
      }
      const score = scoreFindings(sessionClone.data.truth, findings, steps)
      const current = aggregate.get(policy) ?? { tp: 0, fp: 0, fn: 0, reward: 0, steps: 0 }
      current.tp += score.tp; current.fp += score.fp; current.fn += score.fn; current.reward += score.reward; current.steps += steps
      aggregate.set(policy, current)
    }
  }
  for (const sessionId of benchmarkSessionIds) sessions.delete(sessionId)
  const results = policies.map((policy) => {
    const result = aggregate.get(policy)!
    const precision = result.tp + result.fp === 0 ? 0 : result.tp / (result.tp + result.fp)
    const recall = result.tp + result.fn === 0 ? 0 : result.tp / (result.tp + result.fn)
    const f1 = result.tp === 0 && result.fp === 0 && result.fn === 0 ? 1 : (2 * result.tp) / (2 * result.tp + result.fp + result.fn)
    return { policy, episodes: episodeCount, precision, recall, f1, mean_reward: result.reward / episodeCount, mean_steps: result.steps / episodeCount }
  })
  return { benchmark_id: `BENCH-${seedNumber(firstSeed).toString(16)}`, episodes: episodeCount, clean_episodes: Math.floor(episodeCount / 4), interacting_episodes: Math.floor(episodeCount / 4), elapsed_ms: Date.now() - started, policies: results }
}

export function inspectEpisode(sessionId: string) {
  const session = sessions.get(sessionId)
  if (!session) throw new Error('Episode session not found or expired.')
  const potential = potentialSignals(session.data)
  return { episode_id: session.episodeId, manifest: session.data.manifest, ledger: session.data.ledger, invoices: session.data.invoices, payments: session.data.payments, fx: session.data.fx, policy: session.data.policy, potential_count: potential.count, potential_by_type: potential.byType, step_count: session.stepCount, remaining_steps: Math.max(0, MAX_STEPS - session.stepCount), terminated: session.terminated, truncated: session.truncated }
}

export function baselineFindings(sessionId: string, policy: 'random' | 'reconciliation' | 'mark_all') {
  const session = sessions.get(sessionId)
  if (!session) throw new Error('Episode session not found or expired.')
  if (policy === 'reconciliation') return evaluateHeuristic(session.data, session.seed)
  if (policy === 'random') {
    const rand = randomFor(`${session.seed}-random-policy`)
    const candidates = session.data.ledger.slice(0, 8)
    if (rand() > 0.7 || !candidates.length) return []
    const row = candidates[Math.floor(rand() * candidates.length)]
    return [{ type: ERROR_TYPES[Math.floor(rand() * ERROR_TYPES.length)], affected_ids: [row.row_id], claimed_amount_minor: row.debit_minor || row.credit_minor, currency: row.currency, evidence_ids: [row.row_id], explanation: 'Seeded random policy candidate.' }] satisfies Finding[]
  }
  return session.data.ledger.slice(0, MAX_FINDINGS).map((row) => ({ type: 'duplicate_invoice' as const, affected_ids: [row.row_id], claimed_amount_minor: row.debit_minor || row.credit_minor, currency: row.currency, evidence_ids: [row.row_id], explanation: 'Mark-all baseline.' }))
}
