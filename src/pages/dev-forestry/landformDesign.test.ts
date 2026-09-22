import { describe, expect, it } from 'vitest'
import { alterationWeight } from './integrity'
import { terrainPosition } from './landformDesign'
import { computeAnalysis } from './analysis'
import { DEFAULT_ANALYSIS_SETTINGS, type AnalysisInput } from './types'
import { metersPerDegree } from './visibility'

const scale = metersPerDegree(0)
const dem = (f: (x: number, y: number) => number) => ({ elevationAt: (lng: number, lat: number) => f(lng * scale.lng, lat * scale.lat) })
const box = (x0: number, y0: number, x1: number, y1: number): GeoJSON.Polygon => ({ type: 'Polygon', coordinates: [[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]].map(([x,y]) => [x / scale.lng,y / scale.lat])] })

describe('landform design terrain cues', () => {
  it('distinguishes a hillside, convex ridge, hollow and saddle', () => {
    expect(terrainPosition(dem((x,y) => x * .5 + y * .1), 0, 0)).toBe('slope')
    expect(terrainPosition(dem(x => 100 - x*x / 1000), 0, 0)).toBe('ridge')
    expect(terrainPosition(dem(x => 100 + x*x / 1000), 0, 0)).toBe('hollow')
    expect(terrainPosition(dem((x,y) => (x*x-y*y) / 1000), 0, 0)).toBe('saddle')
  })
  it('treats proposals as full harvest while retaining historical harvest and recovery shares', () => {
    const t = { harvestYear: 2020, clearcutPercent: 40, recoveryPercent: 50 }
    expect(alterationWeight({ ...t, role: 'block' }, 2026, 15)).toBe(1)
    expect(alterationWeight({ ...t, role: 'harvested' }, 2026, 15)).toBe(.2)
  })
  it('keeps missing neighbourhood elevations unknown', () => {
    expect(terrainPosition(dem(x => x > 100 ? NaN : 100 - x*x / 1000), 0, 0)).toBe('unknown')
  })
  it('shows a facing opening and a crest opening, but hides one behind the crest', () => {
    // Road at x=-800 looks east at a 200m triangular ridge at x=0.
    const source = dem(x => Math.max(0, 200 - Math.abs(x) * .25))
    const input: AnalysisInput = {
      viewpoint: { mode: 'corridor', coordinates: [[-900/scale.lng,-150/scale.lat],[-900/scale.lng,150/scale.lat]] },
      assessmentYear: 2026, activeLandformId: 'hill',
      settings: { ...DEFAULT_ANALYSIS_SETTINGS, sampleBudget: 400, observerHeightMeters: 1.6, screeningEnabled: false, maxViewDistanceMeters: 5000, stationSpacingMeters: 100 },
      targets: [
        { id: 'hill', role: 'landscape' as const, geometry: box(-800,-600,800,600) },
        { id: 'face', role: 'block' as const, geometry: box(-450,-100,-250,100) },
        { id: 'crest', role: 'block' as const, geometry: box(-40,-100,40,100) },
        { id: 'behind', role: 'block' as const, geometry: box(250,-100,450,100) },
      ].map(t => ({ ...t, name: t.id, harvestYear: null, clearcutPercent: null })),
    }
    const result = computeAnalysis(source, input, { tileCount: 1, missingTileCount: 0, resolutionMeters: 10 })
    const [face, crest, behind] = result.landformDesign!.blocks
    expect(face.visibleStations).toBe(result.stations.length)
    expect(crest.visibleStations).toBeGreaterThan(0)
    expect(crest.ridgeSamples).toBeGreaterThan(0)
    expect(crest.silhouetteStations.length).toBeGreaterThan(0)
    expect(behind.visibleStations).toBe(0)
    expect(behind.silhouetteStations).toEqual([])
    expect(behind.mostVisibleStation).toBeNull()
    expect(result.landformDesign!.markers.some(m => m.position === 'ridge')).toBe(true)
    const withoutLand = computeAnalysis(source, { ...input, activeLandformId: null, targets: input.targets.filter(t => t.role !== 'landscape') }, { tileCount: 1, missingTileCount: 0, resolutionMeters: 10 })
    expect(withoutLand.landformDesign).toBeNull()
  })
})
