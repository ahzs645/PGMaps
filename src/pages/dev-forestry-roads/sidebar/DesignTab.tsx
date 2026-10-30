import { NativeSelect } from '@/components/ui/form-field'
import { useEffect, useState } from 'react'
import { Copy, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { CollapsibleSection, InlineAlert } from '@/components/ui/map-panels'
import { Field, NumberField, OptionalNumberField, roadFieldClass } from '../Controls'
import { formatRoadStation } from '../Charts'
import { CurveTools } from '../CurveTools'
import { VerticalDesignControls } from '../VerticalDesignControls'
import { distance } from '../engine'
import { DEFAULT_ROUTE_OPTIONS, type RouteSearchOptions } from '../routing'
import type { RoadOptimizationObjective } from '../corridorOptimizer'
import { FsrConnectionControls } from '../FsrConnectionControls'
import { FullCostRecordSummary } from '../FullCostRecordSummary'
import { RoadSection, SectionReachAlert } from '../SidebarParts'
import type { SidebarProps } from '../DesignSidebarBody'

const id = () => crypto.randomUUID()
const MAX_ALIGNMENTS = 20

export function DesignTab(p: SidebarProps) {
  const { project, alignment, updateAlignment } = p.workspace
  const full = project.alignments.length >= MAX_ALIGNMENTS
  return (
    <>
      <RoadSection
        title="Road"
        help={
          <>
            <b>Peg road:</b> click the start, optional middle points, then the end and Finish road.
            <br />
            <b>Edit points:</b> drag any numbered control; click + between controls to add a middle point.
            <br />
            <b>Inspect</b> returns to station selection. Profile, sections and quantities update when you release a
            drag.
            <br />
            To compare paths, Duplicate road and move its middle controls, then switch with Active road.
          </>
        }
      >
        <div className="space-y-2">
          <Field label="Active road">
            <NativeSelect
              aria-label="Active road"
              className={roadFieldClass}
              value={alignment.id}
              onChange={(e) => {
                p.workspace.update((x) => ({ ...x, activeAlignmentId: e.target.value }))
                p.onProfile('')
                p.onPoint(null)
              }}
            >
              {project.alignments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Road name">
            <input
              className={roadFieldClass}
              maxLength={200}
              value={alignment.name}
              onChange={(e) => updateAlignment((a) => ({ ...a, name: e.target.value }))}
            />
          </Field>
          <div className="flex gap-1">
            <Button
              size="sm"
              className="min-w-0 flex-1 gap-1 px-1"
              onClick={() => p.onMode('road')}
              aria-pressed={p.mode === 'road'}
              disabled={full}
            >
              <Plus className="size-3" />
              Peg road
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="min-w-0 flex-1 gap-1 px-1"
              aria-label="Duplicate active alignment"
              title="Keep this road and edit a separate path alternative"
              onClick={p.onDuplicate}
              disabled={full}
            >
              <Copy className="size-3" /> Duplicate
            </Button>
            <Button
              size="icon"
              className="size-8 shrink-0"
              variant="ghost"
              aria-label="Delete active alignment"
              title="Delete this road"
              onClick={p.onRemoveAlignment}
              disabled={project.alignments.length <= 1}
            >
              <Trash2 className="size-3" />
            </Button>
          </div>
        </div>
      </RoadSection>
      <div className="space-y-2 border-y p-3" data-testid="full-cost-planning-controls">
        <Button size="sm" className="w-full" onClick={p.onCompareCompleteCosts} disabled={!!p.workspace.busy}>
          Compare complete route costs
        </Button>
        <p className="text-[11px] text-muted-foreground">
          Compare construction, connected road reuse, rehabilitation and delivered gravel costs. Each candidate must
          pass final curve, loaded-grade and full road-footprint checks.
        </p>
        <FullCostRecordSummary alignment={alignment} project={project} onOpenComparison={p.onCompareCompleteCosts} />
      </div>
      <div className="grid grid-cols-2 gap-1 px-3 py-2">
        <Button
          variant="outline"
          size="sm"
          className="h-auto min-h-8 whitespace-normal text-xs"
          onClick={p.onShowExistingRoads}
        >
          Review existing roads
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-auto min-h-8 whitespace-normal text-xs"
          onClick={p.onShowEngineering}
        >
          Gravel &amp; aggregate costs
        </Button>
      </div>
      <RouteFinding {...p} full={full} />
      <HorizontalPoints {...p} />
      <VerticalAlignment {...p} />
      <VerticalDesignControls workspace={p.workspace} />
    </>
  )
}

function RouteFinding(p: SidebarProps & { full: boolean }) {
  const [livePreview, setLivePreview] = useState(false)
  const { onPreviewRoute } = p
  const { project, source, alignment } = p.workspace
  const route = project.routeSearch ?? DEFAULT_ROUTE_OPTIONS
  const setRoute = (change: (current: RouteSearchOptions) => RouteSearchOptions) =>
    p.workspace.update((current) => ({
      ...current,
      routeSearch: change(current.routeSearch ?? DEFAULT_ROUTE_OPTIONS),
    }))
  useEffect(() => {
    if (!onPreviewRoute) return
    if (!livePreview) {
      onPreviewRoute(null)
      return
    }
    const timer = window.setTimeout(() => onPreviewRoute({ ...route, alternatives: 1 }), 500)
    return () => window.clearTimeout(timer)
  }, [livePreview, route, project.settings, project.context, source, alignment.id, alignment.points, onPreviewRoute])
  useEffect(() => () => onPreviewRoute?.(null), [onPreviewRoute])
  const eligibleRoads = project.context.filter(
    (feature) =>
      feature.kind === 'existing-road' &&
      feature.roadEvidence?.reuseAllowed &&
      feature.roadEvidence.condition !== 'closed',
  ).length
  const [objective, setObjective] = useState<RoadOptimizationObjective>('balanced')
  const [halfWidth, setHalfWidth] = useState(180)
  const validCorridorSettings =
    project.settings.maxGradePercent >= 1 &&
    project.settings.maxGradePercent <= 30 &&
    project.settings.minRadius >= 5 &&
    project.settings.minRadius <= 1000
  const validWidth = Number.isFinite(halfWidth) && halfWidth >= 25 && halfWidth <= 1000
  return (
    <CollapsibleSection
      label="Find a route"
      summary="Terrain-cost search · corridor optimizer"
      summaryWhenCollapsedOnly
      toggleProps={{ 'data-testid': 'road-route-tools' }}
      contentClassName="space-y-3 px-3 pb-3"
    >
      <div className="space-y-2" data-testid="road-route-options">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold">Terrain-cost search</p>
          <InfoTip label="About terrain-cost search">
            An eight-neighbour search between the road's endpoints, without curve constraints. Cost is road $/m scaled
            by sampled grade, plus each stream crossing and the $/m of any avoidance area given a zone cost. The
            defaults are placeholders. Clearance and terrain-slope inputs screen the centreline, not the final road
            footprint. Headings hold the first and last legs within ±45°.
          </InfoTip>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Maximum grade %"
            value={project.settings.maxGradePercent}
            min={0.1}
            max={100}
            step={0.5}
            hint="Absolute sampled ground grade for this route search; the designed vertical profile is checked separately."
            onChange={(maxGradePercent) =>
              p.workspace.update((current) => ({ ...current, settings: { ...current.settings, maxGradePercent } }))
            }
          />
          <NumberField
            label="Minimum radius (m)"
            value={project.settings.minRadius}
            min={0}
            max={10000}
            step={5}
            hint="Used by the corridor optimizer and curve checks. The terrain-cost grid result has sharp corners until curves are fitted."
            onChange={(minRadius) =>
              p.workspace.update((current) => ({ ...current, settings: { ...current.settings, minRadius } }))
            }
          />
          <OptionalNumberField
            label="Terrain slope limit %"
            value={route.maxTerrainSlopePercent}
            min={1}
            max={300}
            step={5}
            hint="Optional maximum magnitude of the terrain gradient, measured east/west and north/south. Missing neighbour samples block the route. This is not a slope-stability assessment."
            onChange={(maxTerrainSlopePercent) => setRoute((current) => ({ ...current, maxTerrainSlopePercent }))}
          />
          <NumberField
            label="Slope sample ±m"
            value={route.terrainSlopeSampleM}
            min={1}
            max={100}
            step={1}
            disabled={route.maxTerrainSlopePercent === null}
            onChange={(terrainSlopeSampleM) => setRoute((current) => ({ ...current, terrainSlopeSampleM }))}
          />
          <NumberField
            label="Exclusion clearance (m)"
            value={route.exclusionBufferM}
            max={500}
            step={5}
            hint="Centreline distance outside blocked exclusion polygons and lines. Set this to cover the expected road/clearing width and your project-specific setback. Cost zones stay passable."
            onChange={(exclusionBufferM) => setRoute((current) => ({ ...current, exclusionBufferM }))}
          />
          <OptionalNumberField
            label="Search margin (m)"
            value={route.searchMarginM}
            min={20}
            max={1000}
            step={20}
            placeholder="automatic"
            onChange={(searchMarginM) => setRoute((current) => ({ ...current, searchMarginM }))}
          />
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={route.allowStreamCrossings}
            onChange={(event) => setRoute((current) => ({ ...current, allowStreamCrossings: event.target.checked }))}
          />
          Allow priced stream crossings
        </label>
        {!route.allowStreamCrossings && (
          <NumberField
            label="Stream clearance (m)"
            value={route.streamBufferM}
            max={500}
            step={5}
            hint="Distance from imported stream linework when crossings are forbidden. This is an entered screening distance, not an automatic legal riparian classification. Import assessed riparian polygons as exclusions."
            onChange={(streamBufferM) => setRoute((current) => ({ ...current, streamBufferM }))}
          />
        )}
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={route.reuseExistingRoads}
            onChange={(event) => setRoute((current) => ({ ...current, reuseExistingRoads: event.target.checked }))}
          />
          Prefer reviewed existing roads ({eligibleRoads} eligible)
        </label>
        {route.reuseExistingRoads && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="Retained road cost %"
                value={route.existingRoadCostFactor * 100}
                min={5}
                max={100}
                step={5}
                hint="Portion of base road cost retained near eligible existing roads. Include rehabilitation in this assumption; the search does not estimate condition."
                onChange={(percent) => setRoute((current) => ({ ...current, existingRoadCostFactor: percent / 100 }))}
              />
              <NumberField
                label="Road proximity (m)"
                value={route.roadSnapDistanceM}
                min={1}
                max={50}
                step={1}
                onChange={(roadSnapDistanceM) => setRoute((current) => ({ ...current, roadSnapDistanceM }))}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Mark individual roads eligible after reviewing access and condition. Proximity is a cost preference; it
              does not verify a connection.
            </p>
          </>
        )}
        <div className="grid grid-cols-3 gap-1">
          <NumberField
            label="Road $/m"
            value={route.baseCostPerM}
            min={0.01}
            max={100000}
            step={10}
            onChange={(baseCostPerM) => setRoute((r) => ({ ...r, baseCostPerM }))}
          />
          <NumberField
            label="Crossing $"
            value={route.crossingCost}
            max={1e8}
            step={500}
            onChange={(crossingCost) => setRoute((r) => ({ ...r, crossingCost }))}
          />
          <NumberField
            label="Alternatives"
            value={route.alternatives}
            min={1}
            max={5}
            step={1}
            onChange={(alternatives) => setRoute((r) => ({ ...r, alternatives: Math.round(alternatives) }))}
          />
          <OptionalNumberField
            label="Start heading °"
            value={route.startHeading}
            min={0}
            max={360}
            step={5}
            onChange={(startHeading) => setRoute((r) => ({ ...r, startHeading }))}
          />
          <OptionalNumberField
            label="End heading °"
            value={route.endHeading}
            min={0}
            max={360}
            step={5}
            onChange={(endHeading) => setRoute((r) => ({ ...r, endHeading }))}
          />
        </div>
        {onPreviewRoute && (
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={livePreview} onChange={(event) => setLivePreview(event.target.checked)} />
            Live route preview
          </label>
        )}
        {livePreview && (
          <p className="text-[11px] text-muted-foreground">
            Preview refreshes after a short pause while you type or use the arrow keys. Save an alternative to keep it.
          </p>
        )}
        <Button variant="outline" size="sm" className="w-full" disabled={p.full} onClick={() => p.onSuggest(route)}>
          Suggest terrain-cost {route.alternatives > 1 ? 'alternatives' : 'alternative'}
        </Button>
      </div>
      {p.onConnectFsr && (
        <FsrConnectionControls
          key={`${p.workspace.projectId ?? 'training'}:${alignment.id}`}
          {...p}
          options={route}
          full={p.full}
        />
      )}
      <div className="space-y-2 border-t pt-3" data-testid="road-corridor-optimizer">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold">Optimize sketched road corridor</p>
          <InfoTip label="About the corridor optimizer">
            Peg two endpoints and any guide points first; the sketched shape is the centre of the search corridor. It
            uses the current grade and minimum-radius settings as screening inputs, and every result is a new, editable
            road alternative. Not a certified road design: inspect each candidate's profile, curves, crossings and
            earthworks.
          </InfoTip>
        </div>
        <p className="text-[11px] text-muted-foreground">
          The corridor optimizer uses grade, radius and mapped exclusions. The terrain-slope, stream-crossing, setback
          and reuse settings above apply to terrain-cost and FSR searches.
        </p>
        {!validCorridorSettings && (
          <InlineAlert tone="warning">
            Corridor search requires grade 1–30% and radius 5–1,000 m. Adjust the shared fields above to enable it.
          </InlineAlert>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Field label="Preference">
            <NativeSelect
              aria-label="Corridor optimization objective"
              className={roadFieldClass}
              value={objective}
              onChange={(e) => setObjective(e.target.value as RoadOptimizationObjective)}
            >
              <option value="shortest">Shortest (less grade penalty)</option>
              <option value="balanced">Balanced (grade, length, curves)</option>
              <option value="contour">Contour-friendly (gentler terrain)</option>
            </NativeSelect>
          </Field>
          <Field label="Half-width (m)">
            <input
              aria-label="Corridor half-width metres"
              type="number"
              min={25}
              max={1000}
              step={25}
              className={roadFieldClass}
              value={halfWidth}
              onChange={(e) => setHalfWidth(Number(e.target.value))}
            />
          </Field>
        </div>
        <Button
          size="sm"
          className="w-full"
          disabled={p.full || !validWidth || !validCorridorSettings}
          onClick={() => p.onOptimize(objective, halfWidth)}
        >
          Optimize sketched corridor
        </Button>
      </div>
    </CollapsibleSection>
  )
}

function HorizontalPoints(p: SidebarProps) {
  const { project, alignment, updateAlignment, source } = p.workspace
  const point = alignment.points.find((x) => x.id === p.selectedPoint)
  const movePoint = (axis: 0 | 1, value: number) =>
    updateAlignment((a) => ({
      ...a,
      points: a.points.map((x) =>
        x.id === point?.id ? { ...x, coordinate: axis === 0 ? [value, x.coordinate[1]] : [x.coordinate[0], value] } : x,
      ),
    }))
  return (
    <RoadSection
      title="Horizontal points"
      help="Select a control point to type its position, radius and spirals, or use the bulk tools to fit every corner at once. Sharp corners need a fitted radius before the road is a design."
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-1">
        <NativeSelect
          aria-label="Selected horizontal point"
          className={roadFieldClass}
          value={point?.id ?? ''}
          onChange={(e) => {
            p.onPoint(e.target.value)
            p.onMode('edit')
          }}
        >
          <option value="">Select a control point</option>
          {alignment.points.map((x, i) => (
            <option key={x.id} value={x.id}>
              Point {i + 1}
              {i === 0 ? ' · start' : i === alignment.points.length - 1 ? ' · end' : ''} · radius {x.radiusM} m
            </option>
          ))}
        </NativeSelect>
        <Button
          size="sm"
          variant="outline"
          className="px-2 text-xs"
          aria-label="Select start"
          title="Select the start point"
          onClick={() => {
            p.onMode('edit')
            p.onPoint(alignment.points[0]?.id ?? null)
          }}
        >
          Start
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="px-2 text-xs"
          aria-label="Select end"
          title="Select the end point"
          onClick={() => {
            p.onMode('edit')
            p.onPoint(alignment.points.at(-1)?.id ?? null)
          }}
        >
          End
        </Button>
      </div>
      {point && (
        <div className="mt-2 space-y-2 rounded-md border p-2">
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Longitude"
              value={point.coordinate[0]}
              min={-180}
              max={180}
              step={0.00001}
              onChange={(value) => movePoint(0, value)}
            />
            <NumberField
              label="Latitude"
              value={point.coordinate[1]}
              min={-85}
              max={85}
              step={0.00001}
              onChange={(value) => movePoint(1, value)}
            />
            <NumberField
              label="Horizontal radius (m)"
              value={point.radiusM}
              max={1000}
              step={1}
              onChange={(radiusM) =>
                updateAlignment((a) => ({
                  ...a,
                  points: a.points.map((x) => (x.id === point.id ? { ...x, radiusM } : x)),
                }))
              }
            />
            <NumberField
              label="Spiral length each side (m)"
              value={point.spiralM ?? 0}
              max={2000}
              step={5}
              onChange={(spiralM) =>
                updateAlignment((a) => ({
                  ...a,
                  points: a.points.map((x) => {
                    if (x.id !== point.id) return x
                    const { spiralM: _old, ...rest } = x
                    void _old
                    return spiralM > 0 ? { ...rest, spiralM } : rest
                  }),
                }))
              }
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={alignment.points.length <= 2}
            onClick={() => {
              updateAlignment((a) => ({ ...a, points: a.points.filter((x) => x.id !== point.id) }))
              p.onPoint(null)
            }}
          >
            <Trash2 className="mr-1 size-3" />
            Remove selected point
          </Button>
        </div>
      )}
      <CurveTools workspace={p.workspace} />
      <details className="mt-2">
        <summary className="cursor-pointer text-xs">Segment distances & ground grades</summary>
        <div className="mt-2 max-h-48 overflow-auto">
          <table className="w-full text-right text-[11px]">
            <thead>
              <tr>
                <th>Leg</th>
                <th>Distance m</th>
                <th>Ground %</th>
              </tr>
            </thead>
            <tbody>
              {alignment.points.slice(1).map((b, i) => {
                const a = alignment.points[i],
                  length = distance(a.coordinate, b.coordinate),
                  za = source.elevationAt(...a.coordinate),
                  zb = source.elevationAt(...b.coordinate),
                  grade = length > 0 && Number.isFinite(za + zb) ? ((zb - za) / length) * 100 : null
                return (
                  <tr key={b.id}>
                    <td>
                      {i + 1}–{i + 2}
                    </td>
                    <td>{length.toFixed(1)}</td>
                    <td
                      className={
                        grade !== null && Math.abs(grade) > project.settings.maxGradePercent ? 'text-red-600' : ''
                      }
                    >
                      {grade?.toFixed(1) ?? '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </details>
    </RoadSection>
  )
}

function VerticalAlignment(p: SidebarProps) {
  const { alignment, analysis, updateAlignment } = p.workspace
  const addPvi = () => {
    const at = analysis.stations.reduce(
      (best, s) =>
        Math.abs(s.chainage - p.workspace.station) < Math.abs(best.chainage - p.workspace.station) ? s : best,
      analysis.stations[0],
    )
    if (!at || at.groundElevation === null) return
    updateAlignment((a) => ({
      ...a,
      vertical: [
        ...a.vertical.filter((v) => Math.abs(v.chainage - at.chainage) > 0.05),
        { id: id(), chainage: at.chainage, elevation: at.designElevation ?? at.groundElevation!, curveLength: 0 },
      ].sort((a, b) => a.chainage - b.chainage),
    }))
  }
  return (
    <RoadSection
      title="Vertical alignment"
      help="Drag the diamonds in the profile, double-click the profile to add a PVI, or edit the points here. Levels are formation centre elevations; curve lengths are metres. Follow ground removes every PVI."
    >
      <div className="flex gap-1">
        <Button size="sm" variant="outline" className="flex-1" onClick={addPvi}>
          <Plus className="mr-1 size-3" />
          Add PVI at station
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="flex-1"
          disabled={!alignment.vertical.length}
          onClick={() => updateAlignment((a) => ({ ...a, vertical: [] }))}
        >
          Follow ground
        </Button>
      </div>
      {!alignment.vertical.length && (
        <InlineAlert tone="info" className="mt-2">
          Following the ground. Add PVIs to design formation levels.
        </InlineAlert>
      )}
      <SectionReachAlert workspace={p.workspace} />
      {alignment.vertical.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {alignment.vertical.map((v, i) => (
            <div key={v.id} className="rounded border px-2 pb-2 pt-1">
              <div className="flex items-center justify-between">
                <button className="text-xs font-medium" onClick={() => p.workspace.setStation(v.chainage)}>
                  PVI {i + 1} · {formatRoadStation(v.chainage)}
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-5"
                  aria-label={`Remove PVI ${i + 1}`}
                  onClick={() => updateAlignment((a) => ({ ...a, vertical: a.vertical.filter((x) => x.id !== v.id) }))}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
              <div className="grid grid-cols-3 items-end gap-1">
                {(['chainage', 'elevation', 'curveLength'] as const).map((key) => (
                  <NumberField
                    key={key}
                    label={key === 'chainage' ? 'Station' : key === 'elevation' ? 'Level' : 'Curve length (m)'}
                    ariaLabel={
                      key === 'chainage'
                        ? `PVI ${i + 1} station`
                        : key === 'elevation'
                          ? `PVI ${i + 1} level`
                          : `PVI ${i + 1} curve`
                    }
                    value={v[key]}
                    min={key === 'elevation' ? -1000 : 0}
                    max={key === 'elevation' ? 9000 : key === 'chainage' ? Math.max(analysis.length, v.chainage) : 2000}
                    step={key === 'elevation' ? 0.1 : 1}
                    onChange={(value) =>
                      updateAlignment((a) => ({
                        ...a,
                        vertical: a.vertical
                          .map((x) => (x.id === v.id ? { ...x, [key]: value } : x))
                          .sort((a, b) => a.chainage - b.chainage),
                      }))
                    }
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </RoadSection>
  )
}
