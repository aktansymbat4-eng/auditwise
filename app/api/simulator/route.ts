import { NextRequest, NextResponse } from 'next/server'
import {
  getEpisodeObservation,
  inspectEpisode,
  randomFindingsFromObservation,
  reconciliationFindings,
  resetEpisode,
  runBaselines,
  stepEpisode,
  trajectoryJsonl,
  type EpisodeConfig,
  type FxRecord,
  type InvoiceDocument,
  type LedgerRecord,
  type PaymentDocument,
  type PolicyDataset,
  type SimulatorAction,
} from '@/lib/audit-simulator'

export const runtime = 'nodejs'

function publicError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return publicError('Request body must be valid JSON.')
  }

  try {
    if (body.operation === 'reset') {
      const seed = typeof body.seed === 'string' || typeof body.seed === 'number' ? body.seed : 'auditwise-demo-v1'
      const config = body.config && typeof body.config === 'object' ? body.config as EpisodeConfig : {}
      const reset = resetEpisode(seed, config)
      return NextResponse.json({ ...reset, episode: inspectEpisode(reset.session_id) })
    }

    if (body.operation === 'step') {
      if (typeof body.session_id !== 'string' || !body.action || typeof body.action !== 'object') return publicError('A session ID and valid action are required.')
      const result = stepEpisode(body.session_id, body.action as SimulatorAction)
      return NextResponse.json({ ...result, episode: inspectEpisode(body.session_id), trajectory: trajectoryJsonl(body.session_id) })
    }

    if (body.operation === 'run_policy') {
      if (typeof body.session_id !== 'string') return publicError('A session ID is required.')
      const policy = body.policy === 'random' ? 'random' : 'reconciliation'
      const initial = getEpisodeObservation(body.session_id)
      const policyData: PolicyDataset = { manifest: initial.manifest, policy: initial.policy, ledger: [], invoices: [], payments: [], fx: [] }
      for (const table of ['ledger', 'invoices', 'payments', 'fx'] as const) {
        let cursor: string | null = null
        do {
          const page = stepEpisode(body.session_id, { type: 'list_records', table, cursor, limit: 50 })
          const result = page.observation.result as { records?: unknown; next_cursor?: unknown } | undefined
          if (page.truncated || page.observation.error || !result || !Array.isArray(result.records)) throw new Error('Policy could not read the available record pages.')
          if (table === 'ledger') policyData.ledger.push(...result.records as LedgerRecord[])
          else if (table === 'invoices') policyData.invoices.push(...result.records as InvoiceDocument[])
          else if (table === 'payments') policyData.payments.push(...result.records as PaymentDocument[])
          else policyData.fx.push(...result.records as FxRecord[])
          if (result.next_cursor !== null && typeof result.next_cursor !== 'string') throw new Error('Policy received an invalid page cursor.')
          cursor = result.next_cursor
        } while (cursor !== null)
      }
      const findings = policy === 'random'
        ? randomFindingsFromObservation(policyData, initial.episode_id)
        : reconciliationFindings(policyData)
      const affectedIds = [...new Set(findings.flatMap((finding) => finding.affected_ids))].slice(0, 35)
      for (const id of affectedIds) {
        if (getEpisodeObservation(body.session_id).remaining_steps <= 2) break
        stepEpisode(body.session_id, { type: 'get_record', table: 'ledger', id })
      }
      if (body.submit === true) {
        const last = stepEpisode(body.session_id, {
          type: 'submit',
          findings: { episode_id: initial.episode_id, findings },
        })
        return NextResponse.json({ ...last, findings, episode: inspectEpisode(body.session_id), trajectory: trajectoryJsonl(body.session_id) })
      }
      return NextResponse.json({ findings, submitted: false, episode: inspectEpisode(body.session_id), trajectory: trajectoryJsonl(body.session_id) })
    }

    if (body.operation === 'benchmark') {
      const seed = typeof body.seed === 'string' ? body.seed : 'auditwise-benchmark-v1'
      const episodes = typeof body.episodes === 'number' ? body.episodes : 20
      return NextResponse.json({ benchmark: runBaselines({ seed, episodes }) })
    }

    return publicError('Unknown simulator operation.')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Simulator operation failed.'
    return publicError(message, message.includes('expired') ? 404 : 400)
  }
}

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('session_id')
  if (!sessionId) return publicError('A session ID is required.')
  try {
    return new NextResponse(trajectoryJsonl(sessionId), {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Content-Disposition': 'attachment; filename="trajectories.jsonl"',
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Trajectory is unavailable.'
    return publicError(message, 404)
  }
}
