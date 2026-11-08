import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert } from '@/components/ui/map-panels'
import { Field, NumberField, RoadSelect } from './Controls'
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
import { roadDeactivationSummary, roadHistoryStyle } from './roadHistory'
import { parseProject } from './project'
import type { ContextFeature, Coordinate } from './types'
import type { RoadWorkspace } from './useRoadWorkspace'

export const MAX_CUTBLOCK_IMPORT_BYTES = 10 * 1024 * 1024
export const HISTORY_LOAD_TIMEOUT_MS = 20_000
export const NEARBY_CUTBLOCK_ROAD_M = 1000

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
  const [selectedRoad, setSelectedRoad] = useState('')
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
  const candidate = candidates.find((item) => item.road.id === selectedRoad) ?? candidates[0]
  const historyStyle = harvestHistoryStyle(evidence, year)
  const roadStyle = roadHistoryStyle(candidate?.road.roadEvidence)
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
        summary={`${blocks.length} polygons`}
        open={open}
        onOpenChange={setOpen}
        help="Load historical harvested areas near the project roads, or import cutblock polygons with their source evidence. Ages are elapsed calendar years since the reported harvest dates or estimated source year, not tree age. Nearby road sections are geographic candidates; their connection, surface, bridges, access and rehabilitation still need review."
      >
        <div className="space-y-2" data-testid="road-cutblock-history">
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void load('blocks')}>
              {loading === 'blocks' ? 'Loading cutblocks…' : 'Load BC cutblocks'}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
              Import cutblocks
            </Button>
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
          <NumberField
            label="Harvest age reference year"
            value={year}
            min={1800}
            max={2200}
            step={1}
            onChange={(value) => w.update((project) => ({ ...project, harvestHistoryYear: Math.round(value) }))}
          />
          {!block && (
            <p className="text-2xs text-muted-foreground">
              Load historical cutblocks, import polygons, or draw a proposed block.
            </p>
          )}
          {block && (
            <>
              <Field label="Cutblock history selection">
                <RoadSelect
                  ariaLabel="Cutblock history selection"
                  value={block.id}
                  onValueChange={setSelected}
                  options={blocks.map((feature) => ({
                    value: feature.id,
                    label: `${feature.name} · ${harvestAgeSummary(feature.harvestEvidence, year)}`,
                  }))}
                />
              </Field>
              <div
                className="space-y-1 rounded border bg-muted/20 p-2 text-2xs"
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
                <p>Reference year: {year}</p>
                {evidence?.startYear !== undefined && <p>Harvest start year: {evidence.startYear}</p>}
                {evidence?.endYear !== undefined && <p>Harvest end year: {evidence.endYear}</p>}
                {evidence?.startDate && <p>Source start date: {evidence.startDate}</p>}
                {evidence?.endDate && <p>Source end date: {evidence.endDate}</p>}
                {evidence?.midYear !== undefined && <p>Source midpoint year: {evidence.midYear}</p>}
                <p>
                  {evidence?.source === 'scenario'
                    ? 'Synthetic teaching record'
                    : evidence?.source === 'bc-consolidated'
                      ? 'BC consolidated cutblock record'
                      : evidence
                        ? 'Imported harvest evidence'
                        : 'No harvest history supplied'}
                </p>
                {evidence?.dataSource && <p>Contributing source: {evidence.dataSource}</p>}
                {evidence?.sourceDate && <p>Source date: {evidence.sourceDate}</p>}
                {evidence?.publishedDate && <p>Source published: {evidence.publishedDate}</p>}
                {evidence?.sourceId && <p className="break-all">Source record: {evidence.sourceId}</p>}
                {evidence?.openingId && <p className="break-all">Opening ID: {evidence.openingId}</p>}
                {evidence?.sourceUrl && (
                  <a href={evidence.sourceUrl} target="_blank" rel="noreferrer" className="inline-block underline">
                    Harvest source
                  </a>
                )}
                {evidence?.retrievedAt && <p>Retrieved: {evidence.retrievedAt.slice(0, 10)}</p>}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                disabled={!onLocate || busy}
                onClick={() => onLocate?.(block)}
              >
                Locate cutblock on plan
              </Button>
              <div className="space-y-2 border-t pt-2" data-testid="road-cutblock-nearby-roads">
                <div className="flex items-center justify-between gap-1">
                  <p className="text-xs font-medium">Nearby road candidates</p>
                  <InfoTip label="About nearby roads">
                    Shortest horizontal separation from the cutblock footprint to mapped road linework, within 1 km. An
                    intersecting line can still be unbuilt, closed or disconnected from the wider road network. These
                    candidates do not automatically enter route search.
                  </InfoTip>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  disabled={busy}
                  onClick={() => void load('roads')}
                >
                  {loading === 'roads' ? 'Loading nearby roads…' : 'Load roads near this cutblock'}
                </Button>
                <p className="text-2xs text-muted-foreground">
                  {proximity.error
                    ? 'Candidate count unavailable'
                    : `${candidates.length} loaded candidates within 1 km · proximity only`}
                </p>
                {proximity.error && <InlineAlert tone="warning">{proximity.error}</InlineAlert>}
                {candidate && (
                  <>
                    <RoadSelect
                      ariaLabel="Nearby road candidate"
                      value={candidate.road.id}
                      onValueChange={setSelectedRoad}
                      options={candidates.map((item) => ({
                        value: item.road.id,
                        label: `${Math.round(item.distanceM)} m · ${item.road.name}`,
                      }))}
                    />
                    <div className="space-y-1 rounded border p-2 text-2xs">
                      <p className="flex gap-1.5">
                        <span
                          className="mt-1 w-5 shrink-0 border-t-2 border-dashed"
                          style={{ borderColor: roadStyle.color }}
                          aria-hidden="true"
                        />
                        {roadStyle.label}
                      </p>
                      <p>{roadDeactivationSummary(candidate.road.roadEvidence?.deactivation)}</p>
                      {candidate.road.roadEvidence?.retirementDate && (
                        <p>Tenure retired: {candidate.road.roadEvidence.retirementDate}</p>
                      )}
                      <p>{Math.round(candidate.distanceM)} m from mapped cutblock footprint</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      disabled={!onReviewRoad || busy}
                      onClick={() => onReviewRoad?.(candidate.road)}
                    >
                      Review selected road
                    </Button>
                  </>
                )}
                {!candidate && !proximity.error && (
                  <p className="text-2xs text-muted-foreground">
                    No loaded road line falls within 1 km. Load roads for this block or import local linework in
                    Existing roads & reuse.
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  w.update((project) => ({
                    ...project,
                    context: project.context.filter((feature) => feature.id !== block.id),
                  }))
                }
              >
                Remove selected cutblock
              </Button>
            </>
          )}
          {onDraw && (
            <Button size="sm" variant="outline" className="w-full" disabled={busy} onClick={onDraw}>
              Draw proposed cutblock
            </Button>
          )}
        </div>
      </RoadSection>
    </div>
  )
}
