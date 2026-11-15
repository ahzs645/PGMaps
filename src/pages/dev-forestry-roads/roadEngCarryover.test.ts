import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import proj4 from 'proj4'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { projectedCrsDefinition } from '@/lib/geo/projectedCrs'
import { analyzeRoad, offsetCoordinate } from './engine'
import { createEngineeringDesign } from './engineeringTypes'
import type { XY } from './landXmlImport'
import { roadEngDesign } from './roadEngExport'
import { parseRoadEngDesign } from './roadEngImport'
import { roadEngProject } from './roadEngProject'
import { roadEngDesignRoads, roadEngExportGrid, roadEngProjectExport } from './roadEngProjectExport'
import { parseProject } from './project'
import { createDemoProject, DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE, exportGrid } from './terrain'
import type { Alignment, Coordinate, TerrainSource } from './types'

// A road made here, with what a RoadEng design carries for it: template ranges with transitions,
// minimum vertical curve and tangent lengths, and costs RoadEng has no field for. Written as a
// RoadEng design and opened again, unedited and after a stand-in for a save in RoadEng.
const utm10 = proj4('EPSG:4326', projectedCrsDefinition(26910)!)
const toGrid = (c: Coordinate) => utm10.forward([...c]) as XY
const origin = utm10.inverse([515_000, 5_975_000]) as Coordinate
const ground: TerrainSource = { elevationAt: (lon, lat) => 800 + 0.02 * (toGrid([lon, lat])[1] - 5_975_000) }
const options = {
  newId: (() => {
    let n = 0
    return () => `id${n++}`
  })(),
  color: () => '#123456',
  template: { ...DEFAULT_TEMPLATE },
  verticalReference: 'CGVD2013',
}

function road(): Alignment {
  const engineering = createEngineeringDesign()
  engineering.templates.push({
    id: 'wide',
    name: 'Wide bench',
    template: { ...DEFAULT_TEMPLATE, leftWidth: 5, rightWidth: 5 },
  })
  engineering.assignments.push({
    id: 'w',
    start: 100,
    end: 300,
    templateId: 'wide',
    side: 'both',
    transitionM: 0,
    transitionInM: 20,
    transitionOutM: 15,
  })
  engineering.haul = {
    ...engineering.haul,
    enabled: true,
    wasteRate: 3.5,
    borrowRate: 14,
    mobilizationCost: 25_000,
    contingencyPercent: 12,
    allocation: 'economic',
  }
  return {
    id: 'r',
    name: 'Spur 9',
    color: '#000000',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: offsetCoordinate(origin, 0, 400), radiusM: 0 },
    ],
    vertical: [
      { id: 's', chainage: 0, elevation: 800, curveLength: 0 },
      { id: 'm', chainage: 200, elevation: 806, curveLength: 60 },
      { id: 'e', chainage: 400, elevation: 806, curveLength: 0 },
    ],
    template: { ...DEFAULT_TEMPLATE, leftWidth: 3.7 },
    overrides: [],
    engineering,
    verticalStandards: {
      gradeRanges: [{ id: 'g', start: null, end: null, minGradePercent: -10, maxGradePercent: 10 }],
      minSagK: null,
      minCrestK: null,
      minCurveLengthM: 50,
      minTangentLengthM: 30,
    },
  }
}

const write = (alignment: Alignment) => {
  const prepared = roadEngDesignRoads(
    [{ alignment, analysis: analyzeRoad(alignment, ground, DEFAULT_ROAD_SETTINGS) }],
    toGrid,
    26910,
  )
  const design = roadEngDesign(prepared.roads, toGrid)
  return { ...design, notes: [...prepared.notes, ...design.notes] }
}
const open = (bytes: Uint8Array) => roadEngProject([{ name: 'Spur 9.dsnx', bytes }], options)

describe('a RoadEng design written here and opened again', () => {
  it('comes back with its transitions, minimum lengths and costs', () => {
    const written = write(road())
    const dsn = written.parts['Location1.dsn']
    expect(dsn).toMatch(/^\[PGMaps\]$/m)
    expect(dsn).toMatch(/^Costs=\{"version":1,"haul":\{"borrowRate":14,"wasteRate":3.5,/m)
    expect(dsn).toMatch(/^Native=[0-9a-z]+-[0-9a-f]{8}$/m)
    expect(written.notes.join(' ')).toMatch(/travel in the design's \[PGMaps\] section/)
    const back = open(written.bytes).roads[0].alignment
    expect(back.engineering!.assignments[0]).toMatchObject({ transitionInM: 20, transitionOutM: 15 })
    expect(back.verticalStandards).toMatchObject({ minCurveLengthM: 50, minTangentLengthM: 30 })
    expect(back.engineering!.haul).toMatchObject({ wasteRate: 3.5, borrowRate: 14, mobilizationCost: 25_000 })
  })

  it("reads RoadEng's own settings once RoadEng saved it, and the costs it has no field for from [PGMaps]", () => {
    const written = unzipSync(write(road()).bytes)
    // A save in RoadEng rewrites its own parts; here one key changes, as an edit there would.
    const dsn = strFromU8(written['Location1.dsn'], true).replace('[design]\r\n', '[design]\r\nInitialIndex=3\r\n')
    const saved = zipSync({ ...written, 'Location1.dsn': strToU8(dsn, true) })
    expect(parseRoadEngDesign(saved).alignments[0].pgmaps?.nativeChanged).toBe(true)
    const opened = open(saved)
    expect(opened.notes.join(' ')).toMatch(/Spur 9 was saved in RoadEng after this workspace wrote it/)
    const back = opened.roads[0].alignment
    // The section this workspace wrote stays: the design holds no RoadEng template of its own.
    expect(back.template.leftWidth).toBe(3.7)
    expect(back.vertical[1].elevation).toBeCloseTo(806, 3)
    // The optimizer standards are RoadEng's, minimum lengths included.
    expect(back.verticalStandards).toMatchObject({ minCurveLengthM: 50, minTangentLengthM: 30 })
    // RoadEng's haul records, and the rest from the carryover.
    expect(back.engineering!.haul).toMatchObject({
      wasteRate: 3.5,
      borrowRate: 14,
      mobilizationCost: 25_000,
      contingencyPercent: 12,
      allocation: 'economic',
    })
    expect(opened.notes).toContain("Costs RoadEng has no field for came back from the design's [PGMaps] section.")
  })
})

const samples = process.env.ROADENG_SAMPLES

describe.skipIf(!samples || !existsSync(samples ?? ''))('Softree sample designs', { timeout: 60_000 }, () => {
  it('hold no Taper range: the [LocationParms] template codes of every sample', () => {
    const codes = new Set<string>()
    for (const path of [
      'LongRoad_1/LongRoad 1.dsnx',
      'Cul-de-sac-design/CulDeSacExample/CulDeSacExample.dsnx',
      'Cul-de-sac-design/CulDeSacExample/CulDeSacExampleComplete.dsnx',
      'RoadEng-LandXML-Civil-3D/Align stage 1.dsnx',
    ]) {
      const files = unzipSync(new Uint8Array(readFileSync(join(samples!, path))))
      for (const [name, bytes] of Object.entries(files))
        if (/\.dsn$/i.test(name)) {
          const text = strFromU8(bytes, true)
          const section = /\[LocationParms\]([\s\S]*?)(\r?\n\[|$)/.exec(text)?.[1] ?? ''
          for (const row of section.split(/\r?\n/))
            if (/^\d+=/.test(row))
              row
                .split(',')
                .slice(17, 19)
                .forEach((c) => codes.add(c.trim()))
        }
    }
    expect([...codes].sort()).toEqual(['BR', 'DF', 'LLB', 'PGR', 'PGRB', 'PRC'])
  })

  it('writes LongRoad edited here back into RoadEng fields, and a RoadEng save reads them back', () => {
    const files = ['LongRoad_1/LongRoad 1.dsnx', 'LongRoad_1/LongRoad 1.terx'].map((p) => ({
      name: p.split('/').pop()!,
      bytes: new Uint8Array(readFileSync(join(samples!, p))),
    }))
    const read = roadEngProject(files, { ...options, importedAt: '2026-11-14T00:00:00Z' })
    const demo = createDemoProject()
    const project = parseProject({
      ...demo,
      name: read.name,
      terrain: read.terrain,
      alignments: read.roads.map((x) => x.alignment),
      activeAlignmentId: read.roads[0].alignment.id,
      profiles: [],
      settings: { ...DEFAULT_ROAD_SETTINGS, ...(read.fillRate !== null ? { fillRate: read.fillRate } : {}) },
    })
    const road = project.alignments[0]
    // Read from RoadEng: Curves and tangents [Slow], one 100 m minimum for both.
    expect(road.verticalStandards).toMatchObject({ minCurveLengthM: 100, minTangentLengthM: 100 })
    const engineering = road.engineering!
    const edited = {
      ...road,
      verticalStandards: { ...road.verticalStandards!, minCurveLengthM: 60, minTangentLengthM: 40 },
      engineering: {
        ...engineering,
        assignments: engineering.assignments.map((a, k) =>
          k === 0 ? { ...a, transitionInM: 40, transitionOutM: 30 } : a,
        ),
        haul: { ...engineering.haul, contingencyPercent: 12, mobilizationCost: 50_000 },
      },
    }
    const grid = roadEngExportGrid(project.terrain, exportGrid(project.terrain, road.points[0].coordinate))
    const out = roadEngProjectExport({
      name: project.name,
      roads: [{ alignment: edited }],
      grid,
      context: [],
      cables: [],
      reference: [],
      fillRate: project.settings.fillRate,
      riggingSets: [],
      notes: [],
      referenceStyles: [],
      terrainSource: project.terrain.roadEngSource ?? null,
      wholeTerrain: false,
    })
    const outer = unzipSync(out.bytes)
    const dsnxName = Object.keys(outer).find((n) => n.endsWith('.dsnx'))!
    const design = unzipSync(outer[dsnxName])
    const dsn = strFromU8(design['Location1.dsn'], true)
    // The transitions are Taper rows of [LocationParms]; the minimum lengths the optimizer's fields.
    const rows = /\[LocationParms\]([\s\S]*?)\r\n\[/.exec(dsn)![1]
    expect(rows).toMatch(/^1=1240\.0\d+,(?:[^,]*,){16}TP,TP,/m)
    expect(rows).toMatch(/^3=3600,(?:[^,]*,){16}TP,TP,/m)
    const fields = /^OptParmsNew=(.*)\r$/m.exec(dsn)![1].split(',')
    expect([fields[3], fields[11], fields[28]]).toEqual(['60', '23', '40'])
    expect(dsn).toMatch(/^Costs=\{"version":1,"haul":\{"mobilizationCost":50000,"contingencyPercent":12\}\}\r$/m)
    // Saved in RoadEng: its own [LocationParms] and optimizer are read, the costs from [PGMaps].
    const saved = zipSync({
      ...design,
      'Location1.dsn': strToU8(dsn.replace('[design]\r\n', '[design]\r\nInitialIndex=3\r\n'), true),
    })
    const back = roadEngProject([{ name: 'LongRoad 1.dsnx', bytes: saved }, files[1]], options)
    const again = back.roads[0].alignment
    expect(back.notes.join(' ')).toMatch(/was saved in RoadEng after this workspace wrote it/)
    const first = again.engineering!.assignments[0]
    expect(first.start).toBeCloseTo(engineering.assignments[0].start, 2)
    expect(first.transitionInM).toBeCloseTo(40, 2)
    expect(first.transitionOutM).toBeCloseTo(30, 2)
    expect(again.verticalStandards).toMatchObject({ minCurveLengthM: 60, minTangentLengthM: 40 })
    expect(again.engineering!.haul).toMatchObject({ contingencyPercent: 12, mobilizationCost: 50_000 })
  })
})
