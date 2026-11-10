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
import type { EditedLayout } from '../cableLayout/layoutEdit'
import { dLineFrame } from './frame'
import {
  dLineSupportPlanFeatures,
  dLineSupports,
  resultIsOfEdit,
  shownLayout,
  supportStakeout,
  supportStakeoutCsv,
} from './supports'

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
      'point,d_line,label,support,station_from_yarder_m,offset_m,easting,northing,epsg,longitude,latitude,ground_elevation_m,support_height_m,saddle_elevation_m,layout_source,layout,support_name,support_category',
    )
    // A name that starts like a formula is guarded and quoted.
    expect(first.startsWith(`1,"'=D-line, ""north""",Y,Yarder,0.00,0.00,`)).toBe(true)
    expect(first.endsWith(',saved,found,,')).toBe(true)
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
      'support_layout',
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
    expect(row.slice(before.length, before.length + 6)).toEqual([
      'found',
      'result',
      'complete',
      '118',
      '1',
      '0.0@12.0;140.0@15.0;400.0@9.0',
    ])
    // The multi-span load path at the yarder, 12 m above the ground there.
    expect(Number(row[before.length + 6])).toBeCloseTo(1012, 6)
    const html = cableProfileHtml(line, analysis, metadata, extras)
    expect(html).toContain('<h2>Intermediate supports</h2>')
    expect(html).toContain(`<h2>Support stake-out</h2>`)
    expect(html).toContain(`EPSG:${grid.epsg}`)
    expect(html.indexOf('<h2>Sample schedule</h2>')).toBeLessThan(html.indexOf('<h2>Intermediate supports</h2>'))
  })
})

describe('An open layout edit in every output', () => {
  // The found layout has supports at 150 and 260 m; the edit, open on screen, at 190.1 and 285.2 m.
  const edited: EditedLayout = {
    origin: 'found',
    preTensionKN: 85,
    start: { heightM: 12 },
    end: { heightM: 9, name: 'Tail spar' },
    supports: [
      { stationM: 190.1, heightM: 13, name: 'Big fir', category: 'tree' },
      { stationM: 285.2, heightM: 11 },
    ],
  }
  const editing: CableLine = { ...line, supportLayout: { ...line.supportLayout!, edited } }
  const lengthM = dLineFrame(editing)!.lengthM
  const editResult = {
    ...result,
    preTensionKN: 85,
    supports: [
      support('yarder', 0, 12),
      support('support', 190.1, 13),
      support('support', 285.2, 11),
      support('support', lengthM, 9),
    ],
  } as CableLayoutResult
  const grid = localMetricGrid(start)
  const analysis = analyzeCable(editing, slope)

  it('lists the edit, not the found layout, even when handed the found result', () => {
    expect(shownLayout(line)).toBe('found')
    expect(shownLayout(editing)).toBe('edited')
    const set = dLineSupports(editing, { result, ground: slope })!
    expect(set).toMatchObject({ layout: 'edited', source: 'saved', preTensionKN: 85, intermediate: 2 })
    expect(set.rows.map((r) => r.stationM)).toEqual([0, 190.1, 285.2, lengthM])
    expect(set.rows[1]).toMatchObject({ label: '1', supportName: 'Big fir', category: 'tree' })
    expect(set.rows[3]).toMatchObject({ label: 'E', supportName: 'Tail spar' })
  })

  it('takes forces from the edit’s own check, keeping the names', () => {
    expect(resultIsOfEdit(editResult, edited, lengthM)).toBe(true)
    expect(resultIsOfEdit(result, edited, lengthM)).toBe(false)
    const set = dLineSupports(editing, { result: editResult, ground: slope })!
    expect(set).toMatchObject({ layout: 'edited', source: 'result', preTensionKN: 85 })
    expect(set.rows[1]).toMatchObject({ stationM: 190.1, supportName: 'Big fir', maxForceKN: 40 })
  })

  it('puts the edit’s supports on the plan, clicking through to the edit’s stations', () => {
    const features = dLineSupportPlanFeatures([editing])
    expect(features.map((f) => f.properties!.chartDistance)).toEqual([190.1, 285.2])
    expect(String(features[0].properties!.label)).toMatch(/support 1 \(Big fir\) · 190 m .* · edited layout$/)
    expect(String(dLineSupportPlanFeatures([line])[0].properties!.label)).toMatch(/· found layout$/)
  })

  it('stakes out, exports and reports the edit, saying so', () => {
    const extras = dLineExtras({ line: editing, analysis, terrain: slope, ground: slope, grid, layout: result })
    // The found result is not the edit's: no load path is printed from it.
    expect(extras.layout).toBeNull()
    const csv = supportStakeoutCsv(editing.name, extras.supports!, extras.stakeout!.rows, grid.epsg)
    const rows = parseCsv(csv).rows
    const header = rows[0]
    expect(rows[2][header.indexOf('station_from_yarder_m')]).toBe('190.10')
    expect(rows[2][header.indexOf('layout')]).toBe('edited')
    expect(rows[2][header.indexOf('support_name')]).toBe('Big fir')
    expect(rows[2][header.indexOf('support_category')]).toBe('tree')
    const profile = parseCsv(cableProfileCsv(editing, analysis, metadata, extras)).rows
    const at = (name: string) => profile[1][profile[0].indexOf(name)]
    expect(at('support_layout')).toBe('edited')
    expect(at('support_layout_pre_tension_kn')).toBe('85')
    expect(at('supports_station_height_m')).toBe(`0.0@12.0;190.1@13.0;285.2@11.0;${lengthM.toFixed(1)}@9.0`)
    const html = cableProfileHtml(editing, analysis, metadata, extras)
    expect(html).toContain('Edited layout: the layout edited by hand')
    expect(html).toContain('1 · Support 1 “Big fir”')
  })
})
