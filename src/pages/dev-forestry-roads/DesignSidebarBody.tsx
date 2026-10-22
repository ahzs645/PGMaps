import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Copy, Download, Mountain, Plus, Route, SlidersHorizontal, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InlineAlert, SidebarSection } from '@/components/ui/map-panels'
import { TabBar } from '@/components/ui/tab-bar'
import { Field, NumberField, OptionalNumberField, roadFieldClass } from './Controls'
import { formatRoadStation } from './Charts'
import { EngineeringControls } from './EngineeringControls'
import { VerticalDesignControls } from './VerticalDesignControls'
import { CurveDesignControls, CurveTools } from './CurveTools'
import { TemplateComponents } from './TemplateComponents'
import { distance } from './engine'
import type { RoadOptimizationObjective } from './corridorOptimizer'
import { DEFAULT_ROUTE_OPTIONS, type RouteSearchOptions } from './routing'
import type { DrawMode } from './PlanView'
import type { RoadWorkspace } from './useRoadWorkspace'
import type { RoadTemplate, WidthOverride } from './types'

export type FileKind = 'project' | 'terrain' | 'alignment' | 'context'
export interface SidebarProps {
  workspace: RoadWorkspace
  mode: DrawMode
  onMode: (mode: DrawMode) => void
  onFile: (kind: FileKind) => void
  onTerrain: (kind: 'lidar' | 'regional' | 'demo') => void
  verticalReference: string
  onVerticalReference: (value: string) => void
  selectedPoint: string | null
  onPoint: (id: string | null) => void
  onDuplicate: () => void
  onRemoveAlignment: () => void
  onSuggest: (options: RouteSearchOptions) => void
  onOptimize: (objective: RoadOptimizationObjective, corridorHalfWidthM: number) => void
  onSave: (kind: 'project' | 'geojson' | 'csv' | 'report' | 'landxml' | 'stakeout' | 'shapefile') => void
  onProfile: (id: string) => void
  activeProfile: string | null
  onPreviewTemplate: (template: RoadTemplate, name: string) => void
  onCloseTemplatePreview: () => void
  onQuantities: () => void
}
const id = () => crypto.randomUUID()
export function DesignSidebar(p: SidebarProps) {
  const [tab, setTab] = useState<'terrain' | 'design' | 'template' | 'engineering' | 'review' | 'files'>('design')
  const [routeObjective, setRouteObjective] = useState<RoadOptimizationObjective>('balanced')
  const [corridorHalfWidthM, setCorridorHalfWidthM] = useState(180)
  const [route, setRoute] = useState<RouteSearchOptions>(DEFAULT_ROUTE_OPTIONS)
  const { project, alignment, analysis, update, updateAlignment, source } = p.workspace
  const point = alignment.points.find((x) => x.id === p.selectedPoint)
  const tweakTemplate = (key: keyof RoadTemplate, value: number) =>
    updateAlignment((a) => ({ ...a, template: { ...a.template, [key]: value } }))
  const tweakOverride = (key: string, changes: Partial<WidthOverride>) =>
    updateAlignment((a) => ({ ...a, overrides: a.overrides.map((x) => (x.id === key ? { ...x, ...changes } : x)) }))
  const addWidening = (kind: WidthOverride['kind']) =>
    updateAlignment((a) => ({
      ...a,
      overrides: [
        ...a.overrides,
        {
          id: id(),
          name: kind === 'landing' ? 'New landing' : 'New turnout',
          kind,
          side: 'left',
          start: Math.min(p.workspace.station, Math.max(0, analysis.length - 60)),
          end: Math.min(analysis.length, Math.min(p.workspace.station, Math.max(0, analysis.length - 60)) + 60),
          taper: 10,
          extraWidth: kind === 'landing' ? 9 : 4,
        },
      ],
    }))
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
    <aside
      aria-label="Road design controls"
      className="flex min-h-0 min-w-0 max-h-[60vh] lg:max-h-none flex-col rounded-xl border bg-card"
    >
      <fieldset disabled={!!p.workspace.busy} className="contents">
        <div className="border-b p-2">
          <TabBar
            label="Road workflow"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'terrain', label: 'Terrain', icon: Mountain },
              { value: 'design', label: 'Design', icon: Route },
              { value: 'template', label: 'Section', icon: SlidersHorizontal },
              { value: 'engineering', label: 'Engineering' },
              { value: 'review', label: 'Review' },
              { value: 'files', label: 'Files' },
            ]}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
          <div hidden={tab !== 'terrain'} className="space-y-4">
            <SidebarSection title="Terrain source">
              <p className="mb-2 text-sm font-medium">{project.terrain.name}</p>
              <p className="text-xs leading-5 text-muted-foreground">
                {project.terrain.resolutionM.toFixed(2)} m cells ·{' '}
                {project.terrain.epsg ? `EPSG:${project.terrain.epsg}` : 'training coordinates'}
                <br />
                {project.terrain.verticalReference}
              </p>
              <Button
                className="mt-3 w-full"
                size="sm"
                disabled={!!p.workspace.busy}
                onClick={() => p.onTerrain('lidar')}
              >
                Load BC 1 m LiDAR sample
              </Button>
              <div className="mt-3 space-y-2">
                <Field label="Imported DEM vertical datum (metres)">
                  <input
                    className={roadFieldClass}
                    value={p.verticalReference}
                    placeholder="e.g. CGVD2013 / EPSG:6647"
                    onChange={(e) => p.onVerticalReference(e.target.value)}
                  />
                </Field>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => p.onFile('terrain')}
                  disabled={!!p.workspace.busy}
                >
                  <Upload className="mr-2 size-3" />
                  Import GeoTIFF or LAS
                </Button>
                <p className="text-[11px] leading-4 text-muted-foreground">
                  A GeoTIFF: single-band bare-earth elevations in metres, up to 4.19 million native cells / 64 MB, with
                  resolution and no-data preserved. A LAS point cloud (up to 1 GB, uncompressed): its ground-classified
                  points are averaged into a ~1 m grid, gaps up to 3 cells are filled and wider ones stay missing. It
                  needs a projected CRS key; the vertical datum comes from the file or the field above. Decompress LAZ
                  first.
                </p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!!p.workspace.busy}
                  onClick={() => p.onTerrain('regional')}
                >
                  Regional DEM
                </Button>
                <Button variant="ghost" size="sm" disabled={!!p.workspace.busy} onClick={() => p.onTerrain('demo')}>
                  Training example
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Regional DEM is coarse reconnaissance terrain. It is not a 1 m LiDAR source.
              </p>
            </SidebarSection>
            <SidebarSection title="Context & terrain profiles">
              <Button variant="outline" size="sm" className="w-full" onClick={() => p.onFile('context')}>
                Import streams / constraints
              </Button>
              <p className="my-2 text-[11px] leading-4 text-muted-foreground">
                GeoJSON or a zipped shapefile. GeoJSON kind: stream, avoid, existing-road or harvest. A selected line
                can also be sampled as a terrain profile.
              </p>
              <div className="flex flex-wrap gap-1">
                <Button variant="outline" size="sm" onClick={() => p.onMode('profile')}>
                  Draw terrain profile
                </Button>
                <Button variant="outline" size="sm" onClick={() => p.onMode('stream')}>
                  Draw stream
                </Button>
                <Button variant="outline" size="sm" onClick={() => p.onMode('avoid')}>
                  Draw avoidance area
                </Button>
              </div>
              <div className="mt-3 space-y-1">
                {project.context.map((feature) => (
                  <div key={feature.id} className="flex items-center gap-1 rounded border px-2 py-1">
                    <button
                      className="min-w-0 flex-1 truncate text-left text-xs"
                      disabled={feature.geometry.type !== 'LineString'}
                      onClick={() => p.onProfile(feature.id)}
                    >
                      {feature.name} <span className="text-muted-foreground">· {feature.kind}</span>
                    </button>
                    {feature.kind === 'avoid' && feature.geometry.type === 'Polygon' && (
                      <div
                        className="w-20"
                        title="Empty blocks the route search; a value lets it cross at this extra cost"
                      >
                        <OptionalNumberField
                          label={`${feature.name} zone cost per metre`}
                          hideLabel
                          placeholder="blocked"
                          value={feature.routeCostPerM ?? null}
                          min={0}
                          max={1e6}
                          step={10}
                          onChange={(cost) =>
                            update((x) => ({
                              ...x,
                              context: x.context.map((c) => {
                                if (c.id !== feature.id) return c
                                const { routeCostPerM: _old, ...rest } = c
                                void _old
                                return cost === null ? rest : { ...rest, routeCostPerM: cost }
                              }),
                            }))
                          }
                        />
                      </div>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6"
                      aria-label={`Remove context ${feature.name}`}
                      onClick={() => update((x) => ({ ...x, context: x.context.filter((c) => c.id !== feature.id) }))}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                ))}
              </div>
              {(project.profiles ?? []).map((profile) => (
                <div key={profile.id} className="mt-1 flex items-center gap-1 rounded border px-2 py-1">
                  <button className="flex-1 text-left text-xs" onClick={() => p.onProfile(profile.id)}>
                    {profile.name}
                  </button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-6"
                    aria-label={`Remove profile ${profile.name}`}
                    onClick={() => update((x) => ({ ...x, profiles: x.profiles?.filter((v) => v.id !== profile.id) }))}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              ))}
            </SidebarSection>
            <SidebarSection title="Related LiDAR workspaces">
              <p className="mb-2 text-[11px] leading-4 text-muted-foreground">
                The reference's individual-tree and species tables use inventory observations. The ground DEM cannot
                provide DBH, species or merchantable volume. These workspaces inspect the published BC sample's
                available canopy and tree products.
              </p>
              <div className="space-y-2 text-xs">
                <Link className="block text-primary underline" to="/dev/lidar/forestry/" target="_blank">
                  Open forest structure & plots
                </Link>
                <Link className="block text-primary underline" to="/dev/lidar/canopy/" target="_blank">
                  Open canopy heights & density
                </Link>
                <Link className="block text-primary underline" to="/dev/lidar/trees/" target="_blank">
                  Open individual-tree inspection
                </Link>
                <Link className="block text-primary underline" to="/dev/lidar/transects/" target="_blank">
                  Open source point-cloud transects
                </Link>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                The road project stays open here. These links open the published sample; they do not relabel an imported
                DEM as an inventory dataset.
              </p>
            </SidebarSection>
          </div>

          <div hidden={tab !== 'design'} className="space-y-4">
            <SidebarSection title="Alignment alternatives">
              <Field label="Active road">
                <select
                  aria-label="Active road"
                  className={roadFieldClass}
                  value={alignment.id}
                  onChange={(e) => {
                    update((x) => ({ ...x, activeAlignmentId: e.target.value }))
                    p.onProfile('')
                    p.onPoint(null)
                  }}
                >
                  {project.alignments.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Road name">
                <input
                  className={`${roadFieldClass} mt-1`}
                  maxLength={200}
                  value={alignment.name}
                  onChange={(e) => updateAlignment((a) => ({ ...a, name: e.target.value }))}
                />
              </Field>
              <div className="mt-2 flex flex-wrap gap-1">
                <Button size="sm" onClick={() => p.onMode('road')} disabled={project.alignments.length >= 20}>
                  <Plus className="mr-1 size-3" />
                  Peg road
                </Button>
                <Button
                  size="sm"
                  variant={p.mode === 'edit' ? 'secondary' : 'outline'}
                  onClick={() => p.onMode(p.mode === 'edit' ? 'inspect' : 'edit')}
                >
                  Edit points
                </Button>
                <Button
                  size="icon"
                  className="size-8"
                  variant="outline"
                  aria-label="Duplicate active alignment"
                  onClick={p.onDuplicate}
                  disabled={project.alignments.length >= 20}
                >
                  <Copy className="size-3" />
                </Button>
                <Button
                  size="icon"
                  className="size-8"
                  variant="ghost"
                  aria-label="Delete active alignment"
                  onClick={p.onRemoveAlignment}
                  disabled={project.alignments.length <= 1}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
              <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                Peg points on the plan. Drag numbered controls to edit. The profile, section and quantities update
                together. Sharp corners need a fitted radius before use as a road design.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2 w-full"
                disabled={project.alignments.length >= 20}
                onClick={() => p.onSuggest(route)}
              >
                Suggest terrain-cost {route.alternatives > 1 ? 'alternatives' : 'alternative'}
              </Button>
              <div className="mt-2 grid grid-cols-3 gap-1" data-testid="road-route-options">
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
              <p className="mt-1 text-[11px] text-muted-foreground">
                Eight-neighbour terrain-cost search between endpoints, without curve constraints. Cost is road $/m
                scaled by sampled grade, plus each stream crossing and the $/m of any review area given a zone cost; the
                defaults are placeholders. Headings hold the first and last legs within ±45°.
              </p>
              <div className="mt-3 space-y-2 rounded-md border p-2" data-testid="road-corridor-optimizer">
                <p className="text-xs font-semibold">Optimize sketched road corridor</p>
                <p className="text-[11px] text-muted-foreground">
                  Peg two endpoints and optional intermediate guide points first. The sketched shape defines the centre
                  of a search corridor; all results remain editable road alternatives.
                </p>
                <Field label="Preference">
                  <select
                    aria-label="Corridor optimization objective"
                    className={roadFieldClass}
                    value={routeObjective}
                    onChange={(e) => setRouteObjective(e.target.value as RoadOptimizationObjective)}
                  >
                    <option value="shortest">Shortest (less grade penalty)</option>
                    <option value="balanced">Balanced (grade, length, curves)</option>
                    <option value="contour">Contour-friendly (gentler terrain)</option>
                  </select>
                </Field>
                <Field label="Corridor half-width (m)">
                  <input
                    aria-label="Corridor half-width metres"
                    type="number"
                    min={25}
                    max={1000}
                    step={25}
                    className={roadFieldClass}
                    value={corridorHalfWidthM}
                    onChange={(e) => setCorridorHalfWidthM(Number(e.target.value))}
                  />
                </Field>
                <Button
                  size="sm"
                  className="w-full"
                  disabled={
                    project.alignments.length >= 20 ||
                    corridorHalfWidthM < 25 ||
                    corridorHalfWidthM > 1000 ||
                    !Number.isFinite(corridorHalfWidthM)
                  }
                  onClick={() => p.onOptimize(routeObjective, corridorHalfWidthM)}
                >
                  Optimize sketched corridor
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  Uses the current grade and minimum-radius settings as screening inputs. Not a certified road design:
                  inspect each candidate’s vertical profile, geometric curves, crossings and earthworks.
                </p>
              </div>
            </SidebarSection>
            <SidebarSection title="Horizontal points">
              <CurveTools workspace={p.workspace} />
              <select
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
                    Point {i + 1} · radius {x.radiusM} m
                  </option>
                ))}
              </select>
              {point && (
                <div className="mt-2 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <NumberField
                      label="Longitude"
                      value={point.coordinate[0]}
                      min={-180}
                      max={180}
                      step={0.00001}
                      onChange={(value) =>
                        updateAlignment((a) => ({
                          ...a,
                          points: a.points.map((x) =>
                            x.id === point.id ? { ...x, coordinate: [value, x.coordinate[1]] } : x,
                          ),
                        }))
                      }
                    />
                    <NumberField
                      label="Latitude"
                      value={point.coordinate[1]}
                      min={-85}
                      max={85}
                      step={0.00001}
                      onChange={(value) =>
                        updateAlignment((a) => ({
                          ...a,
                          points: a.points.map((x) =>
                            x.id === point.id ? { ...x, coordinate: [x.coordinate[0], value] } : x,
                          ),
                        }))
                      }
                    />
                  </div>
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
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={alignment.points.length <= 2}
                    onClick={() => {
                      updateAlignment((a) => ({ ...a, points: a.points.filter((x) => x.id !== point.id) }))
                      p.onPoint(null)
                    }}
                  >
                    Remove selected point
                  </Button>
                </div>
              )}
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
                                grade !== null && Math.abs(grade) > project.settings.maxGradePercent
                                  ? 'text-red-600'
                                  : ''
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
            </SidebarSection>
            <SidebarSection title="Vertical alignment">
              <div className="mb-2 flex flex-wrap gap-1">
                <Button size="sm" variant="outline" onClick={addPvi}>
                  Add PVI at station
                </Button>
                <Button size="sm" variant="ghost" onClick={() => updateAlignment((a) => ({ ...a, vertical: [] }))}>
                  Follow ground
                </Button>
              </div>
              <p className="text-[11px] leading-4 text-muted-foreground">
                Drag diamonds in the profile or edit the points below. Elevations are formation centre levels; curve
                lengths are metres. Double-click the profile to add a PVI.
              </p>
              {!alignment.vertical.length && (
                <InlineAlert tone="warning">
                  Ground-following reconnaissance; add a vertical alignment to design formation levels.
                </InlineAlert>
              )}
              <div className="mt-2 space-y-3">
                {alignment.vertical.map((v, i) => (
                  <div key={v.id} className="rounded border p-2">
                    <div className="mb-1 flex items-center justify-between">
                      <button className="text-xs font-medium" onClick={() => p.workspace.setStation(v.chainage)}>
                        PVI {i + 1} · {formatRoadStation(v.chainage)}
                      </button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-5"
                        aria-label={`Remove PVI ${i + 1}`}
                        onClick={() =>
                          updateAlignment((a) => ({ ...a, vertical: a.vertical.filter((x) => x.id !== v.id) }))
                        }
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {(['chainage', 'elevation', 'curveLength'] as const).map((key) => (
                        <NumberField
                          key={key}
                          label={
                            key === 'chainage'
                              ? `PVI ${i + 1} station`
                              : key === 'elevation'
                                ? `PVI ${i + 1} level`
                                : `PVI ${i + 1} curve`
                          }
                          value={v[key]}
                          min={key === 'elevation' ? -1000 : 0}
                          max={
                            key === 'elevation'
                              ? 9000
                              : key === 'chainage'
                                ? Math.max(analysis.length, v.chainage)
                                : 2000
                          }
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
            </SidebarSection>
            <VerticalDesignControls workspace={p.workspace} />
          </div>

          <div hidden={tab !== 'template'} className="space-y-4">
            <SidebarSection title="Road cross-section">
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ['leftWidth', 'Left half-width (m)', 0.1, 50],
                    ['rightWidth', 'Right half-width (m)', 0.1, 50],
                    ['crossfallPercent', 'Crown crossfall (%)', 0, 20],
                    ['cutSlope', 'Cut batter (H:V)', 0.1, 10],
                    ['fillSlope', 'Fill batter (H:V)', 0.1, 10],
                    ['ditchWidth', 'Ditch width (m)', 0, 10],
                    ['ditchDepth', 'Ditch depth (m)', 0, 5],
                    ['surfaceDepth', 'Surfacing depth (m)', 0, 2],
                  ] as [keyof RoadTemplate, string, number, number][]
                ).map(([key, label, min, max]) => (
                  <NumberField
                    key={key}
                    label={label}
                    value={alignment.template[key] ?? 0}
                    min={min}
                    max={max}
                    onChange={(value) => tweakTemplate(key, value)}
                  />
                ))}
              </div>
              <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                Formation geometry uses a crown, cut-side ditch and ground-intersecting batters. The surfacing layer is
                a separate quantity. Batters and costs are editable planning assumptions.
              </p>
              <Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => setTab('engineering')}>
                Template library & station assignments
              </Button>
            </SidebarSection>
            <SidebarSection title="Template components">
              <TemplateComponents
                template={alignment.template}
                onChange={(template) => updateAlignment((a) => ({ ...a, template }))}
              />
            </SidebarSection>
            <SidebarSection title="Design speed · superelevation & widening">
              <CurveDesignControls workspace={p.workspace} />
            </SidebarSection>
            <SidebarSection title="Landings & turnouts">
              <div className="mb-2 flex gap-1">
                <Button size="sm" variant="outline" onClick={() => addWidening('landing')}>
                  + Landing
                </Button>
                <Button size="sm" variant="outline" onClick={() => addWidening('turnout')}>
                  + Turnout
                </Button>
              </div>
              {alignment.overrides.map((v) => (
                <div key={v.id} className="mb-3 space-y-2 rounded border p-2">
                  <div className="flex gap-1">
                    <input
                      aria-label="Widening name"
                      className={roadFieldClass}
                      value={v.name}
                      maxLength={200}
                      onChange={(e) => tweakOverride(v.id, { name: e.target.value })}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0"
                      aria-label={`Duplicate ${v.name}`}
                      onClick={() =>
                        updateAlignment((a) => ({
                          ...a,
                          overrides: [...a.overrides, { ...v, id: id(), name: `${v.name} copy` }],
                        }))
                      }
                    >
                      <Copy className="size-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0"
                      aria-label={`Remove ${v.name}`}
                      onClick={() =>
                        updateAlignment((a) => ({ ...a, overrides: a.overrides.filter((x) => x.id !== v.id) }))
                      }
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Widening type">
                      <select
                        className={roadFieldClass}
                        value={v.kind}
                        onChange={(e) => tweakOverride(v.id, { kind: e.target.value as WidthOverride['kind'] })}
                      >
                        <option value="landing">Landing · unsurfaced</option>
                        <option value="turnout">Turnout · surfaced</option>
                      </select>
                    </Field>
                    <Field label="Widening side">
                      <select
                        className={roadFieldClass}
                        value={v.side}
                        onChange={(e) => tweakOverride(v.id, { side: e.target.value as WidthOverride['side'] })}
                      >
                        <option value="left">Left</option>
                        <option value="right">Right</option>
                        <option value="both">Both</option>
                      </select>
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {(['start', 'end', 'taper', 'extraWidth'] as const).map((key) => (
                      <NumberField
                        key={key}
                        label={`${key === 'extraWidth' ? 'Extra width' : key[0].toUpperCase() + key.slice(1)} (m)`}
                        value={v[key]}
                        max={key === 'extraWidth' ? 50 : key === 'taper' ? 1000 : 100000}
                        onChange={(value) => tweakOverride(v.id, { [key]: value })}
                      />
                    ))}
                  </div>
                  {v.end <= v.start && (
                    <p role="alert" className="text-xs text-red-600">
                      End station must be after start.
                    </p>
                  )}
                </div>
              ))}
            </SidebarSection>
          </div>

          <div hidden={tab !== 'engineering'} className="space-y-4">
            <EngineeringControls
              workspace={p.workspace}
              onPreviewTemplate={p.onPreviewTemplate}
              onClosePreview={p.onCloseTemplatePreview}
              onQuantities={p.onQuantities}
            />
          </div>
          <div hidden={tab !== 'review'} className="space-y-4">
            <SidebarSection title="Screening & sampling">
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ['stationInterval', 'Station spacing (m)', 2, 100],
                    ['crossSectionHalfWidth', 'Section reach each side (m)', 5, 100],
                    ['maxGradePercent', 'Grade limit (%)', 0.1, 100],
                    ['minRadius', 'Minimum radius (m)', 0, 10000],
                  ] as const
                ).map(([key, label, min, max]) => (
                  <NumberField
                    key={key}
                    label={label}
                    value={project.settings[key]}
                    min={min}
                    max={max}
                    step={1}
                    onChange={(value) => update((x) => ({ ...x, settings: { ...x.settings, [key]: value } }))}
                  />
                ))}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Thresholds are project inputs, not a claim of compliance with a road standard.
              </p>
            </SidebarSection>
            <SidebarSection title="Crossings & review flags">
              <p className="mb-2 text-xs">
                {analysis.coveragePercent.toFixed(1)}% of road length has complete earthwork sections.
              </p>
              {analysis.crossings.map((c) => (
                <button
                  key={c.id}
                  className="mb-1 block w-full rounded border px-2 py-1 text-left text-xs hover:bg-muted"
                  onClick={() => p.workspace.setStation(c.chainage)}
                >
                  {c.name} · {formatRoadStation(c.chainage)}
                  <span className="block text-muted-foreground">{c.kind} crossing · field review</span>
                </button>
              ))}
              {analysis.warnings.map((w, i) => (
                <p key={i} className="mb-1 border-l-2 border-amber-500 pl-2 text-xs">
                  {w}
                </p>
              ))}
              <p className="mt-2 text-[11px] text-muted-foreground">
                Stream intersections flag crossing sites. Engineering → Drainage adds culvert dimensions, inverts, cover
                checks and costs at these stations. Hydraulic capacity requires additional site inputs.
              </p>
            </SidebarSection>
            <SidebarSection title="Earthwork cost assumptions">
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ['cutRate', 'Cut ($/m³)'],
                    ['fillRate', 'Fill ($/m³)'],
                    ['surfacingRate', 'Surfacing ($/m³)'],
                    ['clearingRate', 'Clearing ($/m²)'],
                    ['shrinkFactor', 'Reusable cut factor'],
                  ] as const
                ).map(([key, label]) => (
                  <NumberField
                    key={key}
                    label={label}
                    value={project.settings[key]}
                    min={key === 'shrinkFactor' ? 0.1 : 0}
                    max={key === 'shrinkFactor' ? 2 : 10000}
                    onChange={(value) => update((x) => ({ ...x, settings: { ...x.settings, [key]: value } }))}
                  />
                ))}
              </div>
              <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                Base unit rates in CAD. Engineering inputs add material-specific excavation, structures, haul,
                borrow/waste, mobilization and contingency. Unassigned excavation uses this cut rate.
              </p>
              <Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => setTab('engineering')}>
                Materials, drainage & haul inputs
              </Button>
            </SidebarSection>
            <SidebarSection title="D-line / cable geometry">
              <Button variant="outline" size="sm" onClick={() => p.onMode('cable')}>
                Draw landing-to-tailhold line
              </Button>
              {project.cables.map((c) => (
                <div key={c.id} className="mt-2 space-y-2 rounded border p-2">
                  <div className="flex items-center justify-between">
                    <input
                      className={roadFieldClass}
                      aria-label="D-line name"
                      value={c.name}
                      maxLength={200}
                      onChange={(e) =>
                        update((x) => ({
                          ...x,
                          cables: x.cables.map((a) => (a.id === c.id ? { ...a, name: e.target.value } : a)),
                        }))
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      aria-label={`Remove ${c.name}`}
                      onClick={() => update((x) => ({ ...x, cables: x.cables.filter((a) => a.id !== c.id) }))}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                  <Field label="Yarder position">
                    <select
                      className={roadFieldClass}
                      value={c.yarderAt ?? 'start'}
                      onChange={(e) =>
                        update((x) => ({
                          ...x,
                          cables: x.cables.map((a) =>
                            a.id === c.id ? { ...a, yarderAt: e.target.value as 'start' | 'end' } : a,
                          ),
                        }))
                      }
                    >
                      <option value="start">Start endpoint</option>
                      <option value="end">End endpoint</option>
                    </select>
                  </Field>
                  <div className="grid grid-cols-3 gap-1">
                    {(['startHeight', 'endHeight', 'deflectionPercent'] as const).map((key) => (
                      <NumberField
                        key={key}
                        label={key === 'startHeight' ? 'Yarder m' : key === 'endHeight' ? 'Tailhold m' : 'Sag %'}
                        value={c[key]}
                        max={key === 'deflectionPercent' ? 25 : 100}
                        onChange={(value) =>
                          update((x) => ({
                            ...x,
                            cables: x.cables.map((a) => (a.id === c.id ? { ...a, [key]: value } : a)),
                          }))
                        }
                      />
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {(['startOffsetM', 'endOffsetM'] as const).map((key) => (
                      <NumberField
                        key={key}
                        label={key === 'startOffsetM' ? 'Start inset (m)' : 'End inset (m)'}
                        value={c[key] ?? 0}
                        min={-200}
                        max={200}
                        onChange={(value) =>
                          update((x) => ({
                            ...x,
                            cables: x.cables.map((a) => (a.id === c.id ? { ...a, [key]: value } : a)),
                          }))
                        }
                      />
                    ))}
                  </div>
                  <details className="rounded border p-2">
                    <summary className="cursor-pointer text-xs">Edit original endpoints</summary>
                    <div className="mt-2 grid grid-cols-2 gap-1">
                      {(['start', 'end'] as const).flatMap((endpoint) =>
                        ([0, 1] as const).map((axis) => (
                          <NumberField
                            key={`${endpoint}-${axis}`}
                            label={`${endpoint} ${axis === 0 ? 'longitude' : 'latitude'}`}
                            value={c[endpoint][axis]}
                            min={axis === 0 ? -180 : -84.999999}
                            max={axis === 0 ? 180 : 84.999999}
                            step={0.00001}
                            onChange={(value) =>
                              update((x) => ({
                                ...x,
                                cables: x.cables.map((a) =>
                                  a.id === c.id
                                    ? { ...a, [endpoint]: a[endpoint].map((n, i) => (i === axis ? value : n)) }
                                    : a,
                                ),
                              }))
                            }
                          />
                        )),
                      )}
                    </div>
                  </details>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      update((x) => ({
                        ...x,
                        cables: x.cables.map((a) =>
                          a.id === c.id
                            ? {
                                ...a,
                                start: a.end,
                                end: a.start,
                                startOffsetM: a.endOffsetM ?? 0,
                                endOffsetM: a.startOffsetM ?? 0,
                                yarderAt: a.yarderAt === 'end' ? 'start' : 'end',
                              }
                            : a,
                        ),
                      }))
                    }
                  >
                    Reverse line direction
                  </Button>
                </div>
              ))}
              <p className="mt-2 text-[11px] text-muted-foreground">
                Positive offsets inset supports; negative offsets extend the span. Heights follow the selected yarder
                and tailhold ends. Assumed parabolic sag screens clearance; it does not calculate tension or payload.
              </p>
            </SidebarSection>
          </div>

          <div hidden={tab !== 'files'} className="space-y-4">
            <SidebarSection title="Project & exports">
              <Field label="Project name">
                <input
                  className={roadFieldClass}
                  value={project.name}
                  maxLength={200}
                  onChange={(e) => update((x) => ({ ...x, name: e.target.value }))}
                />
              </Field>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" onClick={() => p.onFile('project')}>
                  Open project
                </Button>
                <Button size="sm" onClick={() => p.onSave('project')}>
                  Save project JSON
                </Button>
                <Button variant="outline" size="sm" onClick={() => p.onFile('alignment')}>
                  Import road lines
                </Button>
                <Button variant="outline" size="sm" onClick={() => p.onSave('geojson')}>
                  Export GeoJSON
                </Button>
                <Button variant="outline" size="sm" onClick={() => p.onSave('csv')}>
                  Station CSV
                </Button>
                <Button variant="outline" size="sm" onClick={() => p.onSave('report')}>
                  <Download className="mr-1 size-3" />
                  Print report
                </Button>
                <Button variant="outline" size="sm" onClick={() => p.onSave('landxml')}>
                  LandXML
                </Button>
                <Button variant="outline" size="sm" onClick={() => p.onSave('stakeout')}>
                  Stakeout CSV
                </Button>
                <Button variant="outline" size="sm" onClick={() => p.onSave('shapefile')}>
                  Shapefile (zip)
                </Button>
              </div>
              <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                LandXML 1.2 carries the fitted lines and arcs, the PVI profile with curves, the ground profile and
                cross- sections every 20 m. The stakeout file lists centreline, hinge, ditch and catch points with
                cut/fill every 20 m. Both use the terrain's projected CRS, or WGS84 UTM for a geographic source. The
                printed report adds a cross-section chapter.
              </p>
              <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                Projects preserve alternatives, PVIs, templates, context, profiles and terrain provenance. Imported DEM
                cells are included; published LiDAR is restored from its recorded checksum. Autosave stays on this
                device.
              </p>
            </SidebarSection>
            <SidebarSection title="Reference workflow">
              <p className="text-xs leading-5">
                Linked plan/profile/section and station editing follow the RoadEng examples. Road pegging, segment grade
                and stream profiles follow the Forsite LiDAR demonstrations. The computations here are documented,
                independently implemented planning methods.
              </p>
              <a
                className="mt-2 block text-xs text-primary underline"
                href="https://github.com/ahzs645/PGMaps/blob/codex/forestry-road-design/docs/forestry-road-design.md"
                target="_blank"
                rel="noreferrer"
              >
                Methods, reference mapping & calculation limits
              </a>
            </SidebarSection>
          </div>
        </div>
      </fieldset>
    </aside>
  )
}
