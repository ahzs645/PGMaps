import { Badge } from '@/components/ui/badge'
import { InsetBox } from '@/components/ui/inset-box'
import { EmptyHint, ListHeader, ResultRow } from '@/components/ui/result-list'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
import { formatRoadStation } from '../Charts'
import type { Culvert, CulvertAnalysis } from '../engineeringTypes'
import type { InvalidInput } from '../inputErrors'
import type { RoadStationing } from '../roadStationing'
import { culvertSizeText } from './culvertShape'
import { culvertInventoryStatus } from './culvertInventoryStatus'
import type { CulvertSchedule } from './culvertSchedule'

const WHOLE = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 0 })
const key = (culvert: Culvert) => culvert.id

/** Compact navigation stays above one editor; long inventories keep keyboard navigation and virtualization. */
export function CulvertInventory({
  culverts,
  schedule,
  results,
  invalid,
  selectedId,
  stationing,
  onSelect,
}: {
  culverts: readonly Culvert[]
  schedule: CulvertSchedule | null
  results: readonly CulvertAnalysis[] | undefined
  invalid?: InvalidInput
  selectedId?: string
  stationing?: RoadStationing
  onSelect: (id: string) => void
}) {
  const ordered = [...culverts].sort((a, b) => a.chainage - b.chainage)
  const rows = new Map(schedule?.rows.map((row) => [row.id, row]))
  const calculated = new Map(results?.map((row) => [row.id, row]))
  return (
    <section aria-label="Culvert inventory" data-testid="road-culvert-inventory">
      <ListHeader count={culverts.length} noun={['culvert', 'culverts']} aside="By station" />
      {culverts.length ? (
        <InsetBox padding="none" className="max-h-56 overflow-y-auto" data-map-sidebar-scroll="true">
          <VirtualResultList
            items={ordered}
            getKey={key}
            estimateSize={82}
            label="Culverts by station"
            revealKey={selectedId}
          >
            {(culvert) => {
              const row = rows.get(culvert.id)
              const status = culvertInventoryStatus(
                row,
                calculated.get(culvert.id)?.warnings,
                invalid?.target?.list === 'culverts' && invalid.target.id === culvert.id,
              )
              const cost = row?.cost
              return (
                <ResultRow
                  title={culvert.name || 'Unnamed culvert'}
                  subtitle={`${formatRoadStation(culvert.chainage, stationing ?? null)} · ${culvertSizeText(culvert)} · ${culvert.lengthM} m span`}
                  meta={
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={status.tone}>{status.label}</Badge>
                      <span className="text-2xs">
                        {cost?.replacedByCrossingRecord
                          ? 'Crossing estimate'
                          : cost?.installedCad == null
                            ? 'Cost not calculated'
                            : cost.installedCad === 0
                              ? 'Unpriced'
                              : `$${WHOLE.format(cost.installedCad)} installed${cost.provisional ? ' · provisional' : ''}`}
                      </span>
                    </span>
                  }
                  selected={culvert.id === selectedId}
                  aria-label={`Edit ${culvert.name || 'unnamed culvert'} at ${formatRoadStation(culvert.chainage, stationing ?? null)}`}
                  onClick={() => onSelect(culvert.id)}
                  className="px-2 py-2"
                />
              )
            }}
          </VirtualResultList>
        </InsetBox>
      ) : (
        <EmptyHint>Add a culvert at the selected road station, or choose an unserved crossing below.</EmptyHint>
      )}
    </section>
  )
}
