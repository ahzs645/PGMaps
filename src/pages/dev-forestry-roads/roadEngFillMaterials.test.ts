import { describe, expect, it } from 'vitest'
import { parseRoadEngSettings, roadEngEngineeringFor, roadEngMaterialsFor } from './roadEngDesignSettings'
import { mergeRoadEngIni } from './roadEngExport'
import { roadEngFillWriteBack } from './roadEngFillMaterials'
import type { FillRequirement } from './engineeringTypes'
import { DEFAULT_TEMPLATE } from './terrain'
import { validateEngineering } from './templates'

// A generated design laid out as RoadEng 11 writes `[LocationParms]` (Softree's Hart Rd holds the
// same pattern: `*2` either side of a rock-fill range): overburden over gravel at 1 m, `*2` (the
// gravel) from the start to 100 m, solid rock fill to 200 m, `*2` again to the end.
const range = (end: string, fill: string) =>
  `${end},0,0,0,0,0,0,0,0,0,-,${fill},-1,GR,999999,-,OB,LLB,LLB,RE,RE,0,0,-1,-1,0,0,0,0,RE,RE,9999,999999000,1`
const ROWS = [range('100', '*2'), range('200', 'SR'), range('999999999', '*2')]
function dsn(rows = ROWS) {
  return [
    '[design]',
    'units=10000',
    '[LocationParms]',
    ...rows.map((r, k) => `${k}=${r}`),
    `nparams=${rows.length}`,
    '',
  ].join('\r\n')
}
const ds2 = [
  '100,103,11,11.0.673.0, Softree Technical Systems Inc. - Location Line data file',
  '104,OB,Overburden (Default),100,400,1,1,4,2,0,4,0.5,2,2,1,0,0,0,8,',
  '104,GR,Gravel,50,50,1,0.9,4,2,0,4,0.5,2,2,1,2,0,0,8,',
  '104,SR,Solid Rock,100,400,1,0.8,20,1.8,0,4,0.5,2,2,1,3,0,0,8,',
].join('\r\n')
const frame = { startStation: 0, endStation: 300 }
const text = dsn()
const original = { dsnText: text, ds2Text: ds2, unitM: 1, ...frame }
const read = roadEngMaterialsFor(parseRoadEngSettings(text, ds2, 1), frame).fillRequirements
const road = (fillRequirements: FillRequirement[]) => ({
  name: 'Spur',
  engineering: {
    ...roadEngEngineeringFor(parseRoadEngSettings(text, ds2, 1), { ...frame, fallback: DEFAULT_TEMPLATE }).engineering,
    fillRequirements,
  },
})
const write = (fill: FillRequirement[], codes: Record<string, string> = {}) =>
  roadEngFillWriteBack(road(fill), original, text, codes)
const readBack = (w: ReturnType<typeof write>, unitM = 1, at = frame) =>
  roadEngMaterialsFor(parseRoadEngSettings(mergeRoadEngIni(text, w.alignment), ds2, unitM), at).fillRequirements
const rowsOf = (w: ReturnType<typeof write>) =>
  Object.entries(w.alignment.LocationParms ?? {}).map(([k, v]) => [k, v?.split(',')[0], v?.split(',')[11]])

describe('RoadEng fill material by range', () => {
  it('reads *2 as the second ground layer and a code as that material', () => {
    expect(read.map((r) => [r.start, r.end, r.materialId, r.replaceable])).toEqual([
      [0, 100, 'roadeng-GR', true],
      [100, 200, 'roadeng-SR', true],
      [200, 300, 'roadeng-GR', true],
    ])
    validateEngineering(road(read).engineering)
  })
  it('writes nothing for an unedited road', () => {
    const w = write(read)
    expect(w.alignment).toEqual({})
    expect(w.notWritten).toEqual([])
    expect(mergeRoadEngIni(text, w.alignment)).toBe(text)
  })
  it('writes a changed material into its row only, keeping *2 where the fill is still the gravel', () => {
    const w = write(read.map((r) => (r.materialId === 'roadeng-SR' ? { ...r, materialId: 'roadeng-OB' } : r)))
    expect(w.alignment).toEqual({ LocationParms: { '1': range('200', 'OB') } })
    expect(readBack(w).map((r) => [r.start, r.end, r.materialId])).toEqual([
      [0, 100, 'roadeng-GR'],
      [100, 200, 'roadeng-OB'],
      [200, 300, 'roadeng-GR'],
    ])
  })
  it('splits a row where a requirement now ends and joins rows that come out the same', () => {
    const moved = read.map((r) =>
      r.materialId === 'roadeng-SR' ? { ...r, end: 250 } : r.start === 200 ? { ...r, start: 250 } : r,
    )
    const w = write(moved)
    expect(w.alignment).toEqual({ LocationParms: { '1': range('250', 'SR') } })
    expect(readBack(w).map((r) => [r.start, r.end, r.materialId])).toEqual([
      [0, 100, 'roadeng-GR'],
      [100, 250, 'roadeng-SR'],
      [250, 300, 'roadeng-GR'],
    ])
    // A requirement inside a row splits it in three, at stations written in the design's units.
    const inside = write([...read.filter((r) => r.start !== 200), { ...read[1], id: 'x', start: 220, end: 240 }])
    expect(rowsOf(inside)).toEqual([
      ['2', '220', '*1'],
      ['3', '240', 'SR'],
      ['4', '999999999', '*1'],
      ['nparams', '5', undefined],
    ])
  })
  it('writes *1 where a requirement was removed', () => {
    const w = write(read.filter((r) => r.materialId !== 'roadeng-SR'))
    expect(w.alignment).toEqual({ LocationParms: { '1': range('200', '*1') } })
    expect(readBack(w).map((r) => [r.start, r.end])).toEqual([
      [0, 100],
      [200, 300],
    ])
  })
  it('writes a material made here by the code the ground types are written with', () => {
    const w = write(
      read.map((r) => (r.start === 0 ? { ...r, materialId: 'crushed-rock' } : r)),
      { 'crushed-rock': 'CR' },
    )
    expect(w.alignment).toEqual({ LocationParms: { '0': range('100', 'CR') } })
  })
  it('says what RoadEng’s row cannot hold', () => {
    const w = write([
      ...read.map((r) => (r.materialId === 'roadeng-SR' ? { ...r, replaceable: false } : r)),
      { id: 's', start: 0, end: 300, layer: 'surfacing', materialId: 'roadeng-GR', replaceable: false },
    ])
    // SR only is still SR in the row: the row is unchanged, and RoadEng takes SR or better there.
    expect(w.alignment).toEqual({})
    expect(w.notWritten.join('\n')).toMatch(
      /takes that material only; RoadEng's fill type takes SR or any material of the same or higher quality/,
    )
    expect(w.notWritten.join('\n')).toMatch(/1 fill requirement on layers other than subgrade \(surfacing\)/)
    const quality = write(
      read.map((r) =>
        r.materialId === 'roadeng-SR' ? { ...r, materialId: undefined, replaceable: true, minQuality: 60 } : r,
      ),
    )
    expect(quality.alignment).toEqual({})
    expect(quality.notWritten.join('\n')).toMatch(
      /minimum quality names no material; RoadEng keeps the range's fill as read/,
    )
  })
  it('writes a foot design’s boundaries in feet', () => {
    // Align stage 8's pattern: rip rap from 1300 to 1500 ft.
    const feet = dsn([range('1300', '*2'), range('1500', 'RR'), range('999999999', '*2')]).replace(
      'units=10000',
      'units=3048',
    )
    const feetDs2 = `${ds2}\r\n104,RR,Rip Rap,100,100,1,1,12,4,0,8,0.6,4,2.6,2,0,0,0,8,`
    const at = { startStation: 0, endStation: 609.6 }
    const s = parseRoadEngSettings(feet, feetDs2, 0.3048)
    const fill = roadEngMaterialsFor(s, at).fillRequirements
    expect(fill.map((r) => [Math.round(r.start * 1e6) / 1e6, Math.round(r.end * 1e6) / 1e6, r.materialId])).toEqual([
      [0, 396.24, 'roadeng-GR'],
      [396.24, 457.2, 'roadeng-RR'],
      [457.2, 609.6, 'roadeng-GR'],
    ])
    const w = roadEngFillWriteBack(
      {
        name: 'Stage 8',
        engineering: {
          ...road([]).engineering,
          fillRequirements: fill.map((r) =>
            r.materialId === 'roadeng-RR' ? { ...r, end: 487.68 } : r.start > 400 ? { ...r, start: 487.68 } : r,
          ),
        },
      },
      { dsnText: feet, ds2Text: feetDs2, unitM: 0.3048, ...at },
      feet,
      {},
    )
    expect(w.alignment.LocationParms?.['1']?.split(',').slice(0, 1)).toEqual(['1600'])
  })
})
