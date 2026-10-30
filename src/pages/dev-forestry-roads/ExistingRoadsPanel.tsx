import { NativeSelect } from '@/components/ui/form-field'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/map-panels'
import { Field, OptionalNumberField, roadFieldClass } from './Controls'
import { RoadSection } from './SidebarParts'
import { parseProject } from './project'
import { refreshExistingRoadFeature, unreviewedRoadEvidence } from './existingRoadEvidence'
import {
  BC_ROADS_CATALOGUE,
  BC_ROADS_SERVICE,
  existingRoadQueryBounds,
  importExistingRoads,
  loadBcExistingRoads,
  MAX_ROAD_RESPONSE_BYTES,
  type RoadQueryBounds,
} from './existingRoads'
import type { ContextFeature, ExistingRoadEvidence } from './types'
import type { RoadWorkspace } from './useRoadWorkspace'
import { RoadConditionEditor } from './RoadConditionEditor'
import { createRoadConditionPolicy } from './roadCondition'
import { createTotalCostPlanningDefaults } from './fullCostPlanning'
import { RoadNetworkEditor } from './RoadNetworkEditor'

export function ExistingRoadsPanel({
  workspace: w,
  bounds,
  onLocateRoad,
  onReviewRoad,
  initialSelectedRoadId,
}: {
  workspace: RoadWorkspace
  bounds?: RoadQueryBounds
  initialSelectedRoadId?: string
  /** Highlight and fit this section when the reviewer explicitly asks to locate it. */
  onLocateRoad?: (road: ContextFeature) => void
  /** Update the review highlight without moving the camera; null clears it on unmount. */
  onReviewRoad?: (road: ContextFeature | null) => void
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
    if (next.condition === 'closed' || next.geometryReviewRequired) next.reuseAllowed = false
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
  const load = async (fsrOnly = false) => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setError('')
    setLoading(true)
    try {
      const extent =
        bounds ?? existingRoadQueryBounds(w.project.alignments.flatMap((a) => a.points.map((p) => p.coordinate)))
      const features = await loadBcExistingRoads(extent, controller.signal, { fsrOnly, activeOnly: fsrOnly })
      if (controller.signal.aborted || projectKey !== latestProjectKey.current) return
      merge(features)
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
      help="Load BC Forest Tenure road sections near the project, or import your own GeoJSON road network. A tenure can represent an unbuilt road. Permit status and award/retirement dates cannot establish road age or current condition. Review access, structures and rehabilitation before enabling a road for the optimizer."
    >
      <div className="space-y-2" data-testid="road-existing-roads">
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" variant="outline" disabled={loading || !!w.busy} onClick={() => void load(false)}>
            {loading ? 'Loading roads…' : 'Load BC roads'}
          </Button>
          <Button size="sm" variant="outline" disabled={loading || !!w.busy} onClick={() => input.current?.click()}>
            Import road GeoJSON
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
        <p className="text-[11px] text-muted-foreground">
          Province-wide FSR records are available through the BC catalogue. This loads active FSR sections for the
          current area; Find a route can search for the nearest mapped FSR.
        </p>
        <input
          ref={input}
          type="file"
          accept=".json,.geojson,application/geo+json,application/json"
          className="hidden"
          data-testid="road-existing-roads-input"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (!file) return
            setError('')
            try {
              if (file.size > MAX_ROAD_RESPONSE_BYTES)
                throw Error('Import at most 10 MB of road GeoJSON; split larger networks.')
              const features = importExistingRoads(JSON.parse(await file.text())).map((f) => ({
                ...f,
                id: crypto.randomUUID(),
              }))
              if (projectKey !== latestProjectKey.current)
                throw Error('The open project changed during import. Import the roads again in the intended project.')
              merge(features)
              latest.current.setNotice(`Imported ${features.length} existing-road lines for review.`)
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Could not import road linework.')
            }
          }}
        />
        {error && <InlineAlert tone="warning">{error}</InlineAlert>}
        <p className="text-[11px] text-muted-foreground">
          {roads.length} road lines ·{' '}
          {roads.filter((f) => f.roadEvidence?.reuseAllowed && f.roadEvidence.condition !== 'closed').length} enabled
          for route reuse.{' '}
          <a className="underline" href={BC_ROADS_CATALOGUE} target="_blank" rel="noreferrer">
            BC source
          </a>
        </p>
        {road && (
          <>
            <Field label="Review existing road">
              <NativeSelect className={roadFieldClass} value={road.id} onChange={(e) => setSelected(e.target.value)}>
                {roads.map((f) => (
                  <option key={f.id} value={f.id}>
                    {sectionLabel(f)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {onLocateRoad && (
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                disabled={!!w.busy}
                onClick={() => onLocateRoad(road)}
              >
                Locate selected road on plan
              </Button>
            )}
            <div
              className="rounded border bg-muted/20 px-2 py-1.5 text-[11px] text-muted-foreground"
              data-testid="road-existing-road-evidence"
            >
              <p>
                {recordUrl ? (
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
                )}
                {evidence.roadClass === 'fsr'
                  ? ' · Forest Service Road'
                  : evidence.roadClass === 'permit'
                    ? ' · Road permit'
                    : ''}
                {evidence.status ? ` · ${evidence.status}` : ''}
              </p>
              <p className="break-all">
                {evidence.sourceId ? `Source record: ${evidence.sourceId} · ` : ''}Section reference: {road.id}
              </p>
              {evidence.retrievedAt && <p>Record retrieved: {new Date(evidence.retrievedAt).toLocaleString()}</p>}
              {evidence.awardDate && <p>Tenure awarded: {evidence.awardDate}</p>}
              {evidence.retirementDate && <p>Tenure retired: {evidence.retirementDate}</p>}
              <p>
                Construction year: {evidence.constructionYear ?? 'unknown'}. Record dates do not establish road age.
                Current condition requires review.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {evidence.source !== 'bc-ften' && (
                <Field label="User road network class">
                  <NativeSelect
                    className={roadFieldClass}
                    value={evidence.roadClass ?? 'user'}
                    onChange={(e) => change({ roadClass: e.target.value as ExistingRoadEvidence['roadClass'] })}
                  >
                    <option value="user">Other / unknown</option>
                    <option value="fsr">FSR (user identified)</option>
                    <option value="permit">Permit road</option>
                  </NativeSelect>
                </Field>
              )}
              <Field label="Planning condition">
                <NativeSelect
                  className={roadFieldClass}
                  value={evidence.condition}
                  onChange={(e) => change({ condition: e.target.value as ExistingRoadEvidence['condition'] })}
                >
                  <option value="unknown">Unknown</option>
                  <option value="serviceable">Serviceable</option>
                  <option value="rehabilitation">Needs rehabilitation</option>
                  <option value="closed">Closed / unavailable</option>
                </NativeSelect>
              </Field>
              <Field label="Condition evidence">
                <NativeSelect
                  className={roadFieldClass}
                  value={evidence.conditionBasis}
                  onChange={(e) => change({ conditionBasis: e.target.value as ExistingRoadEvidence['conditionBasis'] })}
                >
                  <option value="unreviewed">Unreviewed</option>
                  <option value="assumed">Planning assumption</option>
                  <option value="field-verified">Field verified by user</option>
                </NativeSelect>
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
                <p className="text-[11px] text-muted-foreground">
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
                disabled={evidence.condition === 'closed' || evidence.geometryReviewRequired}
                onChange={(e) => change({ reuseAllowed: e.target.checked })}
              />
              <span>Allow this road in the reuse cost scenario</span>
            </label>
            {evidence.reuseAllowed && evidence.conditionBasis !== 'field-verified' && (
              <p className="text-[11px] text-amber-700 dark:text-amber-300">
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
