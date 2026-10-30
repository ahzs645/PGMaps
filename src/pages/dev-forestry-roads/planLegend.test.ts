import { describe, expect, it } from 'vitest'
import { buildPlanLegend, PLAN_CONTEXT_STYLES, type PlanLegendSources } from './planLegend'
import { createDemoProject } from './terrain'

const line = (properties: Record<string, unknown> = {}): GeoJSON.Feature => ({
  type: 'Feature',
  geometry: {
    type: 'LineString',
    coordinates: [
      [-122.7, 53.9],
      [-122.71, 53.91],
    ],
  },
  properties,
})
const point = (properties: Record<string, unknown> = {}): GeoJSON.Feature => ({
  ...line(properties),
  geometry: { type: 'Point', coordinates: [-122.7, 53.9] },
})
const area = (properties: Record<string, unknown> = {}): GeoJSON.Feature => ({
  ...line(properties),
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [-122.7, 53.9],
        [-122.71, 53.91],
        [-122.71, 53.9],
        [-122.7, 53.9],
      ],
    ],
  },
})
const fc = (...features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features })
const sources = (patch: Partial<PlanLegendSources> = {}): PlanLegendSources => ({
  roads: fc(),
  context: fc(),
  corridor: fc(),
  formation: fc(),
  edges: fc(),
  ditches: fc(),
  cable: fc(),
  structures: fc(),
  draft: fc(),
  section: fc(),
  ticks: fc(),
  ...patch,
})
const build = (data: PlanLegendSources, patch: Partial<Parameters<typeof buildPlanLegend>[0]> = {}) =>
  buildPlanLegend({
    sources: data,
    alignments: createDemoProject().alignments,
    maxGradePercent: 12,
    terrainOnly: false,
    showEarthwork: true,
    ...patch,
  })
const entries = (result: ReturnType<typeof build>) => result.flatMap((section) => section.entries)

describe('plan legend follows rendered data', () => {
  it('includes actual alternate-road colours and every present context kind without inventing unused road states', () => {
    const project = createDemoProject()
    const other = project.alignments[1]
    const result = entries(
      build(
        sources({
          roads: fc(line({ selected: true, color: '#d97706' }), line({ id: other.id, color: other.color })),
          context: fc(
            line({ kind: 'stream' }),
            line({ kind: 'existing-road' }),
            area({ kind: 'harvest' }),
            area({ kind: 'avoid' }),
          ),
        }),
      ),
    )
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: `Alternative · ${other.name}`, color: other.color, shape: 'line' }),
        expect.objectContaining({ label: 'Harvest areas', color: PLAN_CONTEXT_STYLES.harvest.color, shape: 'area' }),
        expect.objectContaining({ label: 'Existing roads', shape: 'dashed-line' }),
        expect.objectContaining({ label: 'Review areas', shape: 'area' }),
        expect.objectContaining({ label: 'Streams', shape: 'dashed-line' }),
      ]),
    )
    expect(result.some((entry) => entry.label === 'No terrain under it' || entry.label.startsWith('Over '))).toBe(false)
    const emptyLine = { ...line({ id: other.id }), geometry: { type: 'LineString' as const, coordinates: [] } }
    expect(build(sources({ roads: fc(emptyLine) }))).toEqual([])
  })
  it('tracks active grade states and drops terrain-dependent earthwork styles when that layer is hidden', () => {
    const data = sources({
      roads: fc(line({ selected: true, color: '#dc2626' }), line({ selected: true, color: '#9ca3af' })),
      corridor: fc(area({ color: '#3b82f6', beyond: false }), area({ color: '#dc2626', beyond: true })),
      formation: fc(area()),
      edges: fc(line()),
      ditches: fc(line()),
    })
    const all = entries(build(data, { maxGradePercent: 9 }))
    expect(all.map((entry) => entry.label)).toContain('Over 9% grade')
    expect(all.map((entry) => entry.label)).toContain('Mostly fill')
    expect(all.map((entry) => entry.label)).not.toContain('Mostly cut')
    expect(build(data, { showEarthwork: false }).map((section) => section.id)).not.toContain('earthwork')
    expect(build(data, { terrainOnly: true }).map((section) => section.id)).not.toContain('earthwork')
    expect(entries(build(data, { terrainOnly: true })).some((entry) => entry.label === 'Terrain transect')).toBe(true)
  })
  it('groups repeated supply paths by their actual style while distinguishing loaded, return and reused routes', () => {
    const data = sources({
      overlay: fc(
        line({ kind: 'complete-cost-path', pathRole: 'access', color: '#0f766e' }),
        line({ kind: 'complete-cost-path', pathRole: 'loaded', color: '#ca8a04', label: 'Pit A' }),
        line({ kind: 'complete-cost-path', pathRole: 'loaded', color: '#ca8a04', label: 'Pit B' }),
        line({ kind: 'complete-cost-path', pathRole: 'return', color: '#9333ea' }),
        point({ kind: 'fsr-target', color: '#0284c7' }),
        line({ kind: 'reviewed-existing-road', label: 'Reviewed section', color: '#0284c7' }),
        line({ kind: 'live-route-preview', color: '#e11d48' }),
        area({ label: 'Polygon not rendered by the exploration layer', color: '#000000' }),
      ),
    })
    const result = entries(build(data))
    expect(result).toHaveLength(6)
    expect(result.filter((entry) => entry.label === 'Loaded material haul')).toEqual([
      expect.objectContaining({ color: '#ca8a04', shape: 'dashed-line' }),
    ])
    expect(result.map((entry) => entry.label)).toEqual(
      expect.arrayContaining([
        'Reused access route',
        'Empty return route',
        'FSR connection target',
        'Live route preview',
      ]),
    )
    expect(build(sources())).toEqual([])
  })
  it('covers drainage, structures and cable styles, including all warnings and selected markers', () => {
    const result = entries(
      build(
        sources({
          drainage: fc(
            line({ role: 'stream-existing' }),
            line({ role: 'stream-design' }),
            line({ role: 'diversion' }),
            point({ role: 'pond' }),
            point({ role: 'low-point' }),
            point({ role: 'other-review' }),
          ),
          structures: fc(
            line({ color: '#0284c7' }),
            line({ color: '#d97706' }),
            line({ color: '#e11d48', selected: true }),
          ),
          cable: fc(line()),
        }),
        { cableSupports: true, cableCursor: true },
      ),
    )
    expect(result.map((entry) => entry.label)).toEqual(
      expect.arrayContaining([
        'Existing-ground drainage',
        'Design-surface drainage',
        'Redirected flow',
        'New ponding',
        'Unrelieved low point',
        'Drainage review point',
        'Culvert',
        'Culvert · review flags',
        'Selected culvert',
        'D-line / cable',
        'Yarder / tailhold',
        'D-line position',
      ]),
    )
    expect(result.find((entry) => entry.label === 'Existing-ground drainage')?.shape).toBe('dashed-line')
    expect(result.find((entry) => entry.label === 'Redirected flow')?.color).toBe('#dc2626')
  })
  it('explains drawing and landing-screen symbols only while present', () => {
    const data = sources({
      overlay: fc(
        line({ kind: 'radial-spoke', status: 'clear', color: '#15803d' }),
        line({ kind: 'radial-spoke', status: 'conflict', color: '#dc2626' }),
        line({ kind: 'radial-spoke', status: 'unknown', color: '#6b7280' }),
        point({ kind: 'radial-center', color: '#7c3aed' }),
        point({ kind: 'radial-spoke', color: '#be185d' }),
        point({ kind: 'peg-preview', color: '#e11d48' }),
      ),
      section: fc(line()),
      ticks: fc(line()),
    })
    const labels = entries(
      build(data, {
        selection: true,
        draftPoints: true,
        editing: true,
        insertControls: true,
        crossingMarkers: true,
        curveLabels: true,
      }),
    ).map((entry) => entry.label)
    expect(labels).toEqual(
      expect.arrayContaining([
        'Selected station / cross-section',
        'Station ticks & chainage labels',
        'Selected road feature',
        'Stream crossing review',
        'Horizontal curve radius',
        'Horizontal control points',
        'Insert horizontal control',
        'Drawing preview',
        'Landing',
        'Selected spoke position',
        'Proposed peg',
      ]),
    )
    expect(labels.filter((label) => label.startsWith('Landing spoke'))).toHaveLength(3)
    expect(entries(build(sources())).map((entry) => entry.label)).not.toContain('Drawing preview')
  })
})
