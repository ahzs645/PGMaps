/**
 * What Softree's public tutorial and knowledge-base designs show about the RoadEng fields no sample
 * of `ROADENG_SAMPLES` or `ROADENG_SAMPLE_PACK` tells apart: a placed culvert's option bits, the
 * `108` widening Auto bits, the Replaceable fill form and the stored costing's last two costs.
 *
 * `ROADENG_HUNT` names a folder holding, unchanged and never committed:
 * - `softree-tutorial-v11/x/cab/`: the files of Softree's public `RoadEng_Tutorial_11.exe`, its
 *   installer's cabinet extracted with 7z (the MSI's file keys as names: `Location18_1.dsnx`, …);
 * - `softree-tutorial-v10/x/cab/`: the same for `Softree_Tutorial_V10.exe` (`Road614.dsnx`,
 *   `Alignstage8.dsnx_1`, …);
 * - any further `.dsnx` (knowledge-base examples, the V9 training set), read where a test walks
 *   the whole folder.
 * Each check names the tutorial step it rests on. Nothing here is copied from those files.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  parseRoadEngSettings,
  readRoadEngIni,
  readRoadEngSettings,
  roadEngMaterialsFor,
  roadEngWideningFor,
} from './roadEngDesignSettings'
import {
  culvertsFromDesign,
  readPlacedCulvert,
  readRoadEngCulvertRecords,
  ROADENG_CULVERT_GRADIENT_AUTO,
  ROADENG_CULVERT_OVERRIDE,
  ROADENG_CULVERT_SKEW_AUTO,
  writeDesignCulverts,
} from './roadEngPlacedCulverts'
import { readRoadEngStoredResults, roadEngUnitMOfCode } from './roadEngStoredResults'
import { roadEngDesign } from './roadEngExport'
import { roadEngProject } from './roadEngProject'
import { localPlaneProjection } from './localPlane'
import { DEFAULT_TEMPLATE } from './terrain'

const hunt = process.env.ROADENG_HUNT
const v11 = (name: string) => join(hunt ?? '', 'softree-tutorial-v11', 'x', 'cab', name)
const v10 = (name: string) => join(hunt ?? '', 'softree-tutorial-v10', 'x', 'cab', name)

/** Every design under the folder (a ZIP whose name ends `.dsnx`, an MSI key's `_1` suffix allowed). */
function designs(root: string, out: string[] = []): string[] {
  for (const name of readdirSync(root).sort()) {
    const path = join(root, name)
    if (statSync(path).isDirectory()) designs(path, out)
    else if (/\.dsnx(_\d+)?$/i.test(name)) out.push(path)
  }
  return out
}
const parts = (path: string) => unzipSync(new Uint8Array(readFileSync(path)))
const text = (files: Record<string, Uint8Array>, name: string) => (files[name] ? strFromU8(files[name], true) : '')
const unitOf = (dsn: string) => roadEngUnitMOfCode(readRoadEngIni(dsn).get('design')?.get('units'))

describe('template layer materials (generated)', () => {
  it('reads a layer given a ground type and says it is not applied', () => {
    const dsn = [
      '[design]',
      'units=10000',
      '[TemplatesSct]',
      'RoadSurfaceCodes-0=SG|Subgrade material.,',
      'RoadSurfaceCodes-1=Layer 1 above subgrade,',
      'RoadSurfaceCodes-3=Srf3|Ballast course,GR',
    ].join('\r\n')
    const ds2 = '104,GR,Gravel,66.67,66.67,1,0.9,12,4,0,8,0.6,4,2.6,2,2,0,0,\r\n'
    const settings = parseRoadEngSettings(dsn, ds2, 1)
    expect(settings.templateLayerMaterials).toEqual([
      { layer: 3, code: 'Srf3', description: 'Ballast course', material: 'GR' },
    ])
    const read = roadEngMaterialsFor(settings, { startStation: 0, endStation: 100 })
    expect(read.unmapped.join(' ')).toMatch(/Template layer Srf3 \(Ballast course\) is built of GR/)
  })
})

describe.skipIf(!hunt || !existsSync(hunt ?? ''))(
  "Softree's tutorial and knowledge-base designs",
  { timeout: 120_000 },
  () => {
    it('culvert option bits: the V11 tutorial’s two culverts against the stream default they start from', () => {
      // RoadEng Resource tutorial (V11), chapter 17. Both culverts are added as natural channels from
      // the design's stream default; at 573.2 m Auto under Gradient is unticked and 5 % typed; at
      // 338 m Override is ticked (ditch 1 wide, 0.6 deep) and Auto under Skew unticked, 75° typed.
      for (const name of ['Location18_1.dsnx', 'Location18_2.dsnx', 'Location18_3.dsnx']) {
        const files = parts(v11(name))
        const dsn = text(files, 'Location1.dsn')
        const def = /^DefStreamCulvert=(.*)$/m.exec(dsn)![1].trim()
        const start = readPlacedCulvert(def, 1)!
        expect(start.flags).toBe(414)
        expect(start.auto).toEqual({ skew: true, gradient: true, length: true })
        const [at338, at573] = readRoadEngCulvertRecords(files['Location1.ds1'])!.map((r) => readPlacedCulvert(r, 1)!)
        expect(at573.stationM).toBe(573.2)
        expect(at573.flags).toBe(start.flags! & ~ROADENG_CULVERT_GRADIENT_AUTO)
        expect(at573.auto).toEqual({ skew: true, gradient: false, length: true })
        expect(at573.gradientPercent).toBe(5)
        expect(at573.override!.on).toBe(false)
        expect(at338.stationM).toBe(338)
        expect(at338.flags).toBe((start.flags! & ~ROADENG_CULVERT_SKEW_AUTO) | ROADENG_CULVERT_OVERRIDE)
        expect(at338.auto).toEqual({ skew: false, gradient: true, length: true })
        expect(at338.skewFromLineDeg).toBe(75)
        expect(at338.override).toEqual({ on: true, ditchWidthM: 1, ditchDepthM: 0.6, offsetM: 3, taperM: 2 })
      }
    })

    it('culvert option bits: the V10 tutorials’ culverts', () => {
      // RoadEng Civil (V10) chapter 24: a 60" stream pipe, Vertical Position Attach to upper
      // ditch/catch point, Auto skew, gradient and length left on. Resource Road chapter 20: a 24" pipe,
      // the same position.
      const stage8 = readPlacedCulvert(
        readRoadEngCulvertRecords(parts(v10('Alignstage8.dsnx_1'))['Location1.ds1'])![0],
        0.3048,
      )!
      expect(stage8.diameterM).toBeCloseTo(1.524, 9)
      expect(stage8.auto).toEqual({ skew: false, gradient: true, length: true })
      const road6 = readPlacedCulvert(
        readRoadEngCulvertRecords(parts(v10('Road614.dsnx'))['Location1.ds1'])![0],
        0.3048,
      )!
      expect(road6.diameterM).toBeCloseTo(0.6096, 9)
      expect(road6.auto).toEqual({ skew: true, gradient: true, length: true })
      // Stage 15 onward also hold a floating label in section 1, whose stated byte count is one short.
      const later = parts(v10('Road618.dsnx'))['Location1.ds1']
      expect(readRoadEngCulvertRecords(later)).toHaveLength(1)
      // Bit 3 is set on both (Attach); which bit pattern the other three positions take is not shown.
      expect(stage8.flags! & 8).toBe(8)
      expect(road6.flags! & 8).toBe(8)
    })

    it('opens Road 6 stage 18 with its culvert behind a floating label, and writes its .ds1 back as read', () => {
      const name = 'Road618.dsnx'
      const bytes = new Uint8Array(readFileSync(v10(name)))
      let id = 0
      const opts = {
        newId: () => `h${id++}`,
        color: () => '#123456',
        template: { ...DEFAULT_TEMPLATE },
        verticalReference: '',
      }
      const r = roadEngProject([{ name, bytes }], opts)
      const alignment = r.roads[0].alignment
      expect(alignment.engineering!.culverts.map((c) => c.name)).toEqual(['24" Diameter Pipe'])
      expect(alignment.engineering!.culverts[0].diameterM).toBeCloseTo(0.6096, 9)
      const toGrid = localPlaneProjection(r.localPlane!.offsetM).toFile
      const once = roadEngDesign([{ alignment, source: alignment.roadEngSource }], toGrid).bytes
      expect(unzipSync(once)['Location1.ds1']).toEqual(unzipSync(bytes)['Location1.ds1'])
    })

    it('every design’s culverts: the override bit is field 13, and an unedited .ds1 goes back byte for byte', () => {
      let records = 0
      for (const path of designs(hunt!)) {
        let files: Record<string, Uint8Array>
        try {
          files = parts(path)
        } catch {
          continue
        }
        for (const name of Object.keys(files).filter((n) => /^Location\d+\.ds1$/i.test(n))) {
          const unitM = unitOf(text(files, name.replace(/1$/, 'n')))
          if (unitM === null) continue
          const ds1 = files[name]
          const read = readRoadEngCulvertRecords(ds1)
          expect(read, path).not.toBeNull()
          for (const raw of read!) {
            const f = readPlacedCulvert(raw, unitM)!
            records++
            expect(((f.flags ?? 0) & ROADENG_CULVERT_OVERRIDE) !== 0, `${path}: ${raw}`).toBe(f.override?.on === true)
          }
          const frame = { startStation: 0, endStation: 1e9, stationScale: 1 }
          let id = 0
          const { culverts } = culvertsFromDesign(ds1, { unitM, frame, newId: () => `c${id++}` })
          const out = writeDesignCulverts({ ds1, unitM, frame, read: true }, culverts, {
            unitM,
            startStation: 0,
            stationScale: 1,
          })
          expect(out.ds1, path).toEqual(ds1)
        }
      }
      expect(records).toBeGreaterThanOrEqual(20)
    })

    it('108 widening bits: inside Auto is bit 7; outside Auto is bit 12 with bit 5 clear, never apart in any design', () => {
      const seen = { insideTable: 0, insideOwn: 0, outsideTable: 0, outsideOwn: 0, minimumRadius: 0 }
      for (const path of designs(hunt!)) {
        let read
        try {
          read = readRoadEngSettings(new Uint8Array(readFileSync(path)))
        } catch {
          continue
        }
        for (const { settings } of read.parts) {
          const widening = roadEngWideningFor(settings)
          for (const c of widening.comparison) {
            const raw = settings.curves.find((k) => k.pi === c.pi)!.raw
            const flags = Number(raw[9])
            if (!Number.isInteger(flags)) continue
            // Bits 5 and 12 are set together on no curve and clear together on none: either may be
            // the outside Auto box (bit 1, the other candidate, is Use Minimum Radius: e is e max).
            expect(((flags >> 5) & 1) ^ ((flags >> 12) & 1), `${path} PI ${c.pi}`).toBe(1)
            if (flags & 2) {
              expect(Number(raw[15]), `${path} PI ${c.pi}`).toBeCloseTo(Number(raw[10]), 12)
              seen.minimumRadius++
            }
            if (c.tableM === null || c.tableM <= 0) continue
            const insideIsTable = Math.abs(c.roadEngInsideM - c.tableM) <= 0.005
            const outsideIsTable = Math.abs(c.roadEngOutsideM - c.tableM) <= 0.005
            expect(insideIsTable, `${path} PI ${c.pi} inside`).toBe((flags & 128) !== 0)
            expect(outsideIsTable, `${path} PI ${c.pi} outside`).toBe((flags & 4096) !== 0)
            seen[insideIsTable ? 'insideTable' : 'insideOwn']++
            seen[outsideIsTable ? 'outsideTable' : 'outsideOwn']++
          }
        }
      }
      // Each state is seen on curves whose table gives widening.
      for (const v of Object.values(seen)) expect(v).toBeGreaterThan(0)
    })

    it('a Replaceable fill range is the plain row: tutorial ranges stated replaceable carry no mark', () => {
      // RoadEng Resource tutorial (V11), chapter 13: Location 13_2 → 13_3 assigns CO Common Fill (Q2)
      // over the whole road with Replaceable (quality based) ticked; chapter 25 states CO and SI are
      // replaceable in Location 25_x.
      const rows = (name: string) => [...readRoadEngIni(text(parts(v11(name)), 'Location1.dsn')).get('LocationParms')!]
      const before = rows('Location13_2.dsnx').filter(([k]) => /^\d+$/.test(k))
      const after = rows('Location13_3.dsnx').filter(([k]) => /^\d+$/.test(k))
      expect(after).toHaveLength(before.length)
      after.forEach(([k, v], i) => {
        const a = before[i][1].split(','),
          b = v.split(',')
        expect(k).toBe(before[i][0])
        expect(a[11]).toBe('*1')
        expect(b[11]).toBe('CO')
        expect(b.filter((_, j) => j !== 11)).toEqual(a.filter((_, j) => j !== 11))
      })
      // Template Materials (chapter 25, step 9): Srf4 takes FR with Replaceable unticked.
      const tpl = readRoadEngIni(text(parts(v11('Location25_4.dsnx')), 'Location1.dsn')).get('TemplatesSct')!
      expect(tpl.get('RoadSurfaceCodes-4')).toBe('Srf4|Layer 4 above subgrade,FR')
      expect(tpl.get('RoadSurfaceCodes-0')).toBe('SG|Subgrade material.,')
      const settings = readRoadEngSettings(new Uint8Array(readFileSync(v11('Location25_4.dsnx')))).parts[0].settings
      expect(settings.templateLayerMaterials).toEqual([
        { layer: 4, code: 'Srf4', description: 'Layer 4 above subgrade', material: 'FR' },
      ])
    })

    it('stored costings: pit opening and attributes are 0 (or no value) in every solved one', () => {
      let solved = 0
      for (const path of designs(hunt!)) {
        let files: Record<string, Uint8Array>
        try {
          files = parts(path)
        } catch {
          continue
        }
        for (const name of Object.keys(files).filter((n) => /^Location\d+\.dsn$/i.test(n))) {
          const dsn = text(files, name)
          const unitM = unitOf(dsn)
          if (unitM === null) continue
          for (const s of readRoadEngStoredResults(dsn, unitM).solutions) {
            solved++
            expect(s.costs.pitOpening, path).toBe(0)
            expect([0, null], path).toContain(s.costs.attributes)
          }
        }
      }
      expect(solved).toBeGreaterThan(50)
    })
  },
)
