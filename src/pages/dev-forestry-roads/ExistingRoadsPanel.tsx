import { useEffect, useRef, useState } from 'react'
import { LocateFixed } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert, KeyValueRows } from '@/components/ui/map-panels'
import { Field, OptionalNumberField, roadFieldClass, RoadSelect } from './Controls'
import { RoadSection } from './SidebarParts'
import { parseProject } from './project'
import { refreshExistingRoadFeature, unreviewedRoadEvidence } from './existingRoadEvidence'
import {
  BC_ROADS_CATALOGUE,
  BC_ROADS_SERVICE,
  existingRoadQueryBounds,
  loadBcExistingRoads,
  type RoadQueryBounds,
} from './existingRoads'
import type { ContextFeature, ExistingRoadEvidence } from './types'
import type { RoadWorkspace } from './useRoadWorkspace'
import { SPATIAL_ACCEPT } from './spatialImport'
import { RoadConditionEditor } from './RoadConditionEditor'
import { createRoadConditionPolicy } from './roadCondition'
import { createTotalCostPlanningDefaults } from './fullCostPlanning'
import { RoadNetworkEditor } from './RoadNetworkEditor'
import { RoadBatchFinder } from './RoadBatchFinder'
import { roadFindingTerrainProblem } from './roadLikeness'
import { RoadDeactivationEditor } from './RoadDeactivationEditor'
import {
  deactivatedRoadNeedsReview,
  PRINCE_GEORGE_ROAD_MAP_URL,
  PRINCE_GEORGE_ROAD_NOTICES_URL,
  roadDeactivationSummary,
  roadHistoryStyle,
} from './roadHistory'
import { DEFAULT_LOCALE } from '@/lib/format'

/** The next search after a road's own surroundings come back empty. */
const WIDE_SEARCH_KM = 10

export function ExistingRoadsPanel({
  workspace: w,
  bounds,
  onLocateRoad,
  onReviewRoad,
  initialSelectedRoadId,
  open,
  onOpenChange,
  onImportFile,
  onPreviewFoundRoads,
}: {
  workspace: RoadWorkspace
  /** Shows the roads found together on the terrain over the plan; null clears it. */
  onPreviewFoundRoads?: (overlay: GeoJSON.FeatureCollection | null) => void
  bounds?: RoadQueryBounds
  initialSelectedRoadId?: string
  /** Reads a chosen spatial file as existing roads; the workspace's one importer does the reading. */
  onImportFile?: (file: File) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Highlight and fit this section when the reviewer explicitly asks to locate it. */
  onLocateRoad?: (road: ContextFeature) => void
  /**
   * Update the review highlight without moving the camera; null clears it on unmount. `picked` is set
   * when the reviewer chose the road, which highlights it even before anything has been located.
   */
  onReviewRoad?: (road: ContextFeature | null, picked?: boolean) => void
}) {
  const [selected, setSelected] = useState(initialSelectedRoadId ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const abort = useRef<AbortController | null>(null)
  const latest = useRef(w)
  latest.current = w
  const projectKey = `${w.projectId ?? 'training'}|${w.project.name}|${w.project.terrain.name}`
  const latestProjectKey = useRef(projectKey)
  latestProjectKey.current = projectKey
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => () => abort.current?.abort(), [projectKey])
  const roads = w.project.context.filter((f) => f.kind === 'existing-road')
  const road = roads.find((f) => f.id === selected) ?? roads[0]
  const evidence = road?.roadEvidence ?? unreviewedRoadEvidence()
  const historyStyle = roadHistoryStyle(evidence)
  const reviewCallback = useRef(onReviewRoad)
  reviewCallback.current = onReviewRoad
  useEffect(() => {
    reviewCallback.current?.(road ?? null)
  }, [road])
  useEffect(() => () => reviewCallback.current?.(null), [])
  const sectionLabel = (feature: ContextFeature) => {
    const sourceId = feature.roadEvidence?.sourceId
    if (!sourceId) return `Section ${roads.findIndex((f) => f.id === feature.id) + 1} · ${feature.name}`
    const parts = roads.filter((f) => f.roadEvidence?.sourceId === sourceId)
    return `Record ${sourceId}${parts.length > 1 ? ` · part ${parts.findIndex((f) => f.id === feature.id) + 1}` : ''} · ${feature.name}`
  }
  const recordUrl =
    evidence.source === 'bc-ften' && evidence.sourceId && /^\d+$/.test(evidence.sourceId)
      ? `${BC_ROADS_SERVICE}/query?${new URLSearchParams({ objectIds: evidence.sourceId, outFields: '*', returnGeometry: 'false', f: 'pjson' })}`
      : evidence.sourceUrl
  const sourceLabel =
    evidence.source === 'bc-ften'
      ? 'BC Forest Tenure record'
      : evidence.source === 'scenario'
        ? 'Scenario assumption'
        : 'User linework'
  const change = (patch: Partial<ExistingRoadEvidence>) => {
    if (!road) return
    const next = { ...evidence, ...patch }
    if (next.condition === 'closed' || next.geometryReviewRequired || deactivatedRoadNeedsReview(next))
      next.reuseAllowed = false
    w.update((p) => ({ ...p, context: p.context.map((f) => (f.id === road.id ? { ...f, roadEvidence: next } : f)) }))
  }
  const merge = (features: ContextFeature[]) => {
    // Stable catalogue IDs replace their own geometry only; retain the user's review assumptions.
    latest.current.update((p) => {
      const context = [...p.context]
      for (const feature of features) {
        const index = context.findIndex((f) => f.id === feature.id)
        if (index < 0) context.push(feature)
        else context[index] = refreshExistingRoadFeature(feature, context[index])
      }
      return parseProject({ ...p, context })
    })
    if (features[0]) setSelected(features[0].id)
  }
  const [emptySearch, setEmptySearch] = useState<{ fsrOnly: boolean; paddingKm: number } | null>(null)
  const load = async (fsrOnly = false, paddingKm = 1) => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setError('')
    setEmptySearch(null)
    setLoading(true)
    try {
      const extent =
        paddingKm === 1 && bounds
          ? bounds
          : existingRoadQueryBounds(
              w.project.alignments.flatMap((a) => a.points.map((p) => p.coordinate)),
              paddingKm,
            )
      const features = await loadBcExistingRoads(extent, controller.signal, { fsrOnly, activeOnly: fsrOnly })
      if (controller.signal.aborted || projectKey !== latestProjectKey.current) return
      merge(features)
      setEmptySearch(features.length ? null : { fsrOnly, paddingKm })
      latest.current.setNotice(
        `${features.length} ${fsrOnly ? 'active BC FSR section' : 'BC tenure road line'}${features.length === 1 ? '' : 's'} loaded for review. Enable individual roads before using route reuse.`,
      )
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load BC roads.')
    } finally {
      if (abort.current === controller) setLoading(false)
    }
  }
  return (
    <RoadSection
      title="Existing roads & reuse"
      summary={`${roads.length} · ${roads.filter((f) => f.roadEvidence?.reuseAllowed && f.roadEvidence.condition !== 'closed').length} reusable`}
      open={open}
      onOpenChange={onOpenChange}
      help={
        <>
          <p>
            Load BC Forest Tenure road sections near the project, or import your own road network as GeoJSON, a zipped
            shapefile, KML or KMZ. The FSR button loads active Forest Service Road tenures for the current area. A
            tenure can represent an unbuilt road. Permit status and award/retirement dates do not establish construction
            age, physical deactivation or current condition. Review access, structures and rehabilitation before
            enabling reuse.
          </p>
          <p className="mt-2">
            Check{' '}
            <a className="underline" href={PRINCE_GEORGE_ROAD_NOTICES_URL} target="_blank" rel="noreferrer">
              Prince George district notices
            </a>{' '}
            or the{' '}
            <a className="underline" href={PRINCE_GEORGE_ROAD_MAP_URL} target="_blank" rel="noreferrer">
              official district road map
            </a>
            . A notice's reported date may differ from the date deactivation was completed. Check the road number,
            kilometre range and completed versus planned work before entering physical history for a road section.
          </p>
        </>
      }
    >
      <div className="space-y-2" data-testid="road-existing-roads">
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" variant="outline" disabled={loading || !!w.busy} onClick={() => void load(false)}>
            {loading ? 'Loading roads…' : 'Load BC roads'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={loading || !!w.busy || !onImportFile}
            onClick={() => input.current?.click()}
          >
            Import existing roads
          </Button>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          disabled={loading || !!w.busy}
          onClick={() => void load(true)}
        >
          Load BC FSRs in this area
        </Button>
        <input
          ref={input}
          type="file"
          accept={SPATIAL_ACCEPT}
          className="hidden"
          data-testid="road-existing-roads-input"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (!file) return
            setError('')
            onImportFile?.(file)
          }}
        />
        {error && <InlineAlert tone="warning">{error}</InlineAlert>}
        {emptySearch && (
          <div className="flex items-center gap-2 text-2xs" role="status">
            <span className="min-w-0 flex-1 text-muted-foreground">
              No BC {emptySearch.fsrOnly ? 'FSRs' : 'roads'} within {emptySearch.paddingKm === 1 ? '' : 'about '}
              {emptySearch.paddingKm} km of your roads.
            </span>
            {emptySearch.paddingKm < WIDE_SEARCH_KM && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 shrink-0 text-xs"
                disabled={loading || !!w.busy}
                onClick={() => void load(emptySearch.fsrOnly, WIDE_SEARCH_KM)}
              >
                Search wider
              </Button>
            )}
          </div>
        )}
        <p className="text-2xs text-muted-foreground">
          {roads.length} road lines ·{' '}
          {roads.filter((f) => f.roadEvidence?.reuseAllowed && f.roadEvidence.condition !== 'closed').length} enabled
          for route reuse.{' '}
          <a className="underline" href={BC_ROADS_CATALOGUE} target="_blank" rel="noreferrer">
            BC source
          </a>
        </p>
        {/* The batch finder only runs on terrain fine enough to show a road bench; on coarser terrain it is hidden. */}
        {roads.length > 0 && !roadFindingTerrainProblem(w.project.terrain.resolutionM) && (
          <RoadBatchFinder workspace={w} onPreview={onPreviewFoundRoads} />
        )}
        {road && (
          <>
            {/* Picking a road highlights it on the plan; the locate button also brings the plan to it. */}
            <div className="flex items-end gap-1">
              <div className="min-w-0 flex-1">
                <Field label="Review existing road">
                  <RoadSelect
                    ariaLabel="Review existing road"
                    className={roadFieldClass}
                    value={road.id}
                    onValueChange={(value) => {
                      setSelected(value)
                      const picked = roads.find((f) => f.id === value)
                      if (picked) reviewCallback.current?.(picked, true)
                    }}
                  >
                    {roads.map((f) => (
                      <option key={f.id} value={f.id}>
                        {sectionLabel(f)}
                      </option>
                    ))}
                  </RoadSelect>
                </Field>
              </div>
              {onLocateRoad && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 shrink-0"
                  aria-label="Locate selected road on plan"
                  title="Locate on plan"
                  disabled={!!w.busy}
                  onClick={() => onLocateRoad(road)}
                >
                  <LocateFixed className="size-4" />
                </Button>
              )}
            </div>
            {/* The record as label/value rows under its condition; the caveat about dates sits behind (i). */}
            <div
              className="space-y-2 rounded-md border bg-muted/20 p-2.5 text-xs"
              data-testid="road-existing-road-evidence"
            >
              <p className="flex items-center gap-1.5 font-medium">
                <span
                  aria-hidden="true"
                  className="inline-block w-5 shrink-0 border-t-2"
                  style={{
                    borderColor: historyStyle.color,
                    borderStyle: historyStyle.key === 'serviceable' ? 'solid' : 'dashed',
                  }}
                />
                <span className="min-w-0 flex-1">{historyStyle.label}</span>
                <InfoTip label="About this road record">
                  Record and tenure dates do not establish a road's age or present condition; that needs review. Section
                  reference {road.id}.
                </InfoTip>
              </p>
              <KeyValueRows
                variant="grid"
                valueClassName="tabular-nums"
                rows={[
                  {
                    key: 'source',
                    label: 'Source',
                    value: recordUrl ? (
                      <a
                        className="underline"
                        href={recordUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`View source record for ${road.name}`}
                      >
                        {sourceLabel}
                      </a>
                    ) : (
                      sourceLabel
                    ),
                  },
                  evidence.roadClass === 'fsr' || evidence.roadClass === 'permit'
                    ? {
                        key: 'class',
                        label: 'Type',
                        value: evidence.roadClass === 'fsr' ? 'Forest Service Road' : 'Road permit',
                      }
                    : null,
                  evidence.status ? { key: 'status', label: 'Tenure status', value: evidence.status } : null,
                  evidence.sourceId ? { key: 'record', label: 'Record', value: evidence.sourceId } : null,
                  {
                    key: 'history',
                    label: 'Road history',
                    value: (
                      <span data-testid="road-deactivation-summary">
                        {roadDeactivationSummary(evidence.deactivation)}
                        {evidence.deactivation?.status === 'reactivated' && evidence.deactivation.deactivatedOn
                          ? ` · Previously deactivated: ${evidence.deactivation.deactivatedOn}`
                          : ''}
                      </span>
                    ),
                  },
                  evidence.deactivation?.reference
                    ? {
                        key: 'event',
                        label:
                          evidence.deactivation.basis === 'scenario'
                            ? 'Scenario assumption'
                            : evidence.deactivation.basis === 'field-observation'
                              ? 'Field note'
                              : 'Event source',
                        value: evidence.deactivation.sourceUrl ? (
                          <a
                            className="underline"
                            href={evidence.deactivation.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {evidence.deactivation.reference}
                          </a>
                        ) : (
                          evidence.deactivation.reference
                        ),
                      }
                    : null,
                  evidence.deactivation?.observedOn
                    ? { key: 'observed', label: 'Event status observed', value: evidence.deactivation.observedOn }
                    : null,
                  evidence.awardDate ? { key: 'awarded', label: 'Tenure awarded', value: evidence.awardDate } : null,
                  evidence.retirementDate
                    ? { key: 'retired', label: 'Tenure retired', value: evidence.retirementDate }
                    : null,
                  {
                    key: 'built',
                    label: 'Construction year',
                    value: evidence.constructionYear ? String(evidence.constructionYear) : 'unknown',
                  },
                  evidence.retrievedAt
                    ? {
                        key: 'retrieved',
                        label: 'Retrieved',
                        value: new Date(evidence.retrievedAt).toLocaleDateString(DEFAULT_LOCALE),
                      }
                    : null,
                ]}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {evidence.source !== 'bc-ften' && (
                <Field label="User road network class">
                  <RoadSelect
                    ariaLabel="User road network class"
                    className={roadFieldClass}
                    value={evidence.roadClass ?? 'user'}
                    onValueChange={(value) => change({ roadClass: value as ExistingRoadEvidence['roadClass'] })}
                  >
                    <option value="user">Other / unknown</option>
                    <option value="fsr">FSR (user identified)</option>
                    <option value="permit">Permit road</option>
                  </RoadSelect>
                </Field>
              )}
              <Field label="Planning condition">
                <RoadSelect
                  ariaLabel="Planning condition"
                  className={roadFieldClass}
                  value={evidence.condition}
                  onValueChange={(value) => change({ condition: value as ExistingRoadEvidence['condition'] })}
                >
                  <option value="unknown">Unknown</option>
                  <option value="serviceable">Serviceable</option>
                  <option value="rehabilitation">Needs rehabilitation</option>
                  <option value="closed">Closed / unavailable</option>
                </RoadSelect>
              </Field>
              <Field label="Condition evidence">
                <RoadSelect
                  ariaLabel="Condition evidence"
                  className={roadFieldClass}
                  value={evidence.conditionBasis}
                  onValueChange={(value) => change({ conditionBasis: value as ExistingRoadEvidence['conditionBasis'] })}
                >
                  <option value="unreviewed">Unreviewed</option>
                  <option value="assumed">Planning assumption</option>
                  <option value="field-verified">Field verified by user</option>
                </RoadSelect>
              </Field>
            </div>
            <OptionalNumberField
              label="Known construction year (leave blank if unknown)"
              value={evidence.constructionYear ?? null}
              min={1800}
              max={2200}
              step={1}
              placeholder="unknown"
              onChange={(year) => change({ constructionYear: year === null ? undefined : Math.round(year) })}
            />
            <RoadDeactivationEditor
              key={`history:${projectKey}:${road.id}`}
              value={evidence.deactivation}
              disabled={!!w.busy}
              onChange={(deactivation) => change({ deactivation, reuseAllowed: false })}
            />
            {evidence.deactivation?.status === 'deactivated' && (
              <p className="text-2xs text-muted-foreground" data-testid="road-deactivation-reuse-guidance">
                To compare reopening, choose Needs rehabilitation and record a condition basis, then enable reuse. The
                red map line retains the recorded deactivation; the cost scenario is a rehabilitation assumption.
              </p>
            )}
            {evidence.geometryReviewRequired && (
              <div className="space-y-2" data-testid="road-geometry-scope-review">
                <InlineAlert tone="warning">
                  The refreshed road geometry changed. Previous condition observations, restrictions and prices are
                  retained as history, but their scope has not been confirmed for this updated section. Road reuse stays
                  disabled until you review the new line and retained evidence.
                </InlineAlert>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-auto w-full whitespace-normal"
                  onClick={() => change({ geometryReviewRequired: false, reuseAllowed: false })}
                >
                  Confirm evidence scope for updated geometry
                </Button>
                <p className="text-2xs text-muted-foreground">
                  Confirm only when the retained observations and network restrictions cover this section, including its
                  direction and structures. Replace evidence where needed, then explicitly enable reuse.
                </p>
              </div>
            )}
            <label className="flex items-start gap-2 text-xs">
              <input
                className="mt-0.5"
                type="checkbox"
                checked={evidence.reuseAllowed}
                disabled={
                  evidence.condition === 'closed' ||
                  evidence.geometryReviewRequired ||
                  deactivatedRoadNeedsReview({ ...evidence, reuseAllowed: true })
                }
                onChange={(e) => change({ reuseAllowed: e.target.checked })}
              />
              <span>Allow this road in the reuse cost scenario</span>
            </label>
            {evidence.reuseAllowed && evidence.conditionBasis !== 'field-verified' && (
              <p className="text-2xs text-warning">
                Reuse is an unverified planning assumption. Rehabilitation, bridge capacity and legal access are not
                established.
              </p>
            )}
            <RoadNetworkEditor
              key={`network:${projectKey}:${road.id}`}
              value={evidence.network}
              coordinates={road.geometry.type === 'LineString' ? (road.geometry.coordinates as [number, number][]) : []}
              onChange={(network) => change({ network })}
            />
            <RoadConditionEditor
              key={`condition:${projectKey}:${road.id}`}
              roadName={road.name}
              observations={evidence.observations ?? []}
              policy={evidence.conditionPolicy ?? createRoadConditionPolicy()}
              asOf={w.project.totalCostPlanning?.asOf ?? createTotalCostPlanningDefaults().asOf}
              onChangeObservations={(observations) => change({ observations })}
              onChangePolicy={(conditionPolicy) => change({ conditionPolicy })}
              onChangeAsOf={(asOf) =>
                w.update((p) => {
                  const planning = p.totalCostPlanning ?? createTotalCostPlanningDefaults(asOf)
                  return {
                    ...p,
                    totalCostPlanning: { ...planning, asOf, networkPolicy: { ...planning.networkPolicy, asOf } },
                  }
                })
              }
              onUseEstimate={(assessment) =>
                change({
                  condition: assessment.condition,
                  conditionBasis: 'assumed',
                  ...(assessment.condition === 'closed' ? { reuseAllowed: false } : {}),
                })
              }
              disabled={!!w.busy}
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => w.update((p) => ({ ...p, context: p.context.filter((f) => f.id !== road.id) }))}
            >
              Remove selected road
            </Button>
          </>
        )}
      </div>
    </RoadSection>
  )
}
