import { CheckboxField, StyledSelect } from '@/components/ui/form-field'
import { Loader2, MapPin } from 'lucide-react'
import { ResultRow } from '@/components/ui/result-list'
import { useEffect, useRef, useState } from 'react'

import { ToolSection } from '@/components/ui/tool-section'
import { Button } from '@/components/ui/button'
import { InlineAlert, KeyValueRows } from '@/components/ui/map-panels'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { formatPercentValue } from '@/lib/format'
import { cn } from '@/lib/utils'

import { loadElevationGrid } from './demLoader'
import {
  landformFromTerrain,
  TERRAIN_LANDFORM_DEFAULTS,
  type LandformBoundary,
  type TerrainLandform,
} from './landformFromTerrain'
import {
  MAX_RIDGE_STATIONS,
  RIDGE_LAYER_DEFAULTS,
  ridgeLayerLandform,
  VISIBLE_FACE_DEFAULTS,
  visibleFaceLandform,
  type RidgeLayer,
} from './ridgeLayers'
import { nearestPointOnLine } from './roadSnap'
import type { ForestryScene } from './scene'
import { findSceneLandform } from './sceneInput'
import { formatHa, formatKm } from './measureFormat'
import { LANDFORM_METHOD_COLORS } from './planMapStyle'
import { demTileRange } from './terrain'
import type { AnalysisResult, TargetPolygon } from './types'
import { metersPerDegree, polygonBounds, type PolygonGeometry } from './visibility'

/** Zoom 12 is about 22 m a pixel here: finer than the 50 m grid the face is read on. */
const TERRAIN_ZOOM = 12

const BOUNDARY_LABELS: Record<LandformBoundary, string> = {
  'faces-away': 'Ground turns away (ridge, skyline or flank)',
  flat: 'Valley floor',
  'slope-break': 'Slope break above (plateau or wide bench)',
  drainage: 'Drainage',
  water: 'Shoreline',
  narrow: 'Narrow spur or notch',
  'no-data': 'No terrain',
  'search-limit': 'Edge of the search area',
  skyline: 'Skyline: the ground beyond drops out of view',
  'nearer-ridge': 'A nearer ridge in front',
}

export type TerrainCandidate = TerrainLandform & {
  blockId: string
  blockName: string
  /** The block's geometry as read, so an edited block no longer matches its candidate. */
  blockGeometry: TargetPolygon['geometry']
  /** How it was read: the face turned to the viewer, or the ridge layer seen from it. Absent is `facing`. */
  method?: LandformMethod
  /** Ridge layer only: the bands seen from the first station that sees the block, nearest first. */
  layers?: RidgeLayer[]
  stationsSeeing?: number
  stationCount?: number
  /** Where it was read from: "the road", an inventory viewpoint's name, or a picked point. */
  vantageName?: string
}

export type LandformMethod = 'facing' | 'ridge-layer' | 'visible-face'

export const LANDFORM_METHOD_LABELS: Record<LandformMethod, string> = {
  'visible-face': 'Visible face from the viewpoint',
  'ridge-layer': 'Ridge layer seen',
  facing: 'Face turned to the view',
}
const METHODS: LandformMethod[] = ['visible-face', 'ridge-layer', 'facing']

/** A place to read the landform from other than the road: an inventory viewpoint or rec site. */
export type LandformVantage = {
  key: string
  name: string
  lng: number
  lat: number
  /** One line under the name: kind, distance and side of the block, arrows. */
  summary?: string
}

/** The point a reading is taken from, for the map to mark; null for the road, which is already drawn. */
export type LandformVantagePoint = { lng: number; lat: number; label: string; picking?: boolean }

/** Inventory rows listed before *Show all*. */
const VANTAGES_SHOWN = 6

type Vantage = { kind: 'road' } | { kind: 'viewpoint'; key: string } | { kind: 'pick'; point: [number, number] | null }

const methodOf = (candidate: TerrainCandidate): LandformMethod => candidate.method ?? 'facing'

/**
 * Step 1's other way to a landform: read the hillside the block sits on from
 * the terrain (`landformFromTerrain.ts`, `ridgeLayers.ts`). One read gives both
 * readings — the ridge layer seen and the face turned to the view — side by
 * side on the map, from the road, an inventory viewpoint, or a point the
 * reviewer picks. Like an inventory unit each is a candidate: shown on the
 * map, adopted only when the reviewer says so.
 */
export function TerrainLandformFinder({
  scene,
  result,
  water,
  candidates,
  focused,
  onCandidates,
  onFocus,
  onAdopt,
  vantages = [],
  onPickPoint,
  replaced = null,
  onUndo,
  vantagesStatus = 'idle',
  onLoadVantages,
  onVantagePoint,
  pickActive = true,
}: {
  scene: ForestryScene
  result: AnalysisResult | null
  water: ReadonlyArray<PolygonGeometry>
  /** Both readings once read, each drawn on the map. */
  candidates: TerrainCandidate[]
  /** The reading in front: drawn solid, with its ridge layers, and the one *Use* adopts. */
  focused: LandformMethod
  onCandidates: (candidates: TerrainCandidate[]) => void
  onFocus: (method: LandformMethod) => void
  onAdopt: (candidate: TerrainCandidate) => void
  /** Inventory viewpoints and rec sites near the block, to read the landform from instead of the road. */
  vantages?: ReadonlyArray<LandformVantage>
  /** Asks the map for one click; the point comes back through `onPoint`. Null cancels. */
  onPickPoint?: (onPoint: ((point: [number, number]) => void) | null) => void
  /** The name of the landform the last adoption replaced, while it can still be put back. */
  replaced?: string | null
  onUndo?: () => void
  /** The viewpoint inventory's load, so the list can be read in here without the section above. */
  vantagesStatus?: 'idle' | 'loading' | 'ready' | 'error'
  onLoadVantages?: () => void
  /** Where the reading is taken from, for the map to mark: a picked point or a viewpoint. */
  onVantagePoint?: (point: LandformVantagePoint | null) => void
  /** Whether the map is still waiting for the point asked for. */
  pickActive?: boolean
}) {
  const blocks = scene.targets.filter((target) => target.role === 'block')
  const [blockId, setBlockId] = useState('')
  const block = blocks.find((entry) => entry.id === blockId) ?? blocks[0]
  const [status, setStatus] = useState<{ state: 'idle' | 'working' | 'failed'; message?: string }>({ state: 'idle' })
  const [vantage, setVantage] = useState<Vantage>({ kind: 'road' })
  const [pickRequested, setPicking] = useState(false)
  // The visible face's two study options (docs/forestry-visual-quality.md): each helped some sheets
  // and hurt others, so both start off.
  const [stopAtFirstCrest, setStopAtFirstCrest] = useState<boolean>(VISIBLE_FACE_DEFAULTS.stopAtFirstCrest)
  const [splitAtDraws, setSplitAtDraws] = useState<boolean>(VISIBLE_FACE_DEFAULTS.splitAtDraws)
  // The map's own Cancel ends a pick too.
  const picking = pickRequested && pickActive
  const controller = useRef<AbortController | null>(null)
  // A read still loading when the step closes lands nowhere, and a pick still open is cancelled.
  useEffect(
    () => () => {
      controller.current?.abort()
    },
    [],
  )
  const road = scene.viewpoint.coordinates
  const activeLandform = findSceneLandform(scene)
  const chosenViewpoint = vantage.kind === 'viewpoint' ? vantages.find((entry) => entry.key === vantage.key) : null
  const [allVantages, setAllVantages] = useState(false)

  // The map marks where the reading is taken from, and clears the mark when this closes.
  const markLng = vantage.kind === 'pick' ? vantage.point?.[0] : chosenViewpoint?.lng
  const markLat = vantage.kind === 'pick' ? vantage.point?.[1] : chosenViewpoint?.lat
  const markLabel = vantage.kind === 'pick' ? 'Landform read from here' : (chosenViewpoint?.name ?? '')
  useEffect(() => {
    onVantagePoint?.(markLng != null && markLat != null ? { lng: markLng, lat: markLat, label: markLabel } : null)
  }, [onVantagePoint, markLng, markLat, markLabel])
  useEffect(() => () => onVantagePoint?.(null), [onVantagePoint])

  const pick = () => {
    if (!onPickPoint) return
    setPicking(true)
    onPickPoint((point) => {
      setPicking(false)
      setVantage({ kind: 'pick', point })
      onCandidates([])
    })
  }
  const cancelPick = () => {
    setPicking(false)
    onPickPoint?.(null)
  }

  const suggest = async (target: TargetPolygon) => {
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    setStatus({ state: 'working' })
    onCandidates([])
    try {
      const [west, south, east, north] = polygonBounds(target.geometry)
      const centre = { lng: (west + east) / 2, lat: (south + north) / 2 }
      // From the road: the station the run assessed from, or before a run the
      // point on the road nearest the block; the ridge layer joins the views
      // from every station along it. From a chosen point, both read from it alone.
      const station = result?.stations[result.assessmentStationIndex]
      const onRoad = road.length ? nearestPointOnLine(road, centre) : null
      const chosen =
        vantage.kind === 'viewpoint'
          ? chosenViewpoint
            ? { lng: chosenViewpoint.lng, lat: chosenViewpoint.lat }
            : null
          : vantage.kind === 'pick'
            ? vantage.point && { lng: vantage.point[0], lat: vantage.point[1] }
            : null
      if (vantage.kind !== 'road' && !chosen) throw new Error('Choose the point to read the landform from first.')
      const viewpoint =
        chosen ??
        (station
          ? { lng: station.lng, lat: station.lat }
          : onRoad
            ? { lng: onRoad.position[0], lat: onRoad.position[1] }
            : null)
      if (!viewpoint) throw new Error('Draw the road or viewpoint first: a landform is the face seen from it.')
      const ridgeStations = chosen
        ? [viewpoint]
        : result && result.stations.length > 1
          ? result.stations.map((entry) => ({ lng: entry.lng, lat: entry.lat }))
          : road.length > 1
            ? road.map(([lng, lat]) => ({ lng, lat }))
            : [viewpoint]
      const vantageName =
        vantage.kind === 'viewpoint'
          ? (chosenViewpoint?.name ?? 'a viewpoint')
          : vantage.kind === 'pick'
            ? 'a point on the map'
            : 'the road'
      const scale = metersPerDegree(centre.lat)
      // One terrain load serves both readings: the wider of their search areas.
      const pad = Math.max(RIDGE_LAYER_DEFAULTS.radiusMeters, TERRAIN_LANDFORM_DEFAULTS.radiusMeters) + 500
      const box: [number, number, number, number] = [
        centre.lng - pad / scale.lng,
        centre.lat - pad / scale.lat,
        centre.lng + pad / scale.lng,
        centre.lat + pad / scale.lat,
      ]
      // The rays run from the stations, so their ground has to be loaded too.
      for (const entry of [...ridgeStations, viewpoint]) {
        box[0] = Math.min(box[0], entry.lng - 0.01)
        box[1] = Math.min(box[1], entry.lat - 0.01)
        box[2] = Math.max(box[2], entry.lng + 0.01)
        box[3] = Math.max(box[3], entry.lat + 0.01)
      }
      const range = demTileRange(box, TERRAIN_ZOOM)
      const { grid, missingTileCount } = await loadElevationGrid({ range, signal: abort.signal, concurrency: 4 })
      if (abort.signal.aborted) return
      const base = { blockId: target.id, blockName: target.name, blockGeometry: target.geometry, vantageName }
      const found: TerrainCandidate[] = []
      const ridge = ridgeLayerLandform(grid, target.geometry, ridgeStations, {
        eyeHeightMeters: scene.settings.observerHeightMeters,
      })
      if (ridge) found.push({ ...ridge, ...base })
      // The visible face reads from one station only: the assessment viewpoint, as a planner renders it.
      const visible = visibleFaceLandform(grid, target.geometry, viewpoint, {
        water,
        eyeHeightMeters: scene.settings.observerHeightMeters,
        stopAtFirstCrest,
        splitAtDraws,
      })
      if (visible) found.push({ ...visible, ...base })
      const face = landformFromTerrain(grid, target.geometry, viewpoint, { water })
      if (face) found.push({ ...face, method: 'facing', ...base })
      if (!found.length) throw new Error('No terrain under this block.')
      onCandidates(found)
      // Keep the reader's choice in front when it was found; otherwise the one that was.
      if (!found.some((entry) => methodOf(entry) === focused)) onFocus(methodOf(found[0]))
      const notes = [
        !ridge &&
          `No ${chosen ? 'view from there' : 'station on the road'} sees this block over the bare ground, so no ridge layer holds it.`,
        missingTileCount ? `${missingTileCount} terrain tiles did not load; the outlines may stop short.` : null,
      ].filter(Boolean)
      setStatus({ state: 'idle', message: notes.length ? notes.join(' ') : undefined })
    } catch (error) {
      if (abort.signal.aborted) return
      setStatus({ state: 'failed', message: error instanceof Error ? error.message : String(error) })
    }
  }

  const byMethod = (method: LandformMethod) => candidates.find((entry) => methodOf(entry) === method) ?? null
  const candidate = byMethod(focused) ?? candidates[0] ?? null
  const choose = (next: Vantage) => {
    onCandidates([])
    if (picking && next.kind !== 'pick') cancelPick()
    setVantage(next)
  }
  const shownVantages = allVantages ? vantages : vantages.slice(0, VANTAGES_SHOWN)
  const edgeSummary = (entry: TerrainCandidate | null) => {
    if (!entry) return '—'
    const top = (Object.entries(entry.boundedBy) as Array<[LandformBoundary, number]>)
      .filter(([, share]) => share >= 0.01)
      .sort((a, b) => b[1] - a[1])[0]
    return top ? `${BOUNDARY_LABELS[top[0]]} · ${formatPercentValue(top[1] * 100, { maximumFractionDigits: 0 })}` : '—'
  }
  const ridgeLayerOf = (entry: TerrainCandidate | null) => {
    const layers = entry?.layers ?? []
    const own = layers.findIndex((layer) => layer.containsBlock) + 1
    return own ? `${own} of ${layers.length}` : '—'
  }
  const bounded = candidate
    ? (Object.entries(candidate.boundedBy) as Array<[LandformBoundary, number]>)
        .filter(([, share]) => share >= 0.01)
        .sort((a, b) => b[1] - a[1])
    : []

  return (
    <ToolSection
      title="Find a landform from the terrain"
      summary={
        candidates.length
          ? candidates
              .map((entry) => `${LANDFORM_METHOD_LABELS[methodOf(entry)]} ${formatHa(entry.areaHectares * 10_000, 0)}`)
              .join(' · ')
          : 'Visible face, ridge layer and face, side by side'
      }
      help={
        <>
          Three readings at once, drawn on the map side by side. <b>Visible face from the viewpoint</b>: the face of one
          ridge mass as a planner draws it on a VIA sheet, read from the one viewpoint: bounded below by the shoreline
          where the view crosses water (water is never landform) and by the foreground within{' '}
          {VISIBLE_FACE_DEFAULTS.nearMeters} m, above by the skyline of that ridge mass (a farther ridge seen behind is
          another landform), and at the sides by a {VISIBLE_FACE_DEFAULTS.hfovDeg}° viewing frame. A hidden block takes
          the face in front of it. Stopping at the first crest and splitting at draws are off by default: each helped
          some sheets in the November 2026 study and hurt others. <b>Ridge layer seen</b>: the layer of ridge the block
          sits in, as the view sees the hills stack up — the visible ground joined to the block&apos;s, stopped where a
          nearer ridge hides what lies in front and where the ground drops out of view behind. From the road it is read
          from up to {MAX_RIDGE_STATIONS} stations and joined, as the block is seen driving past.{' '}
          <b>Face turned to the view</b>: the hillside the block sits on, grown out from the block until the ground
          turns away (a ridge, skyline or flank), flattens onto the valley floor or the top, meets a drainage of over{' '}
          {TERRAIN_LANDFORM_DEFAULTS.drainageAreaKm2} km², or reaches mapped water. Read from an inventory viewpoint or
          a point you pick to see the landform as it reads from there.
        </>
      }
      toggleProps={{ 'data-forestry-disclosure': 'terrain-landform' }}
      defaultOpen={candidates.length > 0}
      className="text-xs"
    >
      <div role="radiogroup" aria-label="Read the landform from" className="space-y-1">
        <span className="block text-2xs font-medium text-muted-foreground">Read from</span>
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
          <li>
            <ResultRow
              role="radio"
              aria-pressed={undefined}
              aria-checked={vantage.kind === 'road'}
              className="px-2 py-1.5"
              selected={vantage.kind === 'road'}
              onClick={() => choose({ kind: 'road' })}
              title={<span className="text-xs">The road</span>}
              subtitle={
                <span className="text-3xs">
                  {road.length ? 'Every station that sees the block' : 'Draw the road first'}
                </span>
              }
            />
          </li>
          {onPickPoint && (
            <li>
              <div className="flex items-center">
                <ResultRow
                  role="radio"
                  aria-pressed={undefined}
                  aria-checked={vantage.kind === 'pick'}
                  className="min-w-0 flex-1 px-2 py-1.5"
                  selected={vantage.kind === 'pick'}
                  onClick={() => {
                    if (vantage.kind === 'pick' && vantage.point) return
                    choose({ kind: 'pick', point: null })
                    pick()
                  }}
                  title={<span className="text-xs">A point I pick on the map</span>}
                  subtitle={
                    <span className={cn('text-3xs', picking && 'font-medium text-sky-700 dark:text-sky-300')}>
                      {picking
                        ? 'Click the map where the landform is seen from…'
                        : vantage.kind === 'pick' && vantage.point
                          ? `${vantage.point[1].toFixed(4)}, ${vantage.point[0].toFixed(4)} · marked on the map`
                          : 'Stand anywhere, e.g. a lookout or a lake'}
                    </span>
                  }
                />
                {vantage.kind === 'pick' && (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    className="mr-1.5 shrink-0 text-2xs"
                    onClick={picking ? cancelPick : pick}
                  >
                    {picking ? 'Cancel' : vantage.point ? 'Pick again' : 'Pick'}
                  </Button>
                )}
              </div>
            </li>
          )}
          {shownVantages.map((entry) => (
            <li key={entry.key}>
              <ResultRow
                role="radio"
                aria-pressed={undefined}
                aria-checked={vantage.kind === 'viewpoint' && vantage.key === entry.key}
                className="px-2 py-1.5"
                selected={vantage.kind === 'viewpoint' && vantage.key === entry.key}
                onClick={() => choose({ kind: 'viewpoint', key: entry.key })}
                title={<span className="text-xs">{entry.name}</span>}
                subtitle={
                  entry.summary && <span className="whitespace-normal text-3xs leading-4">{entry.summary}</span>
                }
              />
            </li>
          ))}
        </ul>
        {vantages.length > VANTAGES_SHOWN && (
          <button
            type="button"
            className="text-2xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            onClick={() => setAllVantages(!allVantages)}
          >
            {allVantages ? 'Show fewer' : `Show all ${vantages.length} viewpoints and rec sites`}
          </button>
        )}
        {!vantages.length && (
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 text-3xs leading-4 text-muted-foreground">
              {vantagesStatus === 'ready'
                ? 'No inventory viewpoint or rec site within 12 km.'
                : vantagesStatus === 'error'
                  ? 'DataBC viewpoints did not load.'
                  : 'Or read it from a BC inventory viewpoint or rec site near the block.'}
            </span>
            {onLoadVantages && vantagesStatus !== 'ready' && (
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="shrink-0 text-2xs"
                disabled={vantagesStatus === 'loading' || !block}
                onClick={onLoadVantages}
              >
                {vantagesStatus === 'loading' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <MapPin className="h-3.5 w-3.5" />
                )}
                {vantagesStatus === 'loading'
                  ? 'Reading DataBC…'
                  : vantagesStatus === 'error'
                    ? 'Retry'
                    : 'Load viewpoints'}
              </Button>
            )}
          </div>
        )}
      </div>
      {blocks.length > 1 && (
        <StyledSelect
          aria-label="Block to read the landform around"
          className="w-full rounded-md border bg-background p-1"
          value={block?.id}
          onChange={(event) => setBlockId(event.target.value)}
        >
          {blocks.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </StyledSelect>
      )}
      <div className="space-y-1" role="group" aria-label="Visible face options">
        <CheckboxField
          label="Visible face: stop at the first crest"
          checked={stopAtFirstCrest}
          onCheckedChange={setStopAtFirstCrest}
        />
        <CheckboxField
          label="Visible face: split at major draws"
          checked={splitAtDraws}
          onCheckedChange={setSplitAtDraws}
        />
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        disabled={!block || status.state === 'working' || (vantage.kind === 'pick' && !vantage.point)}
        onClick={() => block && void suggest(block)}
      >
        {status.state === 'working' ? 'Reading the terrain…' : 'Suggest landforms from the terrain'}
      </Button>
      {!block && <p className="text-muted-foreground">Add a cutblock first.</p>}
      {replaced && !candidates.length && (
        <InlineAlert tone="success">
          <span className="flex items-center justify-between gap-2">
            <span>Now assessing against the terrain landform. It replaced {replaced}.</span>
            {onUndo && (
              <Button type="button" variant="outline" size="xs" className="shrink-0 text-2xs" onClick={onUndo}>
                Undo
              </Button>
            )}
          </span>
        </InlineAlert>
      )}
      {status.state === 'failed' && <InlineAlert tone="error">{status.message}</InlineAlert>}
      {candidates.length > 0 && candidate && (
        <div className="space-y-2" aria-label="Terrain landform candidates">
          {/* Both readings side by side; the one in front is drawn solid on the map. */}
          <SegmentedControl
            label="Landform in front"
            size="sm"
            value={methodOf(candidate)}
            options={METHODS.map((method) => ({
              value: method,
              label: LANDFORM_METHOD_LABELS[method],
              disabled: !byMethod(method),
            }))}
            onChange={onFocus}
          />
          <table className="w-full table-fixed text-2xs" aria-label="Landform readings compared">
            <thead>
              <tr className="text-muted-foreground">
                <th className="w-1/3 py-1 text-left font-normal" scope="col">
                  <span className="sr-only">Measure</span>
                </th>
                {METHODS.map((method) => (
                  <th
                    key={method}
                    scope="col"
                    className={cn(
                      'py-1 text-left font-medium',
                      methodOf(candidate) === method ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    <span
                      className="mr-1 inline-block h-2 w-2 rounded-sm align-middle"
                      style={{ backgroundColor: LANDFORM_METHOD_COLORS[method] }}
                    />
                    {LANDFORM_METHOD_LABELS[method]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {(
                [
                  ['Area', (entry) => (entry ? formatHa(entry.areaHectares * 10_000, 0) : 'Not found')],
                  [
                    'Seen from',
                    (entry) =>
                      entry?.stationCount
                        ? `${entry.stationsSeeing} of ${entry.stationCount} stations`
                        : (entry?.vantageName ?? '—'),
                  ],
                  ['Ridge layer', (entry) => (entry ? ridgeLayerOf(entry) : '—')],
                  ['Main edge', edgeSummary],
                ] as Array<[string, (entry: TerrainCandidate | null) => string]>
              ).map(([label, read]) => (
                <tr key={label}>
                  <th scope="row" className="py-1 pr-2 text-left font-normal text-muted-foreground">
                    {label}
                  </th>
                  {METHODS.map((method) => (
                    <td key={method} className="py-1 pr-1 align-top">
                      {read(byMethod(method))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {bounded.length > 1 && (
            <KeyValueRows
              variant="divided"
              rows={bounded.map(([reason, share]) => ({
                label: BOUNDARY_LABELS[reason],
                value: `${formatPercentValue(share * 100, { maximumFractionDigits: 0 })} of the edge`,
              }))}
            />
          )}
          {candidate.blockOnly && (
            <InlineAlert tone="warning">
              The terrain finds little hillside beyond the block itself — it sits on a valley floor or a narrow bank. A
              share of a landform means little here; judge the opening from the view, or draw the landform by hand.
            </InlineAlert>
          )}
          {candidate.viewerClose && (
            <InlineAlert tone="info">
              The view is within {formatKm(TERRAIN_LANDFORM_DEFAULTS.closeViewerMeters, 1)} of the block, so the face
              was read as the ground turned toward it as a whole, not toward each point of it. Much of that ground may
              not be seen: trim the landform by hand to what reads as one hillside.
            </InlineAlert>
          )}
          {candidate.areaHectares > 1500 && (
            <InlineAlert tone="warning">
              Over 1,500 ha: a face this large usually runs past what reads as one landform from the view. Check its
              ends against the view before using it.
            </InlineAlert>
          )}
          {candidate.reachedLimit && (
            <InlineAlert tone="warning">
              The face runs past the {formatKm(TERRAIN_LANDFORM_DEFAULTS.radiusMeters, 0)} search area, so this outline
              is cut off there. Draw the landform&apos;s far end by hand if it matters.
            </InlineAlert>
          )}
          {status.message && <InlineAlert tone="warning">{status.message}</InlineAlert>}
          <p className="text-3xs leading-4 text-muted-foreground">
            Both are drawn dashed on the map, the one in front solid
            {methodOf(candidate) === 'ridge-layer' ? ', with the other ridge layers outlined' : ''}. Readings of the
            terrain from {candidate.vantageName ?? 'the road'}, not checked delineations: compare them with the view
            before using one.
            {activeLandform ? ` Using one replaces ${activeLandform.name}; you can undo that.` : ''}
          </p>
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={candidate.blockOnly} onClick={() => onAdopt(candidate)}>
              Use the {LANDFORM_METHOD_LABELS[methodOf(candidate)].toLowerCase()}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => onCandidates([])}>
              Clear
            </Button>
          </div>
        </div>
      )}
    </ToolSection>
  )
}
