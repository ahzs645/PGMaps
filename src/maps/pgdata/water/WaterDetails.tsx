import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { ExternalLink } from '@/components/ui/text-button'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { formatDate } from '../shared'
import { getNoticeDetail, getNoticeDetailsUrl } from './utils'
import type { WaterNoticeRow } from './types'

export function WaterDetailSection({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="font-semibold text-foreground">{title}</div>
        <div className="text-xs tabular-nums text-muted-foreground">{formatNumber(count)}</div>
      </div>
      <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
        {children}
      </div>
    </div>
  )
}

export function EmptyWaterDetail({ label }: { label: string }) {
  return (
    <div className="rounded border border-dashed border-border p-2 text-muted-foreground">{label}</div>
  )
}

export function WaterNoticeCard({ notice, compact = false }: { notice: WaterNoticeRow; compact?: boolean }) {
  const underlyingProblems = getNoticeDetail(notice, 'underlying_problems')
  const stepsTaken = getNoticeDetail(notice, 'steps_taken_to_remedy')
  const correctiveActions = getNoticeDetail(notice, 'corrective_actions_remaining')
  const waterTodayDetails = getNoticeDetail(notice, 'details') || getNoticeDetail(notice, 'map_details')
  const detailsUrl = getNoticeDetailsUrl(notice.source)

  return (
    <div className={cn('rounded border border-border bg-background', compact ? 'p-2' : 'p-3 text-sm')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="font-medium text-foreground">{notice.type}</div>
        <Badge tone="danger" size="sm" pill>
          Active
        </Badge>
      </div>
      <div className="mt-1 flex justify-between gap-2 text-muted-foreground">
        <span>{notice.primarySource || notice.status}{notice.sourceCount > 1 ? ` +${notice.sourceCount - 1}` : ''}</span>
        <span>Started {formatDate(notice.date?.toISOString())}</span>
      </div>
      {(underlyingProblems || stepsTaken || correctiveActions || waterTodayDetails || detailsUrl) && (
        <div className="mt-2 space-y-2 border-t border-border pt-2 text-xs">
          {underlyingProblems && (
            <div>
              <div className="font-medium text-foreground">Underlying problems</div>
              <div className="mt-0.5 leading-relaxed text-muted-foreground">{underlyingProblems}</div>
            </div>
          )}
          {stepsTaken && (
            <div>
              <div className="font-medium text-foreground">Steps taken to remedy</div>
              <div className="mt-0.5 leading-relaxed text-muted-foreground">{stepsTaken}</div>
            </div>
          )}
          {correctiveActions && (
            <div>
              <div className="font-medium text-foreground">Corrective actions remaining</div>
              <div className="mt-0.5 leading-relaxed text-muted-foreground">{correctiveActions}</div>
            </div>
          )}
          {!underlyingProblems && waterTodayDetails && (
            <div>
              <div className="font-medium text-foreground">Notice details</div>
              <div className="mt-0.5 whitespace-pre-line leading-relaxed text-muted-foreground">{waterTodayDetails}</div>
            </div>
          )}
          {detailsUrl && <ExternalLink href={detailsUrl} />}
        </div>
      )}
    </div>
  )
}
