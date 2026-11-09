import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { LocateFixed, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { ResultRow } from '@/components/ui/result-list'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert, KeyValueRows } from '@/components/ui/map-panels'
import { NumberField, RoadSelect } from './Controls'
import { RoadSection } from './SidebarParts'
import { existingRoadQueryBounds, loadBcExistingRoads } from './existingRoads'
import { refreshExistingRoadFeature } from './existingRoadEvidence'
import {
  harvestAgeSummary,
  harvestHistoryStyle,
  importHarvestHistory,
  loadBcHarvestHistory,
  nearbyRoadCandidates,
} from './harvestHistory'
import { roadHistoryStyle } from './roadHistory'
import { parseProject } from './project'
import { polygonAreaM2 } from './mapNotes'
import type { ContextFeature, Coordinate } from './types'
import type { RoadWorkspace } from './useRoadWorkspace'

export const MAX_CUTBLOCK_IMPORT_BYTES = 10 * 1024 * 1024
export const HISTORY_LOAD_TIMEOUT_MS = 20_000
export const NEARBY_CUTBLOCK_ROAD_M = 1000

const SOURCE_LABELS = {
  'bc-consolidated': 'BC consolidated cutblocks',
  user: 'Imported harvest evidence',
  scenario: 'Synthetic teaching record',
} as const

/** A block's footprint and harvest evidence as label/value rows; rows with no value are left out. */
function evidenceRows(block: ContextFeature) {
  const e = block.harvestEvidence
  const mappedHa = block.geometry.type === 'Polygon' ? polygonAreaM2(block.geometry) / 10000 : null
  const recorded = e?.areaHectares
  const years =
    e?.startYear !== undefined && e.endYear !== undefined && e.startYear !== e.endYear
      ? `${e.startYear}–${e.endYear}`
      : e?.endYear !== undefined || e?.startYear !== undefined
        ? String(e.endYear ?? e.startYear)
        : e?.midYear !== undefined
          ? `≈ ${e.midYear} (midpoint)`
          : undefined
  const row = (key: string, label: string, value: ReactNode) => (value ? { key, label, value } : null)
  // Each date stays whole; a narrow column breaks only at the dash between them.
  const date = (value: string) => <span className="whitespace-nowrap">{value}</span>
  return [
    row('area', 'Area', mappedHa !== null && `${mappedHa.toFixed(2)} ha`),
    row(
      'recorded',
      'Recorded area',
      recorded !== undefined && mappedHa !== null && Math.abs(recorded - mappedHa) > 0.05 * recorded
        ? `${recorded.toFixed(2)} ha`
        : undefined,
    ),
    row('years', 'Harvested', years),
    row(
      'dates',
      'Dates',
      e?.startDate && (
        <>
          {date(e.startDate)}
          {e.endDate && <> – {date(e.endDate)}</>}
        </>
      ),
    ),
    row('source', 'Source', e && e.status !== 'proposed' && SOURCE_LABELS[e.source]),
    row('basis', 'Basis', e?.dataSource),
    row(
      'sourceDate',
      'Source dated',
      e?.sourceDate && `${e.sourceDate}${e.publishedDate ? ` · published ${e.publishedDate}` : ''}`,
    ),
    row('record', 'Record', e?.sourceId),
    row('opening', 'Opening ID', e?.openingId),
  ]
}

/** Harvest history stays separate from proposal geometry and from road condition evidence. */
export function CutblockHistoryPanel({
  workspace: w,
  onLocate,
  focusedId,
  reviewRequest,
  onDraw,
  onReviewRoad,
}: {
  workspace: RoadWorkspace
  onLocate?: (block: ContextFeature) => void
  focusedId?: string | null
  reviewRequest?: { id: string; sequence: number }
  onDraw?: () => void
  onReviewRoad?: (road: ContextFeature) => void
}) {
  const [selected, setSelected] = useState('')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState<'blocks' | 'roads' | null>(null)
  const [error, setError] = useState('')
  const [requestSeen, setRequestSeen] = useState(reviewRequest)
  if (reviewRequest !== requestSeen) {
    setRequestSeen(reviewRequest)
    if (reviewRequest) {
      setSelected(reviewRequest.id)
      setOpen(true)
    }
  }
  const latest = useRef(w)
  latest.current = w
  const projectKey = `${w.projectId ?? 'training'}|${w.project.name}|${w.project.terrain.name}`
  const keyRef = useRef(projectKey)
  keyRef.current = projectKey
  const abort = useRef<AbortController | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => () => abort.current?.abort(), [projectKey])
  useEffect(() => {
    if (reviewRequest) panel.current?.scrollIntoView?.({ block: 'start' })
  }, [reviewRequest])

  const year = w.project.harvestHistoryYear ?? new Date().getFullYear()
  const blocks = w.project.context.filter(
    (feature) => feature.kind === 'harvest' && feature.geometry.type === 'Polygon',
  )
  const block =
    blocks.find((feature) => feature.id === selected) ?? blocks.find((feature) => feature.id === focusedId) ?? blocks[0]
  const evidence = block?.harvestEvidence
  const planned = blocks.filter((feature) => feature.harvestEvidence?.status === 'proposed')
  const harvested = blocks.filter((feature) => feature.harvestEvidence?.status !== 'proposed')
  const group: 'planned' | 'harvested' = evidence?.status === 'proposed' ? 'planned' : 'harvested'
  const proximity = useMemo(() => {
    try {
      return {
        candidates: block
          ? nearbyRoadCandidates(block, w.project.context, { maxDistanceM: NEARBY_CUTBLOCK_ROAD_M })
          : [],
        error: '',
      }
    } catch (cause) {
      return {
        candidates: [],
        error: cause instanceof Error ? cause.message : 'Could not measure nearby road proximity.',
      }
    }
  }, [block, w.project.context])
  const candidates = proximity.candidates
  const historyStyle = harvestHistoryStyle(evidence, year)
  const busy = !!w.busy || !!loading

  const merge = (features: ContextFeature[], refreshHarvestRecords = false) => {
    latest.current.update((project) => {
      // A live source record contains its complete geometry. Drop obsolete parts if its
      // polygon count changed, while leaving records outside this query untouched.
      const refreshedRecords = new Set(
        refreshHarvestRecords
          ? features
              .filter((feature) => feature.harvestEvidence?.source === 'bc-consolidated')
              .map((feature) => feature.harvestEvidence?.sourceId)
              .filter((id): id is string => !!id)
          : [],
      )
      const context = new Map(
        project.context
          .filter(
            (feature) =>
              !(
                feature.kind === 'harvest' &&
                feature.harvestEvidence?.source === 'bc-consolidated' &&
                feature.harvestEvidence.sourceId &&
                refreshedRecords.has(feature.harvestEvidence.sourceId)
              ),
          )
          .map((feature) => [feature.id, feature]),
      )
      for (const feature of features)
        context.set(
          feature.id,
          feature.kind === 'existing-road' ? refreshExistingRoadFeature(feature, context.get(feature.id)) : feature,
        )
      return parseProject({
        ...project,
        context: [...context.values()],
        harvestHistoryYear: project.harvestHistoryYear ?? year,
      })
    })
  }
  const load = async (kind: 'blocks' | 'roads') => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    const key = projectKey
    const targetProject = latest.current.project
    setLoading(kind)
    setError('')
    const timeout = setTimeout(
      () => controller.abort(new Error('The BC context request timed out. Try a smaller area.')),
      HISTORY_LOAD_TIMEOUT_MS,
    )
    try {
      const blockParts = block?.harvestEvidence?.sourceId
        ? latest.current.project.context.filter(
            (feature) =>
              feature.kind === 'harvest' &&
              feature.harvestEvidence?.source === block.harvestEvidence?.source &&
              feature.harvestEvidence?.sourceId === block.harvestEvidence?.sourceId,
          )
        : block
          ? [block]
          : []
      const coordinates =
        kind === 'roads' && block?.geometry.type === 'Polygon'
          ? blockParts.flatMap((feature) =>
              feature.geometry.type === 'Polygon' ? (feature.geometry.coordinates.flat() as Coordinate[]) : [],
            )
          : latest.current.project.alignments.flatMap((alignment) => alignment.points.map((point) => point.coordinate))
      const bounds = existingRoadQueryBounds(coordinates)
      const features =
        kind === 'blocks'
          ? await loadBcHarvestHistory(bounds, controller.signal)
          : await loadBcExistingRoads(bounds, controller.signal)
      if (controller.signal.aborted || key !== keyRef.current) return
      if (targetProject !== latest.current.project) {
        setError('The project changed while context was loading. Load again for the current project.')
        return
      }
      merge(features, kind === 'blocks')
      if (kind === 'blocks' && features[0]) setSelected(features[0].id)
      latest.current.setNotice(
        kind === 'blocks'
          ? `${features.length} historical cutblock polygons loaded near the project roads. Harvest ages retain their source precision.`
          : `${features.length} mapped road sections loaded near the cutblock. Proximity does not establish a connected or usable access route.`,
      )
    } catch (cause) {
      if (key === keyRef.current && abort.current === controller)
        setError(
          controller.signal.reason instanceof Error
            ? controller.signal.reason.message
            : cause instanceof Error
              ? cause.message
              : 'Could not load BC context.',
        )
    } finally {
      clearTimeout(timeout)
      if (abort.current === controller) setLoading(null)
    }
  }

  return (
    <div ref={panel}>
      <RoadSection
        title="Cutblocks & harvest history"
        summary={`${planned.length} planned · ${harvested.length} harvested`}
        open={open}
        onOpenChange={setOpen}
        help="Load historical harvested areas near the project roads, or import cutblock polygons with their source evidence. Ages are elapsed calendar years since the reported harvest dates or estimated source year, not tree age. Nearby road sections are geographic candidates; their connection, surface, bridges, access and rehabilitation still need review."
      >
        <div className="space-y-3" data-testid="road-cutblock-history">
          {/* Planned blocks are the ones roads get built to; harvested ones are history to read. */}
          <div className="grid grid-cols-2 gap-1.5">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void load('blocks')}>
              {loading === 'blocks' ? 'Loading…' : 'Load BC cutblocks'}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
              Import cutblocks
            </Button>
            {onDraw && (
              <Button size="sm" variant="outline" className="col-span-2" disabled={busy} onClick={onDraw}>
                Draw planned block
              </Button>
            )}
          </div>
          <input
            ref={input}
            type="file"
            accept=".json,.geojson,application/geo+json,application/json"
            className="hidden"
            data-testid="road-cutblock-history-input"
            onChange={async (event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (!file) return
              setError('')
              const key = projectKey
              const targetProject = latest.current.project
              try {
                if (file.size > MAX_CUTBLOCK_IMPORT_BYTES) throw Error('Import at most 10 MB of cutblock GeoJSON.')
                const features = importHarvestHistory(JSON.parse(await file.text()))
                if (key !== keyRef.current || targetProject !== latest.current.project)
                  throw Error('The open project changed. Import into the intended project again.')
                merge(features)
                if (features[0]) setSelected(features[0].id)
                latest.current.setNotice(
                  `${features.length} cutblock polygons imported with available harvest evidence.`,
                )
              } catch (cause) {
                if (key === keyRef.current)
                  setError(cause instanceof Error ? cause.message : 'Could not import cutblocks.')
              }
            }}
          />
          {error && <InlineAlert tone="warning">{error}</InlineAlert>}
          {!blocks.length ? (
            <p className="text-2xs text-muted-foreground">
              Load historical cutblocks, import polygons, or draw a planned block.
            </p>
          ) : (
            <>
              <SegmentedControl
                size="sm"
                label="Cutblock group"
                value={group}
                onChange={(next) => {
                  const first = (next === 'planned' ? planned : harvested)[0]
                  if (first) setSelected(first.id)
                }}
                options={[
                  { value: 'planned', label: `Planned ${planned.length}`, disabled: !planned.length },
                  { value: 'harvested', label: `Harvested ${harvested.length}`, disabled: !harvested.length },
                ]}
              />
              {block && (
                <>
                  <div className="flex items-center gap-1">
                    <div className="min-w-0 flex-1">
                      <RoadSelect
                        ariaLabel="Cutblock history selection"
                        value={block.id}
                        onValueChange={setSelected}
                        options={(group === 'planned' ? planned : harvested).map((feature) => ({
                          value: feature.id,
                          label: feature.name,
                          title: harvestAgeSummary(feature.harvestEvidence, year),
                        }))}
                      />
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 shrink-0"
                      aria-label="Locate cutblock on plan"
                      title="Locate on plan"
                      disabled={!onLocate || busy}
                      onClick={() => onLocate?.(block)}
                    >
                      <LocateFixed className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 shrink-0"
                      aria-label="Remove selected cutblock"
                      title="Remove this block from the project"
                      disabled={busy}
                      onClick={() =>
                        w.update((project) => ({
                          ...project,
                          context: project.context.filter((feature) => feature.id !== block.id),
                        }))
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  <div
                    className="space-y-2 rounded-md border bg-muted/20 p-2.5 text-xs"
                    data-testid="road-cutblock-history-evidence"
                  >
                    <p className="flex items-start gap-1.5 font-medium">
                      <span
                        className="mt-0.5 size-3 shrink-0 rounded-sm border"
                        style={{ backgroundColor: historyStyle.color }}
                        aria-hidden="true"
                      />
                      {harvestAgeSummary(evidence, year)}
                    </p>
                    <KeyValueRows variant="grid" valueClassName="tabular-nums" rows={evidenceRows(block)} />
                    {/* Ages count to this year; it is saved with the project so a report reads the same later. */}
                    {group === 'harvested' && (
                      <div className="grid grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] items-center gap-x-3">
                        <span className="text-muted-foreground" aria-hidden="true">
                          Ages as of
                        </span>
                        <div className="w-20">
                          <NumberField
                            label="Harvest age reference year"
                            hideLabel
                            value={year}
                            min={1800}
                            max={2200}
                            step={1}
                            precision={0}
                            onChange={(value) =>
                              w.update((project) => ({ ...project, harvestHistoryYear: Math.round(value) }))
                            }
                          />
                        </div>
                      </div>
                    )}
                    {(evidence?.sourceUrl || evidence?.retrievedAt) && (
                      <p className="flex flex-wrap justify-between gap-x-2 text-2xs text-muted-foreground">
                        {evidence?.sourceUrl && (
                          <a href={evidence.sourceUrl} target="_blank" rel="noreferrer" className="underline">
                            Harvest source
                          </a>
                        )}
                        {evidence?.retrievedAt && <span>Retrieved {evidence.retrievedAt.slice(0, 10)}</span>}
                      </p>
                    )}
                    {group === 'planned' && (
                      <p className="text-2xs text-muted-foreground">Plan roads to it in Design → Block access.</p>
                    )}
                  </div>
                  {group === 'harvested' && (
                    // Roads near the block, nearest first. Each opens in Existing roads & reuse, which holds the
                    // road's evidence, history and reuse settings; this list adds only the distance.
                    <div className="space-y-2 border-t pt-3" data-testid="road-cutblock-nearby-roads">
                      <div className="flex items-center gap-1">
                        <p className="text-xs font-medium">Nearby roads</p>
                        <InfoTip label="About nearby roads">
                          Shortest horizontal separation from the cutblock footprint to mapped road linework, within 1
                          km. Proximity only: a line can still be unbuilt, closed or disconnected from the wider road
                          network, and it does not enter route search. Open one to review it in Existing roads & reuse.
                        </InfoTip>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-auto h-7 px-2 text-xs"
                          disabled={busy}
                          onClick={() => void load('roads')}
                        >
                          {loading === 'roads' ? 'Loading…' : 'Load roads near this block'}
                        </Button>
                      </div>
                      {proximity.error ? (
                        <InlineAlert tone="warning">{proximity.error}</InlineAlert>
                      ) : candidates.length ? (
                        <>
                          <p className="text-2xs text-muted-foreground">
                            {candidates.length} within 1 km · proximity only
                          </p>
                          <div className="max-h-48 overflow-y-auto overscroll-contain rounded-md border">
                            {candidates.map(({ road, distanceM }) => {
                              const style = roadHistoryStyle(road.roadEvidence)
                              return (
                                <ResultRow
                                  key={road.id}
                                  className="py-1.5"
                                  aria-label={`Review road ${road.name}`}
                                  disabled={!onReviewRoad || busy}
                                  leading={
                                    <span
                                      className="mt-2 block w-4 border-t-2 border-dashed"
                                      style={{ borderColor: style.color }}
                                      aria-hidden="true"
                                    />
                                  }
                                  title={road.name}
                                  subtitle={style.label}
                                  trailing={
                                    <span className="text-xs font-normal text-muted-foreground">
                                      {Math.round(distanceM)} m
                                    </span>
                                  }
                                  onClick={() => onReviewRoad?.(road)}
                                />
                              )
                            })}
                          </div>
                        </>
                      ) : (
                        <p className="text-2xs text-muted-foreground">
                          No loaded road line within 1 km. Load roads near this block, or import local linework in
                          Existing roads & reuse.
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </RoadSection>
    </div>
  )
}
