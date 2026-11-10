import { GState, jsPDF } from 'jspdf'
import { describe, expect, it } from 'vitest'
import type { DrawOp } from '@/lib/mapSheet/drawOps'
import { createSheetPdf, drawSheetPdf } from '@/lib/mapSheet/renderPdf'
import { sheetSvg } from '@/lib/mapSheet/renderSvg'
import { EXAMPLE_RIGGING } from '../cableMechanics'
import type { CableLayoutResult } from '../cableLayout/cableLayout'
import { layoutLimitRows } from '../cableLayout/limits'
import { DEFAULT_SUPPORT_LAYOUT } from '../cableLayout/settings'
import { analyzeCable, offsetCoordinate } from '../engine'
import { localMetricGrid } from '../terrain'
import type { CableLine, Coordinate, TerrainSource } from '../types'
import { cableGroundSource } from './fieldProfile'
import { dLineExtras } from './outputs'
import { buildDLineSheet, type DLineSheetInput } from './sheet'
import { dLineSheetUnavailable } from './sheetExport'

const start: Coordinate = [-122.72, 53.89]
const supports = Array.from({ length: 7 }, (_, i) => ({ stationM: i * 50, heightM: i === 0 ? 12 : 14 }))
const line: CableLine = {
  id: 'd1',
  name: 'Skyline over the draw',
  start,
  end: offsetCoordinate(start, 60, 350),
  startHeight: 12,
  endHeight: 10,
  deflectionPercent: 5,
  sagModel: 'mechanics',
  rigging: EXAMPLE_RIGGING,
  supportLayout: {
    ...DEFAULT_SUPPORT_LAYOUT,
    saved: { preTensionKN: 150, complete: true, supports: [...supports, { stationM: 350, heightM: 10 }] },
  },
  fieldProfile: {
    use: true,
    note: 'Vertex, crew A',
    method: 'station-elevation',
    shots: [
      { stationM: 0, elevationM: 1000 },
      { stationM: 175, elevationM: 1060 },
      { stationM: 350, elevationM: 1100 },
    ],
  },
}
const hill: TerrainSource = {
  elevationAt: (lng, lat) => 1000 + (lng - start[0]) * 8_000 + (lat - start[1]) * 12_000,
}
const ground = cableGroundSource(line, hill)
const analysis = analyzeCable(line, ground)
const result = {
  status: 'complete',
  reason: 'none',
  preTensionKN: 150,
  ropeLengthM: 360,
  maxTensionKN: 180,
  allowableKN: 200,
  tensionOk: true,
  minClearanceM: 4,
  clearanceKnown: true,
  supports: [...supports, { stationM: 350, heightM: 10 }].map((s, i) => ({
    kind: i === 0 ? 'yarder' : 'support',
    stationM: s.stationM,
    groundM: 1000 + s.stationM / 3,
    heightM: s.heightM,
    fixed: false,
    emptyBreakDeg: i === 0 || i === 7 ? null : 5,
    loadedBreakDeg: i === 0 ? null : 15,
    loadedLimitDeg: 30,
    liftOffLimitDeg: i === 0 || i === 7 ? null : 1,
    maxForceKN: 30,
  })),
  spans: [{ clearanceOk: true, gravityOk: true, tensionOk: true }],
  samples: Array.from({ length: 36 }, (_, i) => ({
    stationM: i * 10,
    loadM: 1010 + i * 3,
    emptyM: 1012 + i * 3,
    groundM: 1000 + i * 3,
  })),
} as unknown as CableLayoutResult

function input(overrides: Partial<DLineSheetInput> = {}): DLineSheetInput {
  const grid = localMetricGrid(start)
  const extras = dLineExtras({ line, analysis, terrain: hill, ground, layout: result, grid })
  return {
    projectName: 'Tabor block 12',
    line,
    analysis,
    extras,
    limits: layoutLimitRows(result, line.supportLayout!, EXAMPLE_RIGGING.minClearanceM),
    terrain: hill,
    terrainName: 'LiDAR DEM 1 m',
    verticalReference: 'CGVD2013',
    issue: { preparedBy: 'A. Forester', organisation: '', revision: 'B', date: '2026-11-10' },
    caveat: 'Planning record only.',
    ...overrides,
  }
}
const texts = (ops: DrawOp[]) => ops.flatMap((op) => (op.op === 'text' ? [op.text] : []))

describe('D-line sheet', () => {
  it('draws the header, profile, plan, tables, limits and assumptions on one tabloid page', () => {
    const sheet = buildDLineSheet(input())
    expect([sheet.width, sheet.height]).toEqual([1224, 792])
    const all = texts(sheet.ops)
    for (const expected of [
      'Skyline over the draw',
      'Tabor block 12',
      'PROFILE FROM THE YARDER',
      'PLAN',
      'FORCES AND ANGLES',
      'LIMITS',
      'ASSUMPTIONS',
      'N',
    ])
      expect(all).toContain(expected)
    expect(all.some((t) => t.startsWith('SUPPORTS AND STAKE-OUT · EPSG:'))).toBe(true)
    expect(all.some((t) => t.includes('Prepared by: A. Forester'))).toBe(true)
    expect(all).toContain('Ground (field shots)')
    expect(all).toContain('Terrain')
    expect(all.some((t) => /^Contours \d+ m/.test(t))).toBe(true)
    // Every text and shape stays on the page.
    for (const op of sheet.ops)
      if (op.op === 'text') {
        expect(op.x).toBeGreaterThanOrEqual(0)
        expect(op.x).toBeLessThanOrEqual(sheet.width)
        expect(op.y).toBeGreaterThanOrEqual(0)
        expect(op.y).toBeLessThanOrEqual(sheet.height)
      }
    expect(sheet.truncated).toEqual({ stakeout: 0, forces: 0 })
  })

  it('says how many rows a long table left out', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ ...input().extras.stakeout!.rows[1], point: i + 1 }))
    const base = input()
    const sheet = buildDLineSheet({
      ...base,
      extras: { ...base.extras, stakeout: { ...base.extras.stakeout!, rows: many } },
    })
    expect(sheet.truncated.stakeout).toBeGreaterThan(0)
    expect(texts(sheet.ops)).toContain(`+${sheet.truncated.stakeout} more rows: see the D-line report or CSV.`)
  })

  it('prints through the map-sheet PDF and SVG renderers', () => {
    const sheet = buildDLineSheet(input({ stamp: 'NOT CURRENT: rigging edited' }))
    const pdf = createSheetPdf({ jsPDF, GState }, sheet.width, sheet.height)
    drawSheetPdf(pdf, { jsPDF, GState }, sheet.ops)
    expect(new TextDecoder().decode(pdf.output('arraybuffer').slice(0, 5))).toBe('%PDF-')
    expect(sheetSvg(sheet.ops, sheet.width, sheet.height)).toContain('NOT CURRENT: rigging edited')
  })

  it('refuses a D-line whose own inputs are invalid', () => {
    expect(dLineSheetUnavailable(undefined)).toMatch(/Draw a D-line/)
    expect(dLineSheetUnavailable(line)).toBeNull()
    expect(dLineSheetUnavailable({ ...line, rigging: { ...EXAMPLE_RIGGING, safetyFactor: 0 } })).toMatch(/rigging/)
    expect(
      dLineSheetUnavailable({ ...line, supportLayout: { ...line.supportLayout!, minSupportHeightM: 60 } }),
    ).toMatch(/support settings/)
    expect(dLineSheetUnavailable({ ...line, sagModel: undefined, supportLayout: undefined })).toBeNull()
  })
})
