import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  parseRoadEngSettings,
  readRoadEngSettings,
  roadEngEngineeringFor,
  roadEngOverrideParameter,
  roadEngParameterOverridesFor,
} from './roadEngDesignSettings'
import { mergeRoadEngIni } from './roadEngExport'
import { roadEngFillWriteBack } from './roadEngFillMaterials'
import { parseRoadEngDesign } from './roadEngImport'
import { roadEngDesignWriteBack } from './roadEngParameterOverrides'
import { roadEngProject } from './roadEngProject'
import { roadEngExportGrid, roadEngProjectExport } from './roadEngProjectExport'
import { parseProject } from './project'
import { createDemoProject, DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE, exportGrid } from './terrain'
import type { RoadProject } from './types'

// A generated design (no Softree file): a lane on each side carrying `AcpWidth`, and overrides laid
// out as Softree's samples hold them: ±FLT_MAX at the alignment's ends, a description per row, the
// side as the code (4096 left, 8192 right) and two entries at one station for a step.
type Param = [name: string, flags: number, value: number]
function component(c: number, side: 'left' | 'right' | 'both', head: string, params: Param[]) {
  const sides = side === 'both' ? [1, 0] : [side === 'left' ? 1 : 0]
  return [
    `T0-C${c}=${head}`,
    ...sides.map((bit, f) => `T0-C${c}-F${f}=1,SGL,Fragment,${131072 + bit},1,0,0,-`),
    ...params.map(([name, flags, value], u) => `T0-C${c}-U${u}=${name}~${name}.|${flags}|${value}|-1|0|1000|`),
  ]
}
const RURAL = '4,RDWY,Rural I!^!Lane.,2,0,146'
const lane: Param[] = [
  ['AcpThick', 0, 0],
  ['AcpWidth', 256, 4],
]
function dsn(overrides: string[]) {
  return [
    '[design]',
    `ParmOverrides-1=${overrides.length}`,
    ...overrides.map((o, k) => `ParmOverrides-${k + 2}=${o}`),
    'units=10000',
    '[LocationParms]',
    '0=999999999,0,0,0,0,0,0,0,0,0,-,*1,999999,-,999999,-,OB,LLB,LLB,RE,RE,0,0,-1,-1,0,0,0,0,RE,RE,9999,999999000,1',
    'nparams=1',
    '[TemplatesSct]',
    'T0=3,LLB,Rural 8m Gravel,-0.03,-0.03,1,0,2,2',
    ...component(0, 'left', RURAL, lane),
    ...component(1, 'right', RURAL, lane),
    ...component(2, 'both', '2,SLPS,Slopes Default!^!Closing slopes.,2,0,129', [
      ['FinalSlpL', 1, 0.5],
      ['FinalSlpR', 1, 0.5],
    ]),
    '',
  ].join('\r\n')
}
const ds2 = '104,OB,Overburden (Default),25,40,1,1.25,12,4,0,8,0.6,4,2.6,2,0,0,0,8,'
const frame = { startStation: 0, endStation: 300, fallback: { ...DEFAULT_TEMPLATE } }
const PULLOUT = [
  '-3.40282346639e+38|8192|AcpWidth|**|Alignment Start',
  '100|8192|AcpWidth|**|Taper Start',
  '110|8192|AcpWidth|7|Pullout Start',
  '150|8192|AcpWidth|7|Pullout End',
  '150|8192|AcpWidth|5|Pullout End',
  '160|8192|AcpWidth|**|Taper End',
  '3.40282346639e+38|8192|AcpWidth|**|Alignment End',
]

describe('RoadEng parameter overrides: side, ends and steps', () => {
  const text = dsn(PULLOUT)
  const s = parseRoadEngSettings(text, ds2, 1)
  const m = roadEngEngineeringFor(s, frame)
  it('reads the code as the side and ±FLT_MAX as the alignment’s ends', () => {
    expect(s.parameterOverrideEntries.map((e) => [e.station, e.description])).toEqual([
      [-Infinity, 'Alignment Start'],
      [100, 'Taper Start'],
      [110, 'Pullout Start'],
      [150, 'Pullout End'],
      [150, 'Pullout End'],
      [160, 'Taper End'],
      [Infinity, 'Alignment End'],
    ])
    const t = s.templates[0]
    expect(roadEngOverrideParameter(t, 'AcpWidth', 4096)?.component.index).toBe(0)
    expect(roadEngOverrideParameter(t, 'AcpWidth', 8192)?.component.index).toBe(1)
    // A parameter only on the both-sides component is found from either side.
    expect(roadEngOverrideParameter(t, 'FinalSlpL', 4096)?.component.index).toBe(2)
  })
  it('makes the right width a step at 150 m, from the road’s start to its end', () => {
    expect(m.engineering.parameterOverrides).toHaveLength(1)
    const [o] = m.engineering.parameterOverrides!
    expect(o).toMatchObject({ side: 'right', field: 'Width' })
    expect(o.points).toEqual([
      { station: 0, value: null },
      { station: 100, value: null },
      { station: 110, value: 7 },
      { station: 150, value: 7 },
      { station: 150.001, value: 5 },
      { station: 160, value: null },
      { station: 300, value: null },
    ])
  })
  it('moves only the left side for a left code', () => {
    const left = roadEngEngineeringFor(
      parseRoadEngSettings(dsn(PULLOUT.map((e) => e.replace('|8192|', '|4096|'))), ds2, 1),
      frame,
    ).engineering.parameterOverrides!
    expect(left.map((o) => [o.side, o.field])).toEqual([['left', 'Width']])
  })
  it('writes an unedited override back as read, and an edited step at one station', () => {
    const road = { name: 'Spur', template: m.template!, engineering: m.engineering }
    const original = { dsnText: text, ds2Text: ds2, unitM: 1, ...frame }
    expect(roadEngDesignWriteBack(road, original, text).alignment).toEqual({})
    const [o] = m.engineering.parameterOverrides!
    const edited = { ...o, points: o.points.map((p) => (p.value === 7 ? { ...p, value: 8 } : p)) }
    const w = roadEngDesignWriteBack(
      { ...road, engineering: { ...m.engineering, parameterOverrides: [edited] } },
      original,
      text,
    )
    // Only the two changed rows; stations keep their text (±FLT_MAX at the ends) and description,
    // and the step stays at 150.
    expect(w.alignment.design).toEqual({
      'ParmOverrides-4': '110|8192|AcpWidth|8|Pullout Start',
      'ParmOverrides-5': '150|8192|AcpWidth|8|Pullout End',
    })
    const back = roadEngParameterOverridesFor(parseRoadEngSettings(mergeRoadEngIni(text, w.alignment), ds2, 1), frame)
    expect(back.overrides[0].points).toEqual(edited.points)
  })
})

// The sample pack the user supplied (Softree's files, never committed), read through its variable.
const pack = process.env.ROADENG_SAMPLE_PACK
const packFile = (p: string) => join(pack ?? '', p)
const packed = (p: string) => !!pack && existsSync(packFile(p))
const read = (p: string) => new Uint8Array(readFileSync(packFile(p)))
const frameOf = (bytes: Uint8Array) => {
  const a = parseRoadEngDesign(bytes).alignments[0]
  return { startStation: a.startStation, endStation: a.endStation, fallback: { ...DEFAULT_TEMPLATE } }
}

describe.skipIf(!pack || !existsSync(pack ?? ''))('RoadEng sample pack: parameter overrides', () => {
  it('reads Widening only’s 43 entries as ten series by side, with the alignment’s ends', () => {
    const p = 'widening-only/Widening only/Widening only.dsnx'
    if (!packed(p)) return
    const bytes = read(p)
    const [{ settings }] = readRoadEngSettings(bytes).parts
    const entries = settings.parameterOverrideEntries
    expect(settings.parameterOverrides).toBe(43)
    expect(entries).toHaveLength(43)
    const series = new Set(entries.map((e) => `${e.parameter} ${e.code}`))
    expect(series.size).toBe(10)
    // OverlayThick on both sides, as two series; MillDepthLane on the left, MillLaneDepth on the right.
    expect([...series].filter((k) => k.startsWith('OverlayThick')).sort()).toEqual([
      'OverlayThick 4096',
      'OverlayThick 8192',
    ])
    expect(entries.filter((e) => !Number.isFinite(e.station)).length).toBe(30)
    expect(entries.every((e) => Number.isFinite(e.station) || e.raw === null || e.raw >= 0)).toBe(true)
    // The design's template (DF) holds only closing slopes, so the overrides change nothing here.
    const m = roadEngParameterOverridesFor(settings, frameOf(bytes))
    expect(m.overrides).toEqual([])
    expect(m.unmapped).toHaveLength(10)
    expect(m.unmapped.every((u) => /no template in use holds a parameter of that name/.test(u))).toBe(true)
  })
  it('reads Hart Rd’s turning lane on the left lane and Location 18’s pullouts on the right', () => {
    const hart = 'tutorial-v10/SoftreeOptimal/Hart Rd.dsnx'
    const loc = 'tutorial-v11/RoadEngResource/Location/Location 18_1.dsnx'
    if (!packed(hart) || !packed(loc)) return
    const h = read(hart)
    const hs = readRoadEngSettings(h).parts[0].settings
    const rur = hs.templates.find((t) => t.code === 'RUR')!
    expect(roadEngOverrideParameter(rur, 'AcpWidth', 4096)).toMatchObject({ component: { index: 0, side: 'left' } })
    const ho = roadEngParameterOverridesFor(hs, frameOf(h)).overrides
    expect(ho.map((o) => [o.side, o.field])).toEqual([['left', 'Width']])
    // 7 m of pavement over 410–490 m, tapering over 10 m either side, from the start to the end.
    const [a, b, c, d, e, f] = ho[0].points
    expect([a.value, b.value, e.value, f.value]).toEqual([null, null, null, null])
    expect(c.value).toBe(d.value)
    expect(c.value!).toBeGreaterThan(7)
    expect([a.station, f.station]).toEqual([0, expect.closeTo(950.291, 2)])
    const ls = readRoadEngSettings(read(loc)).parts[0].settings
    const df = ls.templates.find((t) => t.code === 'DF')!
    expect(roadEngOverrideParameter(df, 'Width', 8192)).toMatchObject({ component: { index: 1, side: 'right' } })
    expect(roadEngOverrideParameter(df, 'Width', 4096)).toMatchObject({ component: { index: 0, side: 'left' } })
  })
})

describe.skipIf(!pack || !existsSync(pack ?? ''))(
  'RoadEng sample pack: fill material by range',
  { timeout: 120_000 },
  () => {
    let n = 0
    const options = {
      newId: () => `id${n++}`,
      color: () => '#123456',
      template: { ...DEFAULT_TEMPLATE },
      verticalReference: 'CGVD2013',
      importedAt: '2026-11-15T00:00:00Z',
    }
    function open(paths: string[]) {
      const files = paths.map((p) => ({ name: p.split('/').pop()!, bytes: read(p) }))
      const r = roadEngProject(files, options)
      const demo = createDemoProject()
      const project = parseProject({
        ...demo,
        name: r.name,
        terrain: r.terrain,
        alignments: r.roads.map((x) => x.alignment),
        activeAlignmentId: r.roads[0].alignment.id,
        profiles: [],
        settings: { ...DEFAULT_ROAD_SETTINGS, ...(r.fillRate !== null ? { fillRate: r.fillRate } : {}) },
      })
      return { files, project }
    }
    function write(project: RoadProject) {
      const grid = roadEngExportGrid(
        project.terrain,
        exportGrid(project.terrain, project.alignments[0].points[0].coordinate),
      )
      return roadEngProjectExport({
        name: project.name,
        roads: project.alignments.map((alignment) => ({ alignment })),
        grid,
        context: [],
        cables: [],
        reference: [],
        fillRate: project.settings.fillRate,
        terrainSource: project.terrain.roadEngSource ?? null,
      })
    }
    const dsnOf = (zip: Uint8Array) => {
      for (const [name, bytes] of Object.entries(unzipSync(zip)))
        if (name.endsWith('.dsnx')) return strFromU8(unzipSync(bytes)['Location1.dsn'], true)
      throw Error('no design')
    }
    const section = (text: string, name: string) => {
      const start = text.indexOf(`[${name}]`)
      return text.slice(start, text.indexOf('\n[', start + 1))
    }

    it('reads Hart Rd’s rock fill, writes it back unedited and a moved end into its rows', () => {
      const paths = ['tutorial-v10/SoftreeOptimal/Hart Rd.dsnx', 'tutorial-v10/SoftreeOptimal/Hart Rd.terx']
      if (!paths.every(packed)) return
      const { files, project } = open(paths)
      const road = project.alignments[0]
      const fill = road.engineering!.fillRequirements!
      expect(fill.map((r) => r.materialId)).toEqual(['roadeng-GR', 'roadeng-SR', 'roadeng-GR'])
      const original = strFromU8(unzipSync(files[0].bytes)['Location1.dsn'], true)
      // Unedited: [LocationParms] comes back byte for byte.
      expect(section(dsnOf(write(project).bytes), 'LocationParms')).toBe(section(original, 'LocationParms'))
      // The rock fill extended 20 m: the SR row ends further on, *2 kept either side.
      const sr = fill[1]
      const moved = fill.map((r) =>
        r === sr ? { ...r, end: r.end + 20 } : r === fill[2] ? { ...r, start: r.start + 20 } : r,
      )
      const edited = write({
        ...project,
        alignments: [{ ...road, engineering: { ...road.engineering!, fillRequirements: moved } }],
      })
      const rows = section(dsnOf(edited.bytes), 'LocationParms')
        .split(/\r?\n/)
        .filter((l) => /^\d+=/.test(l))
      expect(rows.map((l) => l.split(',')[11])).toEqual(['*2', 'SR', '*2'])
      expect(rows[0].split('=')[1].split(',')[0]).toBe('346.214')
      const end = Number(rows[1].split('=')[1].split(',')[0])
      expect(end).toBeCloseTo(445.132 + 20 / road.roadEngSource!.stationScale!, 2)
      // Opened again, the requirement is where it was put.
      const again = roadEngProject([{ name: 'Hart Rd.zip', bytes: edited.bytes }], options)
      const back = again.roads[0].alignment.engineering!.fillRequirements!
      expect(back.map((r) => r.materialId)).toEqual(['roadeng-GR', 'roadeng-SR', 'roadeng-GR'])
      expect(back[1].end).toBeCloseTo(sr.end + 20, 3)
    })

    it('reads stage 8’s rip rap in feet and writes a changed range back in feet', () => {
      const p = 'tutorial-v10/RoadEngCivil/Location/Align stage 8.dsnx'
      if (!packed(p)) return
      const bytes = read(p)
      const [{ settings }] = readRoadEngSettings(bytes).parts
      const at = frameOf(bytes)
      const m = roadEngEngineeringFor(settings, at)
      const fill = m.engineering.fillRequirements!
      const rr = fill.find((r) => r.materialId === 'roadeng-RR')!
      expect([rr.start, rr.end].map((v) => Math.round(v * 1000) / 1000)).toEqual([396.24, 457.2])
      const parts = unzipSync(bytes)
      const dsnText = strFromU8(parts['Location1.dsn'], true),
        ds2Text = strFromU8(parts['Location1.ds2'], true)
      const original = { dsnText, ds2Text, unitM: 0.3048, startStation: at.startStation, endStation: at.endStation }
      const engineering = (fillRequirements: typeof fill) => ({
        name: 'Stage 8',
        engineering: { ...m.engineering, fillRequirements },
      })
      expect(roadEngFillWriteBack(engineering(fill), original, dsnText, {}).alignment).toEqual({})
      // Rip rap swapped for fractured rock: one row's code.
      const w = roadEngFillWriteBack(
        engineering(fill.map((r) => (r === rr ? { ...r, materialId: 'roadeng-FR' } : r))),
        original,
        dsnText,
        {},
      )
      expect(Object.keys(w.alignment.LocationParms ?? {})).toEqual(['2'])
      expect(
        w.alignment.LocationParms!['2']!.split(',').slice(0, 1).concat(w.alignment.LocationParms!['2']!.split(',')[11]),
      ).toEqual(['1500', 'FR'])
      const back = roadEngMaterialsFromText(mergeRoadEngIni(dsnText, w.alignment), ds2Text, at)
      expect(back.find((r) => Math.abs(r.start - 396.24) < 1e-6)?.materialId).toBe('roadeng-FR')
    })
  },
)

function roadEngMaterialsFromText(
  dsnText: string,
  ds2Text: string,
  at: { startStation: number; endStation: number; fallback: typeof DEFAULT_TEMPLATE },
) {
  return roadEngEngineeringFor(parseRoadEngSettings(dsnText, ds2Text, 0.3048), at).engineering.fillRequirements ?? []
}
