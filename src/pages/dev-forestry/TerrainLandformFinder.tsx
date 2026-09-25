import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { InlineAlert, KeyValueRows } from '@/components/ui/map-panels'

import { loadElevationGrid } from './demLoader'
import { landformFromTerrain, TERRAIN_LANDFORM_DEFAULTS, type LandformBoundary, type TerrainLandform } from './landformFromTerrain'
import { nearestPointOnLine } from './roadSnap'
import type { ForestryScene } from './scene'
import { findSceneLandform } from './sceneInput'
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
}

export type TerrainCandidate = TerrainLandform & {
  blockId: string
  blockName: string
  /** The block's geometry as read, so an edited block no longer matches its candidate. */
  blockGeometry: TargetPolygon['geometry']
}

/**
 * Step 1's other way to a landform: read the hillside the block sits on from
 * the terrain, as seen from the road (`landformFromTerrain.ts`). Like an
 * inventory unit it is a candidate — shown on the map, adopted only when the
 * reviewer says so.
 */
export function TerrainLandformFinder({
  scene,
  result,
  water,
  candidate,
  onCandidate,
  onAdopt,
  replaced = null,
  onUndo,
}: {
  scene: ForestryScene
  result: AnalysisResult | null
  water: ReadonlyArray<PolygonGeometry>
  candidate: TerrainCandidate | null
  onCandidate: (candidate: TerrainCandidate | null) => void
  onAdopt: (candidate: TerrainCandidate) => void
  /** The name of the landform the last adoption replaced, while it can still be put back. */
  replaced?: string | null
  onUndo?: () => void
}) {
  const blocks = scene.targets.filter((target) => target.role === 'block')
  const [blockId, setBlockId] = useState('')
  const block = blocks.find((entry) => entry.id === blockId) ?? blocks[0]
  const [status, setStatus] = useState<{ state: 'idle' | 'working' | 'failed'; message?: string }>({ state: 'idle' })
  const controller = useRef<AbortController | null>(null)
  // A read still loading when the step closes lands nowhere.
  useEffect(() => () => controller.current?.abort(), [])
  const road = scene.viewpoint.coordinates
  const activeLandform = findSceneLandform(scene)

  const suggest = async (target: TargetPolygon) => {
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    setStatus({ state: 'working' })
    onCandidate(null)
    try {
      const [west, south, east, north] = polygonBounds(target.geometry)
      const centre = { lng: (west + east) / 2, lat: (south + north) / 2 }
      // Read from the station the run assessed from; before a run, the point
      // on the road nearest the block.
      const station = result?.stations[result.assessmentStationIndex]
      const onRoad = road.length ? nearestPointOnLine(road, centre) : null
      const viewpoint = station ? { lng: station.lng, lat: station.lat } : onRoad ? { lng: onRoad.position[0], lat: onRoad.position[1] } : null
      if (!viewpoint) throw new Error('Draw the road or viewpoint first: a landform is the face seen from it.')
      const scale = metersPerDegree(centre.lat)
      const pad = TERRAIN_LANDFORM_DEFAULTS.radiusMeters + 500
      const range = demTileRange(
        [centre.lng - pad / scale.lng, centre.lat - pad / scale.lat, centre.lng + pad / scale.lng, centre.lat + pad / scale.lat],
        TERRAIN_ZOOM,
      )
      const { grid, missingTileCount } = await loadElevationGrid({ range, signal: abort.signal, concurrency: 4 })
      if (abort.signal.aborted) return
      const landform = landformFromTerrain(grid, target.geometry, viewpoint, { water })
      if (!landform) throw new Error('No terrain under this block.')
      onCandidate({ ...landform, blockId: target.id, blockName: target.name, blockGeometry: target.geometry })
      setStatus({
        state: 'idle',
        message: missingTileCount ? `${missingTileCount} terrain tiles did not load; the outline may stop short.` : undefined,
      })
    } catch (error) {
      if (abort.signal.aborted) return
      setStatus({ state: 'failed', message: error instanceof Error ? error.message : String(error) })
    }
  }

  const bounded = candidate
    ? (Object.entries(candidate.boundedBy) as Array<[LandformBoundary, number]>)
        .filter(([, share]) => share >= 0.01)
        .sort((a, b) => b[1] - a[1])
    : []

  return (
    <div className="space-y-2 rounded-lg border p-3 text-xs" aria-label="Landform from the terrain">
      <p className="font-medium text-foreground">From the terrain</p>
      <p className="text-muted-foreground">
        The hillside the block sits on, as seen from the road: grown out from the block until the ground turns away
        (a ridge, skyline or flank), flattens onto the valley floor or the top, meets a drainage of over{' '}
        {TERRAIN_LANDFORM_DEFAULTS.drainageAreaKm2} km², or reaches mapped water.
      </p>
      {blocks.length > 1 && (
        <select
          aria-label="Block to read the landform around"
          className="w-full rounded border bg-background p-1"
          value={block?.id}
          onChange={(event) => setBlockId(event.target.value)}
        >
          {blocks.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        disabled={!block || status.state === 'working'}
        onClick={() => block && void suggest(block)}
      >
        {status.state === 'working' ? 'Reading the terrain…' : 'Suggest the landform from the terrain'}
      </Button>
      {!block && <p className="text-muted-foreground">Add a cutblock first.</p>}
      {replaced && !candidate && (
        <InlineAlert tone="success">
          <span className="flex items-center justify-between gap-2">
            <span>Now assessing against the terrain landform. It replaced {replaced}.</span>
            {onUndo && (
              <Button type="button" variant="outline" size="sm" className="h-7 shrink-0 px-2 text-[11px]" onClick={onUndo}>
                Undo
              </Button>
            )}
          </span>
        </InlineAlert>
      )}
      {status.state === 'failed' && <InlineAlert tone="error">{status.message}</InlineAlert>}
      {candidate && (
        <div className="space-y-2" aria-label="Terrain landform candidate">
          <KeyValueRows
            variant="divided"
            rows={[
              { label: 'Around', value: candidate.blockName },
              { label: 'Area', value: `${Math.round(candidate.areaHectares).toLocaleString('en-CA')} ha` },
              ...bounded.map(([reason, share]) => ({ label: BOUNDARY_LABELS[reason], value: `${Math.round(share * 100)}% of the edge` })),
            ]}
          />
          {candidate.blockOnly && (
            <InlineAlert tone="warning">
              The terrain finds little hillside beyond the block itself — it sits on a valley floor or a narrow bank.
              A share of a landform means little here; judge the opening from the road, or draw the landform by hand.
            </InlineAlert>
          )}
          {candidate.viewerClose && (
            <InlineAlert tone="info">
              The road is within {TERRAIN_LANDFORM_DEFAULTS.closeViewerMeters / 1000} km of the block, so the face was
              read as the ground turned toward the road as a whole, not toward each point of it. From a road across
              the face much of that ground cannot be seen: trim the landform by hand to what reads as one hillside.
            </InlineAlert>
          )}
          {candidate.areaHectares > 1500 && (
            <InlineAlert tone="warning">
              Over 1,500 ha: a face this large usually runs past what reads as one landform from the road. Check its
              ends against the view before using it.
            </InlineAlert>
          )}
          {candidate.reachedLimit && (
            <InlineAlert tone="warning">
              The face runs past the {TERRAIN_LANDFORM_DEFAULTS.radiusMeters / 1000} km search area, so this outline
              is cut off there. Draw the landform's far end by hand if it matters.
            </InlineAlert>
          )}
          {status.message && <InlineAlert tone="warning">{status.message}</InlineAlert>}
          <p className="text-muted-foreground">
            Shown dashed on the map. A reading of the terrain, not a checked delineation: compare it with the view
            from the road before using it.
            {activeLandform ? ` Using it replaces ${activeLandform.name}; you can undo that.` : ''}
          </p>
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={candidate.blockOnly} onClick={() => onAdopt(candidate)}>
              Use this landform
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => onCandidate(null)}>
              Clear
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
