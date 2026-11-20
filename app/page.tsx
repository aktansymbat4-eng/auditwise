import { AuditWiseDashboard } from '@/components/auditwise-dashboard'
import { inspectEpisode, resetEpisode } from '@/lib/audit-simulator'

export const dynamic = 'force-dynamic'

export default function Page() {
  const reset = resetEpisode('auditwise-demo-seed-v1', {
    mode: 'train',
    includeClean: true,
    interactions: ['partial_fx'],
    errorTypes: {
      duplicate_invoice: true,
      payment_allocation: true,
      fx_date_rate: true,
      period_cutoff: true,
    },
  })

  return <AuditWiseDashboard initialSession={reset.session_id} initialEpisode={inspectEpisode(reset.session_id)} />
}
