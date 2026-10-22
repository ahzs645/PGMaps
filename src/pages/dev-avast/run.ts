/**
 * Runs the overlay candidate by candidate so the page can draw each block as
 * it finishes. The DEM arrives through an injected factory, which keeps this
 * file free of DOM and network access and lets a test drive it with a
 * synthetic surface.
 */
import { buildDensityIndex, overlayCandidate, type CandidateOverlay, type SlopeContext } from './overlay'
import { slopeClassPolygons, slopeGrid, type AlbersElevation } from './slope'
import type { BBox, Candidate, DensityFeature, GeometrySettings } from './types'

export type ElevationFactory = (bbox: BBox) => Promise<{ elevationAt: AlbersElevation; missingTiles: number }>

export type CandidateResult = { index: number; total: number; candidate: Candidate; overlay: CandidateOverlay }

export async function runOverlay(options: {
  candidates: Candidate[]
  avast: DensityFeature[]
  lidar: DensityFeature[]
  settings: GeometrySettings
  elevation: ElevationFactory | null
  onCandidate: (result: CandidateResult) => void | Promise<void>
  signal?: AbortSignal
}) {
  const { candidates, settings, elevation, onCandidate, signal } = options
  const avast = buildDensityIndex(options.avast)
  const lidar = options.lidar.length ? buildDensityIndex(options.lidar) : null
  for (const [index, candidate] of candidates.entries()) {
    if (signal?.aborted) throw new DOMException('Run cancelled', 'AbortError')
    let slope: SlopeContext = { source: settings.slopeSource === 'attribute' ? 'attribute' : 'none' }
    const warnings: string[] = []
    if (settings.slopeSource === 'dem') {
      const pad = settings.slopeCellMeters * 2
      const box: BBox = [candidate.bbox[0] - pad, candidate.bbox[1] - pad, candidate.bbox[2] + pad, candidate.bbox[3] + pad]
      try {
        if (!elevation) throw new Error('No DEM source')
        const dem = await elevation(box)
        if (dem.missingTiles) warnings.push(`${dem.missingTiles} DEM tile${dem.missingTiles === 1 ? '' : 's'} failed to load for this block.`)
        const grid = slopeGrid(candidate.bbox, settings.slopeCellMeters, dem.elevationAt, settings.slopeBreaks)
        slope = { source: 'dem', classPolygons: slopeClassPolygons(grid) }
      } catch (error) {
        if (signal?.aborted) throw error
        warnings.push(`Slope could not be derived: ${error instanceof Error ? error.message : String(error)}`)
        slope = { source: 'dem', classPolygons: { 1: [], 2: [], 3: [] } }
      }
    }
    const overlay = overlayCandidate(candidate, avast, lidar, slope, settings)
    overlay.raw.warnings.unshift(...warnings)
    await onCandidate({ index, total: candidates.length, candidate, overlay })
  }
}
