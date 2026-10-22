import { describe, expect, it } from 'vitest'
import { bboxOf, multiPolygonArea, rectangle } from './geometry'
import { buildDensityIndex, overlayCandidate } from './overlay'
import { DEFAULT_SETTINGS } from './report'
import { auditRatio, buildVriIndex, DEFAULT_VRI_RULES, shelfLife, vriDensity, vriFillCandidate, vriFillTotals, vriQueryUrl, type VriFeature } from './vriFill'
import type { Candidate, MultiPolygonCoords } from './types'

const box = (minX: number, minY: number, maxX: number, maxY: number): MultiPolygonCoords => [rectangle(minX, minY, maxX, maxY)]
const HA = 100

function vri(fid: number, geometry: MultiPolygonCoords, extra: Partial<VriFeature> = {}): VriFeature {
  return {
    fid, treed: true, age: 90, species: 'SX', projectedDate: '2025-12-31', disturbanceType: '', disturbanceYear: null,
    live: { 125: 210, 175: 200, 225: 150 }, dead: { 125: 25, 175: 20, 225: 10 },
    geometry, bbox: bboxOf(geometry), ...extra,
  }
}

describe('VRI fallback', () => {
  const AVAST_RULES = { ...DEFAULT_VRI_RULES, utilization: 175 as const, dead: 'full' as const }

  it('derives density the way AVAST derives CMM_m3ha', () => {
    const stand = vri(1, box(0, 0, HA, HA))
    expect(vriDensity(stand, AVAST_RULES)).toBe(220)
    expect(vriDensity(stand, { ...DEFAULT_VRI_RULES, dead: 'none', utilization: 125 })).toBe(210)
    expect(vriDensity({ ...stand, age: 45 }, AVAST_RULES)).toBe(0)
    expect(vriDensity({ ...stand, treed: false }, AVAST_RULES)).toBe(0)
    // Defaults: spruce at 17.5 cm, dead volume 10 years old (no recorded year) at shelf life.
    expect(vriDensity(stand, DEFAULT_VRI_RULES)).toBeCloseTo(200 + 20 * shelfLife(10), 10)
  })

  it('fills only where AVAST is absent or zero, and never double counts', () => {
    // 3 ha block: 1 ha AVAST at 150, 1 ha AVAST at 0, 1 ha with no AVAST.
    const geometry = box(0, 0, 3 * HA, HA)
    const block: Candidate = { key: 'B', id: 'B', operatingArea: '', sourceType: '', fieldHa: null, geometryHa: 3, geometry, bbox: bboxOf(geometry), sourceName: '' }
    const avast = buildDensityIndex([
      { fid: 1, density: 150, slopePercent: null, operatingArea: '', layerIndex: 0, geometry: box(0, 0, HA, HA), bbox: [0, 0, HA, HA] },
      { fid: 2, density: 0, slopePercent: null, operatingArea: '', layerIndex: 0, geometry: box(HA, 0, 2 * HA, HA), bbox: [HA, 0, 2 * HA, HA] },
    ])
    const { avastPieces } = overlayCandidate(block, avast, null, { source: 'none' }, { ...DEFAULT_SETTINGS, slopeSource: 'none' })
    const stands = [vri(10, box(-50, -50, 400, 150))]
    const pieces = vriFillCandidate(block, avastPieces, buildVriIndex(stands), 0.0001)
    expect(pieces.map((piece) => [piece.source, Number(piece.areaHa.toFixed(6))]).sort()).toEqual([['uncovered', 1], ['zero', 1]])
    expect(pieces.reduce((sum, piece) => sum + multiPolygonArea(piece.geometry), 0)).toBeCloseTo(2 * HA * HA, 3)

    const byFid = new Map(stands.map((stand) => [stand.fid, stand]))
    const totals = vriFillTotals(pieces, byFid, AVAST_RULES, 0.8)!.get('B')!
    expect(totals.uncoveredFillVolume).toBeCloseTo(220 * 0.8, 6)
    expect(totals.zeroFillVolume).toBeCloseTo(220 * 0.8, 6)
    const withoutZero = vriFillTotals(pieces, byFid, { ...AVAST_RULES, fillZeroAvast: false, applyFactor: false }, 0.8).get('B')!
    expect(withoutZero.zeroFillVolume).toBe(0)
    expect(withoutZero.uncoveredFillVolume).toBeCloseTo(220, 6)
  })

  it('queries VRI in BC Albers with the box in the CQL filter', () => {
    const url = new URL(vriQueryUrl([1200000, 950000, 1201000, 951000]))
    expect(url.searchParams.get('srsName')).toBe('EPSG:3005')
    expect(url.searchParams.get('CQL_FILTER')).toBe("BBOX(GEOMETRY,1200000.0,950000.0,1201000.0,951000.0,'EPSG:3005')")
    expect(url.searchParams.has('bbox')).toBe(false)
  })

  it('uses the Prince George pine rule, shelf life and audit ratios', () => {
    const pine = vri(2, box(0, 0, HA, HA), { species: 'PLI', disturbanceType: 'IBM', disturbanceYear: 2015 })
    const rules = { ...DEFAULT_VRI_RULES, utilization: 'species' as const, asOfYear: 2026 }
    expect(vriDensity(pine, { ...rules, dead: 'none' })).toBe(210)
    expect(vriDensity(vri(3, box(0, 0, HA, HA)), { ...rules, dead: 'none' })).toBe(200)
    expect(shelfLife(1)).toBe(1)
    expect(shelfLife(2)).toBeCloseTo(0.8, 10)
    expect(shelfLife(15)).toBeCloseTo(0.4, 10)
    expect(shelfLife(40)).toBe(0.4)
    // 11 years dead in 2026: 0.8 − 0.4 × 9/13.
    expect(vriDensity(pine, { ...rules, dead: 'shelf' })).toBeCloseTo(210 + 25 * (0.8 - (0.4 * 9) / 13), 10)
    expect(vriDensity({ ...pine, disturbanceYear: null }, { ...rules, dead: 'shelf', unknownDeathYears: 1 })).toBe(235)
    expect([auditRatio('PLI'), auditRatio('SX'), auditRatio('BL'), auditRatio('AT')]).toEqual([0.836, 0.946, 1.246, 1.159])
  })
})
