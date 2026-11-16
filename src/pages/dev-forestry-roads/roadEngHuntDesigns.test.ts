/**
 * Softree's public designs that assign benches, sub-cuts and barriers, read from where they were
 * downloaded (never committed): set ROADENG_HUNT to the folder holding Softree's knowledge-base
 * example files (`softree-kb/`), the V9 tutorials (`softree-training90/x/`) and the V10 tutorial
 * package (`softree-tutorial-v10/x/cab/`, the installer's files as 7-Zip extracts them). Each case
 * is skipped where its files are not there.
 *
 * - Road6 - 10 to 18 (V9 and V10 RoadEng Resource tutorial, LiDAR chapter): the LOWV template's
 *   Slope VI – Benches on both sides, BenchHeight 15 ft and BenchBaseWidth 10 ft as the tutorial
 *   sets them, assigned over the whole road.
 * - PartD (V9 RoadEng Civil As-Built tutorial): SSC2, a roadway that builds its own sub-cut.
 * - The ditch-profile example (`Example.dsnx`, SubCut I templates DI1–DI3) and the bridge-site
 *   example (`Bridge.dsnx`, a guard-rail bridge template), written back unedited.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { readRoadEngSettings, roadEngTemplateToPgmaps } from './roadEngDesignSettings'
import { roadEngProject, withRoadEngOriginal } from './roadEngProject'
import { roadEngExportGrid, roadEngProjectExport } from './roadEngProjectExport'
import { sha256Hex } from './roadEngTerrainOriginal'
import { parseProject } from './project'
import { createDemoProject, DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE, exportGrid, terrainFromMetadata } from './terrain'
import type { Coordinate } from './types'

const hunt = process.env.ROADENG_HUNT
const have = (...paths: string[]) => !!hunt && paths.every((p) => existsSync(join(hunt, p)))
const V10 = 'softree-tutorial-v10/x/cab'
const V9 = 'softree-training90/x/Training90'
const KB = 'softree-kb'
const ROAD6_16 = `${V10}/Road616.dsnx`
const ROAD6_TERRAIN = `${V10}/TopoRoad6Extension.terx`
const PART_D = `${V9}/RoadEngCivil/As-Built/PartD.dsnx`
const DITCH = `${KB}/creating-ditch-profile-reference-alignment/Example/Example`
const BRIDGE = `${KB}/bridge-site-design/Bridge_Site_From_Location_Example_Files/Bridge Site From Location Example Files`

const templateOf = (path: string, code: string) => {
  const settings = readRoadEngSettings(new Uint8Array(readFileSync(join(hunt!, path)))).parts[0].settings
  const t = settings.templates.find((x) => x.code === code)!
  return { settings, mapping: roadEngTemplateToPgmaps(t, { ...DEFAULT_TEMPLATE }) }
}

describe.skipIf(!hunt || !existsSync(hunt ?? ''))("Softree's public designs with benches and sub-cuts", () => {
  it.skipIf(!have(ROAD6_16))(
    'reads Road6 - 16: Slope VI benches as the tutorial sets them, five in cut and four in fill',
    () => {
      const { settings, mapping } = templateOf(ROAD6_16, 'LOWV')
      // The road uses LOWV everywhere.
      expect(settings.stationRanges.every((r) => r.leftTemplate === 'LOWV' && r.rightTemplate === 'LOWV')).toBe(true)
      // BenchHeight 15 ft, BenchBaseWidth 10 ft; BenchSlope 4 (rise over run) is a 0.25:1 face. This
      // older Slope VI draws five cut benches and four fill benches and has no MaxNumberBenches.
      expect(mapping.template!.benches).toEqual({
        cut: { heightM: 4.572, widthM: 3.048, faceSlope: 0.25, count: 5 },
        fill: { heightM: 4.572, widthM: 3.048, faceSlope: 0.25, count: 4 },
      })
      // Its closing slopes: FinalCutSlp 1 and FinalFillSlp 3, rise over run.
      expect(mapping.template).toMatchObject({ cutSlope: 1, fillSlope: 0.333333 })
    },
  )

  it.skipIf(!have(PART_D))("reads PartD's SSC2: the sub-cut its roadway builds under the subgrade", () => {
    const { mapping } = templateOf(PART_D, 'SSC2')
    // SC-Bot at CZ_DEPTH −0.8 m, the subgrade at SG_DEPTH −0.3 m; out CZ_WIDTH 4.5 m plus the
    // courses' runs (CSTC_THICK 0.3 over CSTC_SLOPE 1/3), then up a vertical CZ_EXT_SLOPE.
    expect(mapping.template!.subCut).toEqual({
      id: 'roadeng-SSC2-subcut-roadway',
      name: 'Rural w. Sub-cut SC-Bot',
      reference: 'subgrade',
      depthM: 0.5,
      widthM: 5.4,
    })
    expect(mapping.notes.join(' ')).toMatch(/builds a sub-cut under its subgrade \(SC-Bot\): 0\.5 m deep/)
  })

  it.skipIf(!have(`${DITCH}/Example.dsnx`))("reads the ditch-profile example's SubCut I templates", () => {
    for (const code of ['DI1', 'DI2', 'DI3']) {
      const { mapping } = templateOf(`${DITCH}/Example.dsnx`, code)
      // SubCutDepth 0.1, SubCutWidthL/R 1.77, SubCutSlopeOut 0.33333 (3:1), bApplySuper 0.
      expect(mapping.template!.subCut, code).toMatchObject({
        reference: 'merged',
        depthM: 0.1,
        widthM: 1.77,
        outsideSlope: 3.00003,
        followsCrossfall: false,
      })
    }
  })

  /** Opened as the page opens it, RoadEng's own Terrain1.ter kept beside the project; written back unedited. */
  async function roundTrip(files: { path: string; name?: string }[]) {
    const read = files.map((f) => ({
      name: f.name ?? f.path.split('/').pop()!,
      bytes: new Uint8Array(readFileSync(join(hunt!, f.path))),
    }))
    let n = 0
    const r = roadEngProject(read, {
      newId: () => `id${n++}`,
      color: () => '#123456',
      template: { ...DEFAULT_TEMPLATE },
      verticalReference: 'CGVD2013',
      importedAt: '2026-11-15T00:00:00Z',
    })
    const terrain = r.originalTer
      ? withRoadEngOriginal(r.terrain, { record: r.originalTer.record, sha256: await sha256Hex(r.originalTer.bytes) })
      : r.terrain
    const demo = createDemoProject()
    const project = parseProject(
      JSON.parse(
        JSON.stringify({
          ...demo,
          name: r.name,
          terrain,
          alignments: r.roads.map((x) => x.alignment),
          activeAlignmentId: r.roads[0].alignment.id,
          context: r.context,
          cables: r.cables,
          reference: r.reference,
          riggingSets: r.riggingSets,
          notes: r.mapNotes,
          referenceStyles: r.referenceStyles,
          profiles: [],
          settings: { ...DEFAULT_ROAD_SETTINGS, ...(r.fillRate !== null ? { fillRate: r.fillRate } : {}) },
        }),
      ),
    )
    const source = terrainFromMetadata(project.terrain)
    const out = roadEngProjectExport({
      name: project.name,
      roads: project.alignments.map((alignment) => ({ alignment })),
      grid: roadEngExportGrid(project.terrain, exportGrid(project.terrain, project.alignments[0].points[0].coordinate)),
      context: project.context,
      cables: project.cables,
      reference: project.reference ?? [],
      ...(source ? { elevationAt: (c: Coordinate) => source.elevationAt(c[0], c[1]) } : {}),
      fillRate: project.settings.fillRate,
      riggingSets: project.riggingSets ?? [],
      notes: project.notes ?? [],
      referenceStyles: project.referenceStyles ?? [],
      terrainSource: project.terrain.roadEngSource ?? null,
      terrain: project.terrain,
      originalTer: r.originalTer?.bytes ?? null,
    })
    const written: Record<string, Uint8Array> = {}
    for (const [name, bytes] of Object.entries(unzipSync(out.bytes)))
      if (/\.(dsnx|terx)$/i.test(name))
        for (const [part, data] of Object.entries(unzipSync(bytes)))
          written[`${/\.dsnx$/i.test(name) ? 'D' : 'T'}/${part}`] = data
    const text = (b: Uint8Array) => strFromU8(b, true)
    const lines = (b: Uint8Array, keep: (l: string) => boolean) => text(b).split(/\r?\n/).filter(keep)
    for (const f of read)
      for (const [part, bytes] of Object.entries(unzipSync(f.bytes))) {
        const name = `${/\.dsnx$/i.test(f.name) ? 'D' : 'T'}/${part}`
        const back = written[name]
        expect(back, name).toBeDefined()
        if (part.endsWith('.dsn')) {
          // RoadEng's .dsn, then [PGMaps].
          const cut = text(back).indexOf('[PGMaps]')
          expect(cut, name).toBeGreaterThan(0)
          expect(text(back).slice(0, cut), name).toBe(text(bytes))
        } else if (part.endsWith('.ds2')) {
          // Every record but the calculated stations (110), which the export rebuilds.
          const kept = (l: string) => !!l && !l.startsWith('110,')
          expect(lines(back, kept), name).toEqual(lines(bytes, kept))
        } else expect(Buffer.from(back).equals(Buffer.from(bytes)), name).toBe(true)
      }
  }

  it.skipIf(!have(ROAD6_16, ROAD6_TERRAIN))(
    'writes Road6 - 16 and its terrain back unedited',
    () => roundTrip([{ path: ROAD6_16 }, { path: ROAD6_TERRAIN, name: 'Topo Road6 Extension.terx' }]),
    300_000,
  )
  it.skipIf(!have(PART_D))('writes PartD back unedited', () => roundTrip([{ path: PART_D }]), 120_000)
  it.skipIf(!have(`${DITCH}/Example.dsnx`, `${DITCH}/Terrain.terx`))(
    'writes the ditch-profile example back unedited',
    () => roundTrip([{ path: `${DITCH}/Example.dsnx` }, { path: `${DITCH}/Terrain.terx` }]),
    120_000,
  )
  it.skipIf(!have(`${BRIDGE}/Bridge.dsnx`, `${BRIDGE}/OG3.terx`))(
    'writes the bridge-site example back unedited',
    () => roundTrip([{ path: `${BRIDGE}/Bridge.dsnx` }, { path: `${BRIDGE}/OG3.terx` }]),
    120_000,
  )
  // The driveway example is in US survey feet (`units=3048.00609601`, design and terrain).
  const DRIVEWAY = `${KB}/driveway-entrance-component/driveways1/driveways1`
  it.skipIf(!have(`${DRIVEWAY}/RuralWithDriveways.dsnx`, `${DRIVEWAY}/driveways1.terx`))(
    'opens the driveway example in US survey feet, design and terrain',
    () => {
      const read = (f: string) => ({ name: f, bytes: new Uint8Array(readFileSync(join(hunt!, `${DRIVEWAY}/${f}`))) })
      expect(readRoadEngSettings(read('RuralWithDriveways.dsnx').bytes).unitM).toBe(1200 / 3937)
      let n = 0
      const r = roadEngProject([read('RuralWithDriveways.dsnx'), read('driveways1.terx')], {
        newId: () => `id${n++}`,
        color: () => '#123456',
        template: { ...DEFAULT_TEMPLATE },
        verticalReference: 'CGVD2013',
      })
      // Its terrain names a US-foot state plane this workspace does not convert: the flat plane, in US feet.
      expect(r.localPlane?.unitM).toBe(1200 / 3937)
      expect(r.roads.map((x) => x.alignment.name)).toEqual([
        'RuralWithDriveways · Centerline Alignment 1',
        'RuralWithDriveways · DIL',
        'RuralWithDriveways · DIR',
      ])
      // The centreline's stations 100 to 3405 US ft (its own chainage from 30.480 m).
      const centre = r.roads[0]
      expect(centre.source.startStation).toBeCloseTo(100 * (1200 / 3937), 6)
    },
    120_000,
  )
})
