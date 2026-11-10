import { describe, expect, it } from 'vitest'
import { EXAMPLE_RIGGING } from '../cableMechanics'
import type { CableLayoutResult, LayoutSupport } from '../cableLayout/cableLayout'
import { DEFAULT_SUPPORT_LAYOUT } from '../cableLayout/settings'
import { analyzeCable, offsetCoordinate } from '../engine'
import { parseCsv } from '../exportCatalog'
import { cableProfileCsv, cableProfileHtml } from '../profileOutputs'
import { localMetricGrid } from '../terrain'
import type { CableLine, Coordinate, TerrainMetadata, TerrainSource } from '../types'
import { dLineExtras } from './outputs'
import { dLineSupportPlanFeatures, dLineSupports, supportStakeout, supportStakeoutCsv } from './supports'

const start: Coordinate = [-122.72, 53.89]
const line: CableLine = {
  id: 'd1',
  name: '=D-line, "north"',
  start,
  end: offsetCoordinate(start, 90, 400),
  startHeight: 12,
  endHeight: 10,
  deflectionPercent: 5,
  sagModel: 'mechanics',
  rigging: EXAMPLE_RIGGING,
  supportLayout: {
    ...DEFAULT_SUPPORT_LAYOUT,
    fixedSupports: [{ stationM: 150 }],
    saved: {
      preTensionKN: 120,
      complete: true,
      supports: [
        { stationM: 0, heightM: 99 },
        { stationM: 150, heightM: 14 },
        { stationM: 260, heightM: 10 },
        { stationM: 400, heightM: 9 },
      ],
    },
  },
}
const slope: TerrainSource = { elevationAt: (lng) => 1000 - (lng - start[0]) * 10_000 }
const metadata: TerrainMetadata = {
  name: 'Test terrain',
  kind: 'demo',
  resolutionM: 1,
  verticalReference: 'CGVD2013',
} as TerrainMetadata

const support = (kind: LayoutSupport['kind'], stationM: number, heightM: number): LayoutSupport => ({
  kind,
  stationM,
  groundM: 1000,
  heightM,
  fixed: false,
  emptyTensionKN: 100,
  angleInDeg: null,
  angleOutDeg: null,
  emptyBreakDeg: kind === 'support' ? 4 : null,
  loadedBreakDeg: kind === 'support' ? 12 : null,
  loadedLimitDeg: null,
  liftOffLimitDeg: null,
  saddleRopeKN: null,
  saddleCarriageOnKN: null,
  saddleBeforeKN: null,
  saddleAfterKN: null,
  maxForceKN: 40,
  pullAngleDeg: null,
})
const result = {
  status: 'complete',
  preTensionKN: 118,
  supports: [
    support('yarder', 0, 12),
    support('support', 140, 15),
    support('support', 400, 9),
    support('anchor', 420, 0),
  ],
  samples: [
    { stationM: 0, loadM: 1012, emptyM: 1012, groundM: 1000 },
    { stationM: 400, loadM: 1009, emptyM: 1009, groundM: 1000 },
  ],
} as unknown as CableLayoutResult

describe('D-line supports', () => {
  it('reads the saved layout with the ends as the line is now, and ground from the line', () => {
    const set = dLineSupports(line, { ground: slope })!
    expect(set.source).toBe('saved')
    expect(set.intermediate).toBe(2)
    expect(set.rows.map((r) => r.label)).toEqual(['Y', '1', '2', 'E'])
    // The yarder is the line's yarder height, not the saved one.
    expect(set.rows[0].heightM).toBe(12)
    expect(set.rows[1]).toMatchObject({ name: 'Support 1', fixed: true, heightM: 14 })
    expect(set.rows[1].groundM).toBeCloseTo(slope.elevationAt(...offsetCoordinate(start, 90, 150)), 6)
    expect(set.rows[1].saddleM).toBeCloseTo(set.rows[1].groundM! + 14, 9)
    expect(dLineSupports({ ...line, supportLayout: undefined })).toBeNull()
  })

  it('prefers a current result, with its anchors, forces and angles', () => {
    const set = dLineSupports(line, { result, ground: slope })!
    expect(set.source).toBe('result')
    expect(set.rows.map((r) => r.label)).toEqual(['Y', '1', 'E', 'A'])
    expect(set.rows[1]).toMatchObject({ groundM: 1000, saddleM: 1015, loadedBreakDeg: 12, maxForceKN: 40 })
  })

  it('stakes out every support in station order in the project grid and in longitude/latitude', () => {
    const set = dLineSupports(line, { ground: slope })!
    const grid = localMetricGrid(start)
    const rows = supportStakeout(set, grid.toGrid)
    expect(rows.map((r) => r.point)).toEqual([1, 2, 3, 4])
    expect(rows.every((r) => r.offsetM === 0)).toBe(true)
    const [e0, n0] = grid.toGrid(start)
    // East along the line: easting grows by the station, northing barely moves.
    expect(rows[1].easting - e0).toBeCloseTo(150, 0)
    expect(Math.abs(rows[1].northing - n0)).toBeLessThan(2)
    expect(rows[1].longitude).toBeCloseTo(offsetCoordinate(start, 90, 150)[0], 9)
    const csv = supportStakeoutCsv(line.name, set, rows, grid.epsg)
    const [header, first] = csv.trim().split('\n')
    expect(header).toBe(
      'point,d_line,label,support,station_from_yarder_m,offset_m,easting,northing,epsg,longitude,latitude,ground_elevation_m,support_height_m,saddle_elevation_m,layout_source',
    )
    // A name that starts like a formula is guarded and quoted.
    expect(first.startsWith(`1,"'=D-line, ""north""",Y,Yarder,0.00,0.00,`)).toBe(true)
  })

  it('puts each saved intermediate support on the plan, clickable to its chart distance', () => {
    const features = dLineSupportPlanFeatures([line, { ...line, id: 'd2', yarderAt: 'end' }])
    expect(features).toHaveLength(4)
    expect(features[0].properties).toMatchObject({ kind: 'dline-support', marker: 'dot', cableId: 'd1' })
    expect(features[0].properties!.chartDistance).toBeCloseTo(150, 6)
    expect(String(features[0].properties!.label)).toMatch(/support 1 · 150 m from the yarder · 14.0 m tall \(fixed\)/)
    // With the yarder at the far end the chart runs from the other end.
    expect(features[2].properties!.chartDistance).toBeCloseTo(250, 3)
  })
})

describe('D-line exports with supports', () => {
  const analysis = analyzeCable(line, slope)

  it('leaves a D-line without supports or a field profile exporting as before', () => {
    const plain = { ...line, supportLayout: undefined }
    const plainAnalysis = analyzeCable(plain, slope)
    const extras = dLineExtras({ line: plain, analysis: plainAnalysis, terrain: slope, ground: slope })
    expect(cableProfileCsv(plain, plainAnalysis, metadata, extras)).toBe(
      cableProfileCsv(plain, plainAnalysis, metadata),
    )
    expect(cableProfileHtml(plain, plainAnalysis, metadata, extras)).toBe(
      cableProfileHtml(plain, plainAnalysis, metadata),
    )
  })

  it('appends the support columns after every existing column, and the sections to the report', () => {
    const grid = localMetricGrid(start)
    const extras = dLineExtras({ line, analysis, terrain: slope, ground: slope, grid, layout: result })
    const before = cableProfileCsv(line, analysis, metadata).split('\r\n')[0].split(',')
    const header = cableProfileCsv(line, analysis, metadata, extras).split('\r\n')[0].split(',')
    expect(header.slice(0, before.length)).toEqual(before)
    expect(header.slice(before.length)).toEqual([
      'support_layout_source',
      'support_layout_status',
      'support_layout_pre_tension_kn',
      'intermediate_supports',
      'supports_station_height_m',
      'layout_load_path_elevation_m',
      'layout_empty_skyline_elevation_m',
      'layout_load_clearance_m',
    ])
    const row = parseCsv(cableProfileCsv(line, analysis, metadata, extras)).rows[1]
    expect(row).toHaveLength(header.length)
    expect(row.slice(before.length, before.length + 5)).toEqual([
      'result',
      'complete',
      '118',
      '1',
      '0.0@12.0;140.0@15.0;400.0@9.0',
    ])
    // The multi-span load path at the yarder, 12 m above the ground there.
    expect(Number(row[before.length + 5])).toBeCloseTo(1012, 6)
    const html = cableProfileHtml(line, analysis, metadata, extras)
    expect(html).toContain('<h2>Intermediate supports</h2>')
    expect(html).toContain(`<h2>Support stake-out</h2>`)
    expect(html).toContain(`EPSG:${grid.epsg}`)
    expect(html.indexOf('<h2>Sample schedule</h2>')).toBeLessThan(html.indexOf('<h2>Intermediate supports</h2>'))
  })
})
