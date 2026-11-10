import { InfoTip } from '@/components/ui/info-tip'
import { foundRoadSearchRows, foundRoadSearchSummary } from './foundRoadSearch'
import type { Alignment } from './types'

/** The settings Find the best route used for the open road, when it found it: one line, the rest behind (i). */
export function FoundRoadSearchNote({ alignment }: { alignment: Alignment }) {
  const record = alignment.searchSettings
  if (!record) return null
  const rows = foundRoadSearchRows(alignment)
  return (
    <p className="flex items-center gap-1 text-2xs leading-4 text-muted-foreground" data-testid="road-found-search">
      <span className="min-w-0 flex-1 truncate">{foundRoadSearchSummary(record)}</span>
      <InfoTip label="Settings this road was found with" bubbleClassName="max-w-sm">
        {rows.map((row) => (
          <span key={row.label} className="mb-1 block">
            <b>{row.label}</b>: {row.value}
          </span>
        ))}
        <span className="block">The report prints these under Terrain and assumptions.</span>
      </InfoTip>
    </p>
  )
}
