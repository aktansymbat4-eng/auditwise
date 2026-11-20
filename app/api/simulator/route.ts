import { NextRequest, NextResponse } from 'next/server'
import {
  baselineFindings,
  inspectEpisode,
  resetEpisode,
  runBaselines,
  stepEpisode,
  trajectoryJsonl,
  type EpisodeConfig,
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
      const initial = inspectEpisode(body.session_id)
      const tableSizes = { ledger: initial.ledger.length, invoices: initial.invoices.length, payments: initial.payments.length, fx: initial.fx.length }
      for (const [table, count] of Object.entries(tableSizes) as Array<[keyof typeof tableSizes, number]>) {
        const pages = Math.max(1, Math.ceil(count / 50))
        for (let page = 0; page < pages; page++) {
          stepEpisode(body.session_id, { type: 'list_records', table, cursor: page ? String(page * 50) : null, limit: 50 })
        }
      }
      const findings = policy === 'random' ? baselineFindings(body.session_id, 'random') : baselineFindings(body.session_id, 'reconciliation')
      const affectedIds = [...new Set(findings.flatMap((finding) => finding.affected_ids))].slice(0, 35)
      for (const id of affectedIds) {
        if (inspectEpisode(body.session_id).remaining_steps <= 2) break
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
