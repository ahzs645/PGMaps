import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import proj4 from 'proj4'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { projectedCrsDefinition } from '@/lib/geo/projectedCrs'
import { analyzeRoad } from './engine'
import type { XY } from './landXmlImport'
import { localPlaneProjection } from './localPlane'
import { roadEngDesign } from './roadEngExport'
import { roadEngProject, withRoadEngOriginal } from './roadEngProject'
import { roadEngExportGrid, roadEngProjectExport } from './roadEngProjectExport'
import { parseProject } from './project'
import { parseRoadEngTer, readRoadEngTerrainArchive } from './roadEngTerrain'
import { sha256Hex } from './roadEngTerrainOriginal'
import { createDemoProject, DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE, exportGrid, terrainFromMetadata } from './terrain'
import type { Alignment, Coordinate, RoadProject } from './types'

const utm10 = proj4('EPSG:4326', projectedCrsDefinition(26910)!)
const lonLat = (x: number, y: number) => utm10.inverse([515_000 + x, 5_975_000 + y]) as Coordinate
const road: Alignment = {
  id: 'r',
  name: 'Spur 7',
  color: '#000000',
  points: [
    { id: 'a', coordinate: lonLat(0, 0), radiusM: 0 },
    { id: 'b', coordinate: lonLat(200, 150), radiusM: 60 },
    { id: 'c', coordinate: lonLat(380, 160), radiusM: 0 },
  ],
  vertical: [],
  template: { ...DEFAULT_TEMPLATE },
  overrides: [],
}
let n = 0
const options = {
  newId: () => `id${n++}`,
  color: () => '#123456',
  template: { ...DEFAULT_TEMPLATE },
  verticalReference: '',
}
const utmGrid = { epsg: 26910, toGrid: (c: Coordinate) => utm10.forward([...c]) as XY }

describe('RoadEng project export', () => {
  it('writes a design opened without a CRS back in its own file coordinates, with its layers', () => {
    // A ground-only design with no terrain opens on the flat plane, its station levels its ground.
    const sloped = { elevationAt: (lon: number, lat: number) => 800 + 0.05 * (utm10.forward([lon, lat])[0] - 515_000) }
    const design = roadEngDesign(
      [{ alignment: road, analysis: analyzeRoad(road, sloped, DEFAULT_ROAD_SETTINGS) }],
      utmGrid.toGrid,
    ).bytes
    const opened = roadEngProject([{ name: 'Spur 7.dsnx', bytes: design }], options)
    expect(opened.localPlane).not.toBeNull()
    const terrain = opened.terrain
    const onPlane = opened.roads[0].alignment
    const plane = localPlaneProjection(opened.localPlane!.offsetM)
    const stream = {
      id: 's',
      name: 'Willow Creek',
      kind: 'stream' as const,
      geometry: {
        type: 'LineString' as const,
        coordinates: [plane.toLonLat([515_050, 5_975_000]), plane.toLonLat([515_060, 5_975_300])],
      },
    }
    const cable = {
      id: 'd',
      name: 'Setting 4',
      start: plane.toLonLat([515_300, 5_975_250]),
      end: plane.toLonLat([515_380, 5_975_330]),
      startHeight: 18,
      endHeight: 8,
      deflectionPercent: 5,
    }
    const grid = roadEngExportGrid(terrain, utmGrid)
    expect(grid.epsg).toBeNull()
    const written = roadEngProjectExport({
      name: 'Spur 7',
      roads: [{ alignment: onPlane }],
      grid,
      context: [stream],
      cables: [cable],
      reference: [],
    })
    expect(written.fileName).toBe('Spur 7.zip')
    expect(Object.keys(unzipSync(written.bytes)).sort()).toEqual(['Spur 7.dsnx', 'Spur 7.terx'])
    // Opened again: on the plane at the same file coordinates, its layers the same objects.
    const again = roadEngProject([{ name: 'Spur 7.zip', bytes: written.bytes }], options)
    // The plane centres on everything read, now the layers too; what holds is each file coordinate.
    const planeAgain = localPlaneProjection(again.localPlane!.offsetM)
    again.roads[0].alignment.points.forEach((p, k) => {
      const [x, y] = planeAgain.toFile(p.coordinate),
        [x0, y0] = plane.toFile(onPlane.points[k].coordinate)
      expect(Math.hypot(x - x0, y - y0)).toBeLessThan(0.001)
    })
    // Its ground went out as station levels and came back as the design file's ground.
    expect(onPlane.fileGround!.points.length).toBeGreaterThanOrEqual(2)
    expect(again.roads[0].alignment.fileGround!.points.at(-1)![1]).toBeCloseTo(onPlane.fileGround!.points.at(-1)![1], 2)
    expect(again.context.map((f) => [f.kind, f.name])).toEqual([['stream', 'Sml Stream - Willow Creek']])
    expect(again.cables).toHaveLength(1)
    const [cx, cy] = planeAgain.toFile(again.cables[0].start)
    expect(Math.hypot(cx - 515_300, cy - 5_975_250)).toBeLessThan(0.001)
    expect(written.notes).toContain(
      'This project has no terrain grid with levels to write, so the RoadEng project goes without ground.',
    )
  })
})

/** Each part of a zipped RoadEng project, by `D/` (design) or `T/` (terrain) and its name inside. */
function projectParts(zip: Uint8Array): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {}
  for (const [name, bytes] of Object.entries(unzipSync(zip)))
    if (/\.(dsnx|terx)$/i.test(name))
      for (const [part, data] of Object.entries(unzipSync(bytes)))
        out[`${/\.dsnx$/i.test(name) ? 'D' : 'T'}/${part}`] = data
  return out
}
/** INI text by section, each section's non-blank lines in order; the appended [PGMaps] section left out. */
function sections(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  let current = ''
  for (const line of text.split(/\r?\n/)) {
    const header = /^\[(.+)\]$/.exec(line.trim())
    if (header) current = header[1]
    else if (current !== 'PGMaps' && line.trim()) out.set(current, [...(out.get(current) ?? []), line])
  }
  return out
}
/** The sections two .dsn texts differ in, [PGMaps] aside. */
function changedSections(a: string, b: string): string[] {
  const x = sections(a),
    y = sections(b)
  return [...new Set([...x.keys(), ...y.keys()])].filter(
    (k) => JSON.stringify(x.get(k) ?? []) !== JSON.stringify(y.get(k) ?? []),
  )
}
/** A .dsn written back is the original, then the appended [PGMaps] section. */
function keptDsn(original: string, written: string) {
  const cut = written.indexOf('[PGMaps]')
  expect(cut).toBeGreaterThan(0)
  expect(written.slice(0, cut)).toBe(original)
}
const keptRecords = (text: string) => text.split(/\r?\n/).filter((l) => l && !/^(108|109|110),/.test(l))

describe('RoadEng project written back', () => {
  it('writes an alignment RoadEng left unnamed back unnamed, until the road is renamed', () => {
    const sloped = { elevationAt: (lon: number, lat: number) => 800 + 0.05 * (utm10.forward([lon, lat])[0] - 515_000) }
    const parts = unzipSync(
      roadEngDesign([{ alignment: road, analysis: analyzeRoad(road, sloped, DEFAULT_ROAD_SETTINGS) }], utmGrid.toGrid)
        .bytes,
    )
    // RoadEng's own designs often hold no [HAlignOptions]: the import names the road after the file.
    const dsn = strFromU8(parts['Location1.dsn'], true).replace(/\[HAlignOptions\]\r?\n[^[]*/, '')
    expect(dsn).not.toMatch(/HAlignOptions/)
    const bytes = zipSync({ ...parts, 'Location1.dsn': strToU8(dsn, true) })
    const opened = roadEngProject([{ name: 'Creek Road.dsnx', bytes }], { ...options, epsg: 26910, noCrs: 'ask' })
    const alignment = opened.roads[0].alignment
    expect(alignment.name).toBe('Creek Road')
    expect(alignment.roadEngSource?.importedName).toBe('Creek Road')
    const written = (a: Alignment) =>
      strFromU8(
        projectParts(
          roadEngProjectExport({
            name: 'Creek Road',
            roads: [{ alignment: a }],
            grid: { epsg: 26910, toGrid: utmGrid.toGrid, raster: null },
            context: [],
            cables: [],
            reference: [],
          }).bytes,
        )['D/Location1.dsn'],
        true,
      )
    expect(written(alignment)).not.toMatch(/HAlignOptions/)
    expect(written({ ...alignment, name: 'Willow Spur' })).toMatch(/\[HAlignOptions\]\r?\nOption, 1=Willow Spur/)
  })

  it('writes a design it read back with its .dsn and kept records unchanged, and an edit where it belongs', () => {
    const sloped = { elevationAt: (lon: number, lat: number) => 800 + 0.05 * (utm10.forward([lon, lat])[0] - 515_000) }
    const design = roadEngDesign(
      [{ alignment: road, analysis: analyzeRoad(road, sloped, DEFAULT_ROAD_SETTINGS) }],
      utmGrid.toGrid,
      { terrainName: 'Valley.terx' },
    ).bytes
    const opened = roadEngProject([{ name: 'Spur 7.dsnx', bytes: design }], options)
    const project = parseProject({
      ...createDemoProject(),
      terrain: opened.terrain,
      alignments: opened.roads.map((r) => r.alignment),
      activeAlignmentId: opened.roads[0].alignment.id,
      profiles: [],
    })
    expect(project.alignments[0].roadEngSource).toMatchObject({ part: 'Location1', startStation: 0 })
    const grid = roadEngExportGrid(project.terrain, utmGrid)
    const write = (alignment: Alignment) =>
      projectParts(
        roadEngProjectExport({
          name: 'Spur 7',
          roads: [{ alignment }],
          grid,
          context: [
            {
              id: 's',
              name: 'Willow Creek',
              kind: 'stream',
              geometry: { type: 'LineString', coordinates: [lonLat(50, 0), lonLat(60, 300)] },
            },
          ],
          cables: [],
          reference: [],
        }).bytes,
      )
    const before = unzipSync(design)
    const after = write(project.alignments[0])
    const text = (b: Uint8Array) => strFromU8(b, true)
    // The design names its terrain Valley.terx, so the written project keeps that name and its .dsn
    // comes back as it was apart from [PGMaps], which this workspace rewrites.
    expect(changedSections(text(before['Location1.dsn']), text(after['D/Location1.dsn']))).toEqual([])
    expect(keptRecords(text(after['D/Location1.ds2']))).toEqual(keptRecords(text(before['Location1.ds2'])))
    // A wider road: the section goes back in [PGMaps], since this design holds no RoadEng template.
    const wider = write({ ...project.alignments[0], template: { ...project.alignments[0].template, leftWidth: 5 } })
    expect(changedSections(text(before['Location1.dsn']), text(wider['D/Location1.dsn']))).toEqual([])
    expect(text(wider['D/Location1.dsn'])).toMatch(/"leftWidth":5/)
  })
})

// Softree's published samples, read from a local copy and never committed (see roadEngImport.test.ts).
const samples = process.env.ROADENG_SAMPLES
describe.skipIf(!samples || !existsSync(samples ?? ''))(
  'Softree sample written back as a project',
  { timeout: 60_000 },
  () => {
    it('writes LongRoad with its terrain, and it opens on the same ground', () => {
      const file = (p: string) => ({
        name: p.split('/').pop()!,
        bytes: new Uint8Array(readFileSync(join(samples!, p))),
      })
      const opened = roadEngProject([file('LongRoad_1/LongRoad 1.dsnx'), file('LongRoad_1/LongRoad 1.terx')], {
        ...options,
        verticalReference: 'CGVD2013',
      })
      const utm15 = proj4('EPSG:4326', projectedCrsDefinition(26915)!)
      const grid = roadEngExportGrid(opened.terrain, { epsg: 26915, toGrid: (c) => utm15.forward([...c]) as XY })
      expect(grid.raster).not.toBeNull()
      const written = roadEngProjectExport({
        name: 'LongRoad 1',
        roads: [{ alignment: opened.roads[0].alignment }],
        grid,
        context: [],
        cables: [],
        reference: [],
      })
      const again = roadEngProject([{ name: 'LongRoad 1.zip', bytes: written.bytes }], {
        ...options,
        verticalReference: 'CGVD2013',
      })
      expect(again.epsg).toBe(26915)
      const analysis = analyzeRoad(again.roads[0].alignment, terrainFromMetadata(again.terrain)!, DEFAULT_ROAD_SETTINGS)
      expect(analysis.completeLength / analysis.length).toBeGreaterThan(0.95)
    })

    const sample = (p: string) => ({
      name: p.split('/').pop()!,
      bytes: new Uint8Array(readFileSync(join(samples!, p))),
    })
    /** A sample opened as the page opens it, as a project that parses. */
    function open(paths: string[]) {
      const files = paths.map(sample)
      const r = roadEngProject(files, { ...options, verticalReference: 'CGVD2013', importedAt: '2026-11-14T00:00:00Z' })
      const demo = createDemoProject()
      const project = parseProject({
        ...demo,
        name: r.name,
        terrain: r.terrain,
        alignments: r.roads.length ? r.roads.map((x) => x.alignment) : demo.alignments,
        activeAlignmentId: r.roads[0]?.alignment.id ?? demo.activeAlignmentId,
        context: r.context,
        cables: r.cables,
        reference: r.reference,
        riggingSets: r.riggingSets,
        notes: r.mapNotes,
        referenceStyles: r.referenceStyles,
        profiles: [],
        settings: { ...DEFAULT_ROAD_SETTINGS, ...(r.fillRate !== null ? { fillRate: r.fillRate } : {}) },
      })
      return { files, r, project }
    }
    /** The project written back as RoadEng, by the page's own call. */
    function write(project: RoadProject, roadsRead: boolean) {
      const grid = roadEngExportGrid(
        project.terrain,
        exportGrid(project.terrain, project.alignments[0].points[0].coordinate),
      )
      return roadEngProjectExport({
        name: project.name,
        roads: roadsRead ? project.alignments.map((alignment) => ({ alignment })) : [],
        grid,
        context: project.context,
        cables: project.cables,
        reference: project.reference ?? [],
        fillRate: project.settings.fillRate,
        riggingSets: project.riggingSets ?? [],
        notes: project.notes ?? [],
        referenceStyles: project.referenceStyles ?? [],
        terrainSource: project.terrain.roadEngSource ?? null,
        wholeTerrain: !roadsRead,
      })
    }
    /** Every part RoadEng keeps that this workspace does not model comes back unchanged. */
    function expectKept(original: Record<string, Uint8Array>, written: Record<string, Uint8Array>) {
      const text = (b: Uint8Array) => strFromU8(b, true)
      for (const [name, bytes] of Object.entries(original)) {
        const back = written[name]
        expect(back, name).toBeDefined()
        if (name.endsWith('.dsn')) keptDsn(text(bytes), text(back))
        else if (name.endsWith('.ds2')) expect(keptRecords(text(back))).toEqual(keptRecords(text(bytes)))
        else if (name.endsWith('.tlt')) expect(text(back)).toBe(text(bytes))
        else if (name.endsWith('.ter')) {
          const a = parseRoadEngTer(bytes),
            b = parseRoadEngTer(back)
          for (const part of ['codeTable', 'headerExtra', 'loggingSystems', 'attributeChunks', 'tail'] as const)
            expect(b.source?.[part], part).toBe(a.source?.[part])
          expect(b.features.filter((f) => f.dLine).map((f) => f.dLine!.chunks)).toEqual(
            a.features.filter((f) => f.dLine).map((f) => f.dLine!.chunks),
          )
        } else expect(back, name).toEqual(bytes)
      }
    }
    const rawParts = (files: { name: string; bytes: Uint8Array }[]) => {
      const out: Record<string, Uint8Array> = {}
      for (const f of files)
        if (/\.(dsnx|terx)$/i.test(f.name))
          for (const [part, data] of Object.entries(unzipSync(f.bytes)))
            out[`${/\.dsnx$/i.test(f.name) ? 'D' : 'T'}/${part}`] = data
      return out
    }

    it.each([
      [['LongRoad_1/LongRoad 1.dsnx', 'LongRoad_1/LongRoad 1.terx']],
      [
        [
          'Cul-de-sac-design/CulDeSacExample/CulDeSacExample.dsnx',
          'Cul-de-sac-design/CulDeSacExample/RangeRoadTopo.terx',
        ],
      ],
      [
        [
          'Cul-de-sac-design/CulDeSacExample/CulDeSacExampleComplete.dsnx',
          'Cul-de-sac-design/CulDeSacExample/RangeRoadTopo.terx',
        ],
      ],
      ...[
        'CableAnalysis.terx',
        'CableAnalysis - 1.terx',
        'CableAnalysis - 2.terx',
        'CableAnalysis - 3.terx',
        'CableAnalysis - 4.terx',
      ].map((f) => [[`Terrain_cables/${f}`, 'Terrain_cables/Training Single DLine MP.ilt']]),
    ])('writes %j back unedited with every kept part unchanged', (paths) => {
      if (!paths.every((p) => existsSync(join(samples!, p)))) return
      const { files, r, project } = open(paths)
      const out = write(project, r.roads.length > 0)
      expectKept(rawParts(files), projectParts(out.bytes))
      const ilt = files.find((f) => f.name.endsWith('.ilt'))
      if (ilt) expect(unzipSync(out.bytes)[ilt.name]).toEqual(ilt.bytes)
    })

    it('writes edits on LongRoad into the RoadEng fields they came from, and nothing else', () => {
      const { files, project } = open(['LongRoad_1/LongRoad 1.dsnx', 'LongRoad_1/LongRoad 1.terx'])
      const original = rawParts(files)
      const text = (b: Uint8Array) => strFromU8(b, true)
      const road = project.alignments[0]
      // Read: the ground types carry their slopes, which no template in use takes (none is on AUTO),
      // RoadEng's haul, pits and fill rate, and the optimizer's standards.
      expect(road.engineering!.materials.every((m) => m.cutSlope !== undefined && m.fillSlope !== undefined)).toBe(true)
      expect(road.template).toMatchObject({ cutSlopeFrom: 'template', fillSlopeFrom: 'template' })
      expect(road.engineering!.sites).toHaveLength(6)
      expect(road.engineering!.haul).toMatchObject({ freeHaulDistanceM: 150, overhaulDistanceM: 1000 })
      expect(project.settings.fillRate).toBe(4)
      expect(road.verticalStandards!.gradeRanges.length).toBeGreaterThan(0)
      const edited = (alignment: Alignment) => projectParts(write({ ...project, alignments: [alignment] }, true).bytes)
      const dsnOf = (parts: Record<string, Uint8Array>) => text(parts['D/Location1.dsn'])
      const typeLines = (parts: Record<string, Uint8Array>, type: string) =>
        text(parts['D/Location1.ds2'])
          .split(/\r?\n/)
          .filter((l) => l.startsWith(`${type},`))

      // A template width goes into RoadEng's template table and nowhere else.
      const wider = edited({ ...road, template: { ...road.template, leftWidth: road.template.leftWidth + 0.5 } })
      expect(changedSections(text(original['D/Location1.dsn']), dsnOf(wider))).toEqual(['TemplatesSct'])
      expect(typeLines(wider, '104')).toEqual(typeLines(original, '104'))

      // A haul rate goes into the ground types' 104 records and leaves the .dsn as it was.
      const engineering = road.engineering!
      const haul = edited({
        ...road,
        engineering: {
          ...engineering,
          haul: {
            ...engineering.haul,
            endHaulRate: engineering.haul.endHaulRate * 2,
            endHaulLoadingRate: engineering.haul.endHaulLoadingRate * 2,
          },
        },
      })
      expect(typeLines(haul, '104')).not.toEqual(typeLines(original, '104'))
      typeLines(haul, '104').forEach((line, k) => {
        const was = typeLines(original, '104')[k].split(',')
        const changed = line.split(',').flatMap((v, i) => (v === was[i] ? [] : [i]))
        expect(changed).toEqual([13, 14])
      })
      expect(changedSections(text(original['D/Location1.dsn']), dsnOf(haul))).toEqual([])

      // A grade limit goes into the active vertical option's constraints.
      const standards = road.verticalStandards!
      const steeper = edited({
        ...road,
        verticalStandards: {
          ...standards,
          gradeRanges: standards.gradeRanges.map((g, k) => (k === 0 ? { ...g, maxGradePercent: 9 } : g)),
        },
      })
      const changed = changedSections(text(original['D/Location1.dsn']), dsnOf(steeper))
      expect(changed).toHaveLength(1)
      expect(changed[0]).toMatch(/^OptAlignCost/)
      expect(typeLines(steeper, '104')).toEqual(typeLines(original, '104'))
      // Read back, each edit is the road's again.
      const back = roadEngProject(
        [
          {
            name: 'LongRoad 1.dsnx',
            bytes: unzipSync(
              write(
                {
                  ...project,
                  alignments: [{ ...road, template: { ...road.template, leftWidth: road.template.leftWidth + 0.5 } }],
                },
                true,
              ).bytes,
            )['LongRoad 1.dsnx'],
          },
        ],
        { ...options, verticalReference: 'CGVD2013' },
      )
      expect(back.roads[0].alignment.template.leftWidth).toBeCloseTo(road.template.leftWidth + 0.5, 6)
    })

    it('writes LongRoad’s curves back as read, and a curve’s own superelevation into its record alone', () => {
      const { files, project } = open(['LongRoad_1/LongRoad 1.dsnx', 'LongRoad_1/LongRoad 1.terx'])
      const original = rawParts(files)
      const text = (b: Uint8Array) => strFromU8(b, true)
      const road = project.alignments[0]
      expect(road.curveDesign).toMatchObject({
        superelevationMode: 'table',
        transitionFraction: 0.667,
        tangentRunout: true,
      })
      const curves = (parts: Record<string, Uint8Array>) =>
        text(parts['D/Location1.ds2'])
          .split(/\r?\n/)
          .filter((l) => l.startsWith('108,'))
          .map((l) => l.split(',').slice(3))
      // Radius, position and design values (speed, flags, e max, transitions, e, side friction, widening)
      // come back as read.
      const unedited = projectParts(write(project, true).bytes)
      expect(curves(unedited)).toEqual(curves(original))
      // PI 3 (R 340 m at 80 km/h) stated at 5 %: its e and side friction change, nothing else, and the
      // notes say RoadEng recalculates it unless its superelevation Auto box is unticked there.
      const editedOut = write(
        {
          ...project,
          alignments: [
            {
              ...road,
              points: road.points.map((p, k) =>
                k === 3 ? { ...p, curve: { ...p.curve, superelevationPercent: 5 } } : p,
              ),
            },
          ],
        },
        true,
      )
      const edited = projectParts(editedOut.bytes)
      expect(editedOut.notes.join(' ')).toMatch(
        /superelevation Auto off for curve H3\. Their superelevation is written as a value, which RoadEng recalculates unless the curve's superelevation Auto box is unticked there/,
      )
      const before = curves(original),
        after = curves(edited)
      after.forEach((fields, k) => {
        const changed = fields.flatMap((v, i) => (v === before[k][i] ? [] : [i + 3]))
        expect(changed).toEqual(k === 2 ? [15, 16] : [])
      })
      expect(after[2][15 - 3]).toBe('0.05')
      expect(changedSections(text(original['D/Location1.dsn']), text(edited['D/Location1.dsn']))).toEqual([])
    })

    it('writes a moved D-line with new spars and its logging system and analysis as read', () => {
      const path = 'Terrain_cables/CableAnalysis - 4.terx'
      if (!existsSync(join(samples!, path))) return
      const { files, project } = open([path])
      const cable = project.cables[0]
      // Read as the project's own: logging systems as rigging sets, the D-line rigged with its
      // system's set at RoadEng's spar heights, the map note a pin.
      expect(project.riggingSets!.map((set) => set.id)).toContain('roadeng-system-5')
      expect(cable).toMatchObject({ roadEngSystemId: '5', sagModel: 'mechanics', startHeight: 15.24, endHeight: 10 })
      expect(project.notes!.map((n) => [n.kind, n.text])).toEqual([['pin', 'Access Road']])
      const toGrid = exportGrid(project.terrain, cable.start)
      const [x, y] = toGrid.toGrid(cable.end)
      const moved = { ...cable, end: toGrid.toLonLat([x + 10, y]) }
      const out = write({ ...project, cables: [moved] }, false)
      const before = readRoadEngTerrainArchive(files[0].bytes).terrain.features.find((f) => f.dLine)!.dLine!
      const terx = Object.entries(unzipSync(out.bytes)).find(([name]) => name.endsWith('.terx'))![1]
      const after = readRoadEngTerrainArchive(terx).terrain.features.find((f) => f.dLine)!.dLine!
      const length = Math.hypot(
        ...([0, 1].map((i) => toGrid.toGrid(moved.end)[i] - toGrid.toGrid(moved.start)[i]) as [number, number]),
      )
      expect(after.spars.at(-1)!.station).toBeCloseTo(length, 6)
      expect(after.spars.map((s) => [s.kind, s.height])).toEqual(before.spars.map((s) => [s.kind, s.height]))
      expect(after.systemId).toBe(before.systemId)
      const chunk = (d: typeof before, type: number) => d.chunks!.find((c) => c.type === type)?.payload
      for (const type of [6, 69]) expect(chunk(after, type)).toBe(chunk(before, type))
      expect(chunk(after, 12)).not.toBe(chunk(before, 12))
    })
  },
)

// The RoadEng sample pack (Softree's tutorial designs and terrains, read in place and never
// committed): set ROADENG_SAMPLE_PACK to its samples folder.
const pack = process.env.ROADENG_SAMPLE_PACK
describe.skipIf(!pack || !existsSync(pack ?? ''))(
  'RoadEng sample pack written back unedited',
  { timeout: 120_000 },
  () => {
    const read = (p: string) => ({ name: p.split('/').pop()!, bytes: new Uint8Array(readFileSync(join(pack!, p))) })
    /** Opened as the page opens it, RoadEng's own Terrain1.ter kept beside the project. */
    async function openPack(paths: string[]) {
      const files = paths.map(read)
      const r = roadEngProject(files, { ...options, verticalReference: 'CGVD2013', importedAt: '2026-11-15T00:00:00Z' })
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
            alignments: r.roads.length ? r.roads.map((x) => x.alignment) : demo.alignments,
            activeAlignmentId: r.roads[0]?.alignment.id ?? demo.activeAlignmentId,
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
      return { files, r, project, ter: r.originalTer?.bytes ?? null }
    }
    function writePack(project: RoadProject, roadsRead: boolean, originalTer: Uint8Array | null) {
      const source = terrainFromMetadata(project.terrain)
      const grid = roadEngExportGrid(
        project.terrain,
        exportGrid(project.terrain, project.alignments[0].points[0].coordinate),
      )
      return roadEngProjectExport({
        name: project.name,
        roads: roadsRead ? project.alignments.map((alignment) => ({ alignment })) : [],
        grid,
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
        originalTer,
        wholeTerrain: !roadsRead,
      })
    }
    const LOCATION = 'tutorial-v10/RoadEngCivil/Location'
    const cases: string[][] = [
      ['widening-only/Widening only/Widening only.dsnx', 'widening-only/Widening only/Topo.terx'],
      ['guardrails/GuardRail.dsnx'],
      ...['4', '7', '8', '8a'].map((s) => [`${LOCATION}/Align stage ${s}.dsnx`, `${LOCATION}/Topo.terx`]),
      ...['bluff_road', 'bluff_road-2'].map((s) => [
        `tutorial-v10/RoadEngCivil/Location2/${s}.dsnx`,
        'tutorial-v10/RoadEngCivil/Location2/bluff_road.terx',
      ]),
      ...['Hart Rd', 'Hart Rd curves', 'Hart Rd optimal', 'Hart Rd optimal haul'].map((s) => [
        `tutorial-v10/SoftreeOptimal/${s}.dsnx`,
        'tutorial-v10/SoftreeOptimal/Hart Rd.terx',
      ]),
      ...['1', '2', '3'].map((s) => [
        `tutorial-v11/RoadEngResource/Location/Location 18_${s}.dsnx`,
        'tutorial-v11/RoadEngResource/Location/Terrain9_1.terx',
      ]),
      ['tutorial-v11/RoadEngResource/Location/image.terx'],
      ['tutorial-v11/RoadEngResource/Location/Terrain 13_1 - Ground type notes.terx'],
      ['tutorial-v10/RoadEngResource/Traverse/spur.terx'],
    ]
    it.each(cases)('writes %s back with every part as read', async (...paths: string[]) => {
      const { files, r, project, ter } = await openPack(paths)
      const out = writePack(project, r.roads.length > 0, ter)
      const written = projectParts(out.bytes)
      const text = (b: Uint8Array) => strFromU8(b, true)
      for (const f of files)
        if (/\.(dsnx|terx)$/i.test(f.name))
          for (const [part, bytes] of Object.entries(unzipSync(f.bytes))) {
            const name = `${/\.dsnx$/i.test(f.name) ? 'D' : 'T'}/${part}`
            const back = written[name]
            expect(back, name).toBeDefined()
            // The .dsn is RoadEng's, then [PGMaps]; the .ds2 keeps every record it does not rebuild.
            if (part.endsWith('.dsn')) keptDsn(text(bytes), text(back))
            else if (part.endsWith('.ds2')) {
              expect(keptRecords(text(back)), name).toEqual(keptRecords(text(bytes)))
              // PIs and VIPs too, every curve's e and side friction among them (Align stage 4's Use Minimum
              // Radius at 6 %, the bluff roads' side friction method); only the calculated stations (110) are rebuilt.
              const records = (from: Uint8Array, type: string) =>
                text(from)
                  .split(/\r?\n/)
                  .filter((l) => l.startsWith(`${type},`))
              for (const type of ['108', '109'])
                expect(records(back, type), `${name} ${type}`).toEqual(records(bytes, type))
            } else expect(Buffer.from(back).equals(Buffer.from(bytes)), name).toBe(true)
          }
    })
  },
)
