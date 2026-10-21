import { describe, expect, it } from 'vitest'
import { analyzeCable, distance } from './engine'
import { parseProject } from './project'
import { createDemoProject } from './terrain'
import {
  analyzeRadialDeflection,
  DEFAULT_RADIAL_SETTINGS,
  MAX_RADIAL_SPOKES,
  radialDeflectionGeoJson,
} from './radialDeflection'
import type { Coordinate, TerrainSource } from './types'

const center: Coordinate = [-122.72, 53.89]
const flat: TerrainSource = { elevationAt: () => 100 }
const settings = {
  ...DEFAULT_RADIAL_SETTINGS,
  radiusM: 100,
  bearingStepDeg: 90,
  yarderHeightM: 20,
  tailholdHeightM: 20,
  deflectionPercent: 10,
  minimumClearanceM: 10,
}

describe('radial landing geometry', () => {
  it('uses the individual cable model and finds the exact midpoint sag on flat terrain', () => {
    const result = analyzeRadialDeflection(center, flat, settings)
    expect(result.spokes.map((spoke) => spoke.bearingDeg)).toEqual([0, 90, 180, 270])
    for (const spoke of result.spokes) {
      expect(spoke.status).toBe('clear')
      expect(spoke.analysis.minClearance).toBeCloseTo(10, 6)
      expect(distance(spoke.line.start, spoke.line.end)).toBeCloseTo(100, 6)
      expect(spoke.analysis).toEqual(analyzeCable(spoke.line, flat))
    }
    const tighter = analyzeRadialDeflection(center, flat, { ...settings, minimumClearanceM: 10.5 })
    expect(tighter.spokes.every((spoke) => spoke.status === 'conflict')).toBe(true)
  })

  it('detects terrain conflicts between supports and never reports missing samples as clear', () => {
    const ridge: TerrainSource = {
      elevationAt: (lng, lat) => 100 + 25 * Math.exp(-(((distance(center, [lng, lat]) - 50) / 10) ** 2)),
    }
    const ridgeResult = analyzeRadialDeflection(center, ridge, { ...settings, minimumClearanceM: 0 })
    expect(ridgeResult.spokes.every((spoke) => spoke.status === 'conflict')).toBe(true)
    expect(ridgeResult.spokes[0].analysis.minClearance).toBeLessThan(-14)
    const hole: TerrainSource = {
      elevationAt: (lng, lat) => {
        const d = distance(center, [lng, lat])
        return d > 40 && d < 60 ? NaN : 100
      },
    }
    const incomplete = analyzeRadialDeflection(center, hole, settings)
    for (const spoke of incomplete.spokes) {
      expect(spoke.status).toBe('unknown')
      expect(spoke.analysis.minClearance).toBeNull()
      expect(spoke.knownCoveragePercent).toBeGreaterThan(0)
      expect(spoke.knownCoveragePercent).toBeLessThan(100)
    }
    const missingSupport = analyzeRadialDeflection(
      center,
      { elevationAt: (lng, lat) => (distance(center, [lng, lat]) < 0.001 ? NaN : 100) },
      settings,
    )
    for (const spoke of missingSupport.spokes) {
      expect(spoke.status).toBe('unknown')
      expect(spoke.analysis.minClearance).toBeNull()
      expect(spoke.analysis.samples.every((sample) => sample.clearance === null)).toBe(true)
      expect(spoke.knownCoveragePercent).toBeGreaterThan(90)
      expect(spoke.knownCoveragePercent).toBeLessThan(100)
    }
  })

  it('retains support clearance above a known parabolic valley', () => {
    const valley: TerrainSource = {
      elevationAt: (lng, lat) => {
        const t = distance(center, [lng, lat]) / settings.radiusM
        return 100 - 30 * 4 * t * (1 - t)
      },
    }
    const result = analyzeRadialDeflection(center, valley, { ...settings, minimumClearanceM: 20 })
    for (const spoke of result.spokes) {
      expect(spoke.status).toBe('clear')
      expect(spoke.analysis.minClearance).toBeCloseTo(20, 6)
      const midpoint = spoke.analysis.samples[Math.floor(spoke.analysis.samples.length / 2)]
      expect(midpoint.ground).toBeCloseTo(70, 6)
      expect(midpoint.cable).toBeCloseTo(110, 6)
      expect(midpoint.clearance).toBeCloseTo(40, 6)
    }
  })

  it('wraps partial sweeps through north, retains the final bearing, and caps the sampling budget', () => {
    const wrapped = analyzeRadialDeflection(center, flat, {
      ...settings,
      startBearingDeg: 350,
      sweepDeg: 25,
      bearingStepDeg: 10,
    })
    expect(wrapped.spokes.map((spoke) => spoke.bearingDeg)).toEqual([350, 0, 10, 15])
    let lookups = 0
    const limited = analyzeRadialDeflection(
      center,
      {
        elevationAt: () => {
          lookups++
          return 100
        },
      },
      { ...settings, radiusM: 2000, bearingStepDeg: 1 },
    )
    expect(limited.spokes).toHaveLength(MAX_RADIAL_SPOKES)
    expect(new Set(limited.spokes.map((spoke) => spoke.bearingDeg)).size).toBe(MAX_RADIAL_SPOKES)
    expect(limited.warnings.join(' ')).toMatch(/spacing increased/)
    expect(lookups).toBeLessThanOrEqual(72216)
  })

  it('rejects invalid coordinates and unbounded settings before sampling', () => {
    expect(() => analyzeRadialDeflection([1e6, 54], flat, settings)).toThrow(/WGS84/)
    expect(() => analyzeRadialDeflection(center, flat, { ...settings, radiusM: 2001 })).toThrow(/Radius/)
    expect(() => analyzeRadialDeflection(center, flat, { ...settings, bearingStepDeg: 0 })).toThrow(/Bearing step/)
    expect(() => analyzeRadialDeflection(center, flat, { ...settings, deflectionPercent: NaN })).toThrow(/sag/)
    expect(() => analyzeRadialDeflection(center, flat, { ...settings, tailholdHeightM: -1 })).toThrow(/Tailhold/)
  })

  it('exports selectable map spokes and a matching along-span cursor; adopted lines round-trip normally', () => {
    const result = analyzeRadialDeflection(center, flat, settings)
    const selected = result.spokes[1]
    const geo = radialDeflectionGeoJson(result, selected.id, 35)
    const lines = geo.features.filter((feature) => feature.geometry.type === 'LineString')
    expect(lines).toHaveLength(result.spokes.length)
    expect(lines.filter((feature) => feature.properties?.selected)).toHaveLength(1)
    expect(lines[1].properties).toMatchObject({ kind: 'radial-spoke', spokeId: selected.id, status: 'clear' })
    expect(lines[1].geometry).toEqual({ type: 'LineString', coordinates: [selected.line.start, selected.line.end] })
    const cursor = geo.features.find((feature) => feature.id === `${selected.id}-cursor`)!
    expect(cursor.geometry.type).toBe('Point')
    expect(distance(center, (cursor.geometry as GeoJSON.Point).coordinates as Coordinate)).toBeCloseTo(35, 6)
    const project = createDemoProject()
    project.cables.push(selected.line)
    const restored = parseProject(JSON.stringify(project))
    const restoredLine = restored.cables[restored.cables.length - 1]
    expect(restoredLine).toEqual(selected.line)
    expect(analyzeCable(restoredLine, flat)).toEqual(selected.analysis)
  })
})
