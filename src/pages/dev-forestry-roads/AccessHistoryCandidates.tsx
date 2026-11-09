import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert } from '@/components/ui/map-panels'
import { ListHeader, ResultRow } from '@/components/ui/result-list'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
import {
  historicalRoadCandidates,
  type HistoricalRoadCandidate,
  type SourceCodeComparison,
} from './accessHistoryCandidates'
import type { HistoricalCoverageSummary } from './accessHistorySummary'
import type { AccessHistorySelection } from './AccessHistorySelection'
import type { ContextFeature, Coordinate } from './types'
import { Field, roadFieldClass } from './Controls'

const codeLabel = (label: string, comparison: SourceCodeComparison) =>
  comparison === 'same'
    ? `${label} matches`
    : comparison === 'different'
      ? `${label} differs`
      : comparison === 'conflicting'
        ? `Opening ${label.toLowerCase()} records conflict`
        : `${label} comparison unavailable`

/** Clickable geometry candidates make the actual source roads visible before a historical route can be established. */
export function AccessHistoryCandidates({
  coverage,
  context,
  selection,
  disabled,
  onInspect,
  onLocate,
}: {
  coverage: HistoricalCoverageSummary
  context: readonly ContextFeature[]
  selection?: Pick<AccessHistorySelection, 'kind' | 'id'> | null
  disabled: boolean
  onInspect: (kind: 'road', id: string) => void
  onLocate?: (coordinates: Coordinate[]) => void
}) {
  const [filter, setFilter] = useState('')
  const measured = useMemo(() => {
    if (!coverage.block || coverage.scope !== 'loaded-study-area') return null
    try {
      return {
        candidates: historicalRoadCandidates({
          block: coverage.block,
          context,
          roads: coverage.roads.map(({ feature }) => feature),
          sources: coverage.identitySources,
        }),
        error: '',
      }
    } catch (cause) {
      return { candidates: [], error: cause instanceof Error ? cause.message : 'Road proximity could not be measured.' }
    }
  }, [coverage, context])
  if (!measured || !coverage.roads.length) return null
  const needle = filter.trim().toLowerCase()
  const filtered = measured.candidates.filter(({ road }) =>
    [
      road.name,
      road.roadEvidence?.forestFileId,
      road.roadEvidence?.roadSectionId,
      road.roadEvidence?.timberMark,
      road.roadEvidence?.clientNumber,
    ].some((value) => value?.toLowerCase().includes(needle)),
  )
  const row = ({ road, distanceM, client, timberMark }: HistoricalRoadCandidate) => (
    <ResultRow
      title={
        road.roadEvidence?.forestFileId && road.roadEvidence.roadSectionId
          ? `${road.roadEvidence.forestFileId} / ${road.roadEvidence.roadSectionId}`
          : road.name
      }
      subtitle={distanceM === 0 ? 'Intersects the block footprint' : 'Separation from the block footprint'}
      meta={`${codeLabel('Client', client)} · ${codeLabel('Timber mark', timberMark)}`}
      trailing={distanceM === 0 ? '0 m' : distanceM < 1 ? '<1 m' : `≈${Math.round(distanceM)} m`}
      selected={selection?.kind === 'road' && selection.id === road.id}
      accent="sky"
      disabled={disabled}
      aria-label={`Inspect nearby road ${road.name}`}
      onClick={() => {
        onInspect('road', road.id)
        if (road.geometry.type === 'LineString')
          onLocate?.(road.geometry.coordinates.map(([x, y]) => [x, y] as Coordinate))
      }}
    />
  )
  return (
    <section
      className="space-y-2 border-t pt-2"
      aria-label="Nearby road candidates"
      data-testid="history-road-candidates"
    >
      <div className="flex items-center gap-1">
        <h4 className="font-medium">Roads near this block</h4>
        <InfoTip label="How nearby road candidates are measured">
          Sorted by the shortest separation between the complete block footprint and retained road linework, within 1
          km. Intersection and matching business codes identify records to inspect. They do not establish an entrance,
          construction date, connected route or historical road use.
        </InfoTip>
      </div>
      {measured.error ? (
        <InlineAlert tone="warning">{measured.error}</InlineAlert>
      ) : (
        <>
          <p className="text-2xs text-muted-foreground">
            Select a road to locate its source geometry and inspect its evidence.
          </p>
          <Field label="Filter nearby roads">
            <div className="flex gap-1">
              <input
                type="search"
                className={roadFieldClass}
                placeholder="Permit, section, timber mark or client"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
              {filter && (
                <Button size="sm" variant="ghost" onClick={() => setFilter('')}>
                  Clear
                </Button>
              )}
            </div>
          </Field>
          <div className="max-h-72 overflow-y-auto rounded border" data-map-sidebar-scroll="true">
            <ListHeader
              count={filtered.length}
              noun={['candidate within 1 km', 'candidates within 1 km']}
              aside={needle ? `${measured.candidates.length} before filter` : `${coverage.roads.length} loaded`}
            />
            {filtered.length > 50 ? (
              <VirtualResultList
                items={filtered}
                getKey={(candidate) => candidate.road.id}
                estimateSize={92}
                label="Road candidates by footprint separation"
                revealKey={selection?.kind === 'road' ? selection.id : null}
              >
                {row}
              </VirtualResultList>
            ) : (
              <ul className="divide-y" aria-label="Road candidates by footprint separation">
                {filtered.map((candidate) => (
                  <li key={candidate.road.id}>{row(candidate)}</li>
                ))}
              </ul>
            )}
            {!filtered.length && (
              <p className="p-3 text-muted-foreground">
                {needle
                  ? 'No nearby road matches this filter.'
                  : 'None of the loaded road lines is within 1 km of this block. The wider query envelope can return roads farther away.'}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  )
}
