import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import proj4 from 'proj4'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { projectedCrsDefinition } from '@/lib/geo/projectedCrs'
import { alignmentLength, analyzeRoad, distance } from './engine'
import { AlignmentCrsQuestion, type XY } from './landXmlImport'
import { isLocalPlane, LOCAL_PLANE_EPSG, placeProject } from './localPlane'
import { parseProject } from './project'
import { roadEngDesign } from './roadEngExport'
import { collectRoadEngFiles, mergeRoadEngParts, roadEngProject } from './roadEngProject'
import { EXAMPLE_RIGGING } from './cableMechanics'
import { ROADENG_FLAG_NOT_MODELLED, ROADENG_FLAG_POINT_SET } from './roadEngTerrain'
import { buildTer, chunk, type SynthFeature } from './roadEngTerrain.testkit'
import { encodeRoadEngDLineChunks, roadEngDLineFor } from './roadEngDLines'
import {
  createDemoProject,
  DEFAULT_ROAD_SETTINGS,
  DEFAULT_TEMPLATE,
  rasterSource,
  terrainFromMetadata,
} from './terrain'
import { terrainCoverShare, terrainGridCellM, terrainResolutionText } from './tinGround'
import { planTerrainCellM } from './terrainDisplay'
import type { Alignment, Coordinate, RoadProject } from './types'

// A 400 m square of ground in UTM zone 10 rising 5 % to the east, drawn as RoadEng holds it: mass
// points in a TIN, with a stream, a D-line, a felling boundary, a landing and a model contour on it.
const E0 = 515_000,
  N0 = 5_975_000
const utm10 = proj4('EPSG:4326', projectedCrsDefinition(26910)!)
const lonLat = (x: number, y: number) => utm10.inverse([E0 + x, N0 + y]) as Coordinate
const ground = (x: number) => 800 + 0.05 * x
const posts: [number, number, number][] = []
for (let j = 0; j <= 20; j++) for (let i = 0; i <= 20; i++) posts.push([E0 + i * 20, N0 + j * 20, ground(i * 20)])
const index = (i: number, j: number) => j * 21 + i
const triangles: [number, number, number][] = []
for (let j = 0; j < 20; j++)
  for (let i = 0; i < 20; i++) {
    // Clockwise, as RoadEng stores them.
    triangles.push(
      [index(i, j), index(i, j + 1), index(i + 1, j)],
      [index(i + 1, j), index(i, j + 1), index(i + 1, j + 1)],
    )
  }
const line = (pts: [number, number][], z = 805): [number, number, number][] => pts.map(([x, y]) => [E0 + x, N0 + y, z])
const features: SynthFeature[] = [
  { name: 'DEM posts', points: posts, flags: ROADENG_FLAG_POINT_SET | 1, kind: 3 },
  {
    name: 'Sml Stream',
    points: line([
      [50, 0],
      [60, 200],
      [80, 400],
    ]),
    flags: ROADENG_FLAG_NOT_MODELLED,
  },
  {
    name: 'D-Line',
    points: line([
      [300, 300],
      [380, 380],
    ]),
    flags: ROADENG_FLAG_NOT_MODELLED,
  },
  {
    name: 'Falling BDY',
    points: line([
      [250, 50],
      [350, 50],
      [350, 150],
      [250, 150],
      [250, 50],
    ]),
    flags: ROADENG_FLAG_NOT_MODELLED,
  },
  { name: 'Landing', points: line([[200, 380]]), flags: ROADENG_FLAG_NOT_MODELLED },
  {
    name: 'CNTR810',
    points: line(
      [
        [200, 0],
        [200, 400],
      ],
      810,
    ),
    flags: ROADENG_FLAG_NOT_MODELLED,
    kind: 2,
  },
]
/** The D-line's attribute group (type 52) and its RoadEng cable settings: yarder 18 m, tailhold 8 m, 5 %. */
const dLineIndex = features.findIndex((f) => f.name === 'D-Line')
const group = new Uint8Array(268)
new DataView(group.buffer).setInt32(0, dLineIndex, true)
group.set(strToU8('D-Line'), 4)
const cableChunks = [
  ...chunk(52, -1, group),
  ...encodeRoadEngDLineChunks(
    roadEngDLineFor({ lengthM: Math.hypot(80, 80), yarderHeight: 18, tailholdHeight: 8, deflectionPercent: 5 }),
  ),
]
const ter = buildTer({ features, tin: { vertices: posts.map((_, k) => [0, k]), triangles }, attributes: cableChunks })
const terx = (coordSys: string) =>
  zipSync({
    'Terrain1.ter': ter,
    'Terrain1.te1': strToU8('AC1014'),
    'Terrain1.tlt': strToU8(
      ['[main]', `CoordSys=${coordSys}`, '[TerLayers]', 'Layer0=CNTR*,Contours from model,'].join('\r\n'),
    ),
  })
const road: Alignment = {
  id: 'r',
  name: 'Spur 7',
  color: '#000000',
  points: [
    { id: 'a', coordinate: lonLat(20, 40), radiusM: 0 },
    { id: 'b', coordinate: lonLat(200, 200), radiusM: 60 },
    { id: 'c', coordinate: lonLat(380, 220), radiusM: 0 },
  ],
  vertical: [],
  template: { ...DEFAULT_TEMPLATE },
  overrides: [],
}
const profiled: Alignment = {
  ...road,
  vertical: [
    { id: 'v0', chainage: 0, elevation: ground(20), curveLength: 0 },
    { id: 'v1', chainage: alignmentLength(road), elevation: ground(380), curveLength: 0 },
  ],
}
const design = roadEngDesign([{ alignment: profiled }], (c) => utm10.forward([...c]) as XY, {
  terrainName: 'Valley.terx',
}).bytes
let n = 0
const options = {
  newId: () => `id${n++}`,
  color: () => '#123456',
  template: { ...DEFAULT_TEMPLATE },
  verticalReference: 'CGVD2013',
}
const files = (coordSys: string) => [
  { name: 'Spur 7.dsnx', bytes: design },
  { name: 'Valley.terx', bytes: terx(coordSys) },
]
/** The pieces as a project, the way the page opens one. */
const asProject = (p: ReturnType<typeof roadEngProject>): RoadProject =>
  parseProject({
    ...createDemoProject(),
    name: p.name,
    terrain: p.terrain,
    alignments: p.roads.map((r) => r.alignment),
    activeAlignmentId: p.roads[0].alignment.id,
    context: p.context,
    cables: p.cables,
    reference: p.reference,
    profiles: [],
  })

describe('RoadEng project import', () => {
  const stated = roadEngProject(files('1|51|10010'), options)

  it('places the design in the CRS its terrain states, on the terrain TIN', () => {
    expect(stated.epsg).toBe(26910)
    expect(stated.localPlane).toBeNull()
    const [back] = stated.roads
    back.alignment.points.forEach((p, k) =>
      expect(distance(p.coordinate, road.points[k].coordinate)).toBeLessThan(0.001),
    )
    const project = asProject(stated)
    const source = terrainFromMetadata(project.terrain)!
    // Ground under (200, 200) on a 5 % slope.
    expect(source.elevationAt(...lonLat(200, 200))).toBeCloseTo(ground(200), 1)
    const analysis = analyzeRoad(back.alignment, source, DEFAULT_ROAD_SETTINGS)
    expect(analysis.completeLength).toBeGreaterThan(0.99 * analysis.length)
    expect(stated.notes.join(' ')).toMatch(
      /Its ground is RoadEng's TIN, 800 triangles: sections, the profile, quantities, drainage and the plan read its facets \(median edge 20\.0 m\), and a \d+\.\d\d m grid over its box is kept to write it back\./,
    )
    // The TIN is kept as the ground analysis reads, in the grid's metres.
    expect(project.terrain.preparation).toMatchObject({
      operation: 'roadeng-tin',
      sources: [{ name: 'Valley.terx', epsg: 26910, verticalReference: 'CGVD2013' }],
      parameters: { vertices: 441, triangles: 800, medianEdgeM: 20, areaM2: 160_000 },
    })
    expect(project.terrain.preparation!.tin!.coordinates.slice(0, 4)).toEqual([E0, N0, E0 + 20, N0])
    expect(stated.notes).toContain(
      "The terrain's coordinate system is NAD83 / UTM zone 10N (EPSG 26910), from RoadEng code 1|51|10010.",
    )
  })

  it('brings what was drawn in as the objects that hold it', () => {
    expect(stated.context.map((f) => [f.kind, f.name])).toEqual([
      ['stream', 'Sml Stream'],
      ['harvest', 'Falling BDY'],
    ])
    expect(stated.context[1]).toMatchObject({ harvestEvidence: { source: 'user', status: 'proposed' } })
    expect(stated.cables).toEqual([
      expect.objectContaining({ name: 'D-Line', startHeight: 18, endHeight: 8, deflectionPercent: 5 }),
    ])
    expect(distance(stated.cables[0].start, lonLat(300, 300))).toBeLessThan(0.001)
    expect(stated.reference.map((f) => [f.name, f.geometry.type])).toEqual([['Landing', 'Point']])
    // The DEM posts and the model contour are the terrain itself.
    expect(stated.notes).toContain(
      '2 contours, point sets and boundaries make up its terrain and are not drawn as layers.',
    )
  })

  it('reads the TIN at its facets where the grid made from it flattens them', () => {
    // A 3 × 3 TIN on 60 m posts with a 10 m peak in the middle: the grid's cells are wider than
    // the facets' short sides, so reading the grid bilinearly cuts the peak down.
    const peak: [number, number, number][] = []
    for (let j = 0; j <= 2; j++)
      for (let i = 0; i <= 2; i++) peak.push([E0 + i * 60, N0 + j * 60, i === 1 && j === 1 ? 810 : 800])
    const at = (i: number, j: number) => j * 3 + i
    const faces: [number, number, number][] = []
    for (let j = 0; j < 2; j++)
      for (let i = 0; i < 2; i++)
        faces.push([at(i, j), at(i, j + 1), at(i + 1, j)], [at(i + 1, j), at(i, j + 1), at(i + 1, j + 1)])
    const peaked = zipSync({
      'Terrain1.ter': buildTer({
        features: [{ name: 'Posts', points: peak, flags: ROADENG_FLAG_POINT_SET | 1, kind: 3 }],
        tin: { vertices: peak.map((_, k) => [0, k]), triangles: faces },
      }),
      'Terrain1.tlt': strToU8(['[main]', 'CoordSys=1|51|10010'].join('\r\n')),
    })
    const opened = roadEngProject([{ name: 'Peak.terx', bytes: peaked }], options)
    const project = asProject({ ...opened, roads: [{ alignment: road } as never] })
    const source = terrainFromMetadata(project.terrain)!
    // 15 m east and 10 m north of the peak, on the facet falling to (120, 60) and (60, 120).
    const facet = 810 - (10 * (15 + 10)) / 60
    expect(source.elevationAt(...lonLat(75, 70))).toBeCloseTo(facet, 6)
    expect(source.elevationAt(...lonLat(60, 60))).toBeCloseTo(810, 6)
    const grid = rasterSource(project.terrain.raster!)
    expect(Math.abs(grid.elevationAt(...lonLat(60, 60)) - 810)).toBeGreaterThan(1)
    // Off the TIN there is no ground, from either.
    expect(source.elevationAt(...lonLat(-5, 60))).toBeNaN()
  })

  it('lays a project whose terrain names no CRS on a flat plane, and places it there exactly later', () => {
    const plane = roadEngProject(files('1|-1|-1'), options)
    expect(plane.epsg).toBe(LOCAL_PLANE_EPSG)
    expect(plane.localPlane).toEqual({ offsetM: [E0 + 200, N0 + 200], unitM: 1, source: 'Valley.terx' })
    expect(plane.notes.join(' ')).toMatch(/It is on a flat plane/)
    const project = asProject(plane)
    expect(isLocalPlane(project.terrain)).toBe(true)
    // Lengths on the plane are the file's own.
    const onPlane = project.alignments[0]
    const fileLength = parseFloat(
      strFromU8(unzipSync(design)['Location1.ds2'], true)
        .trim()
        .split('\r\n')
        .filter((l) => l.startsWith('110,5'))
        .pop()!
        .split(',')[5],
    )
    expect(alignmentLength(onPlane)).toBeCloseTo(fileLength, 2)

    const placed = placeProject(project, { kind: 'crs', epsg: 26910 })
    expect(placed.epsg).toBe(26910)
    const direct = asProject(stated)
    placed.project.alignments[0].points.forEach((p, k) =>
      expect(distance(p.coordinate, direct.alignments[0].points[k].coordinate)).toBeLessThan(0.001),
    )
    expect(placed.project.alignments[0].points[1].radiusM).toBeCloseTo(direct.alignments[0].points[1].radiusM, 3)
    // The terrain grid is relabelled, cell for cell, onto the file's coordinates.
    expect(placed.project.terrain.raster!.origin).toEqual(direct.terrain.raster!.origin)
    expect(placed.project.terrain.raster!.values).toEqual(direct.terrain.raster!.values)
    expect(placed.project.terrain.localPlane).toBeUndefined()
    // RoadEng's TIN moves with it, vertex for vertex, and is still the ground read.
    expect(placed.project.terrain.preparation).toEqual(direct.terrain.preparation)
    expect(terrainFromMetadata(placed.project.terrain)!.elevationAt(...lonLat(213, 187))).toBeCloseTo(ground(213), 6)
    expect(distance(placed.project.cables[0].start, direct.cables[0].start)).toBeLessThan(0.001)
    expect(() => parseProject(placed.project)).not.toThrow()
  })

  it('places a plane project by control points, with the fit and the terrain resampled', () => {
    const project = asProject(roadEngProject(files('1|-1|-1'), options))
    const start = project.alignments[0].points[0].coordinate,
      end = project.alignments[0].points[2].coordinate
    const placed = placeProject(project, {
      kind: 'control',
      pairs: [
        { from: start, to: road.points[0].coordinate },
        { from: end, to: road.points[2].coordinate },
      ],
    })
    expect(placed.similarity!.scale).toBeCloseTo(1, 5)
    expect(placed.similarity!.rotationDeg).toBeCloseTo(0, 3)
    expect(placed.similarity!.rmsM).toBeLessThan(0.001)
    expect(placed.epsg).toBe(32610)
    placed.project.alignments[0].points.forEach((p, k) =>
      expect(distance(p.coordinate, road.points[k].coordinate)).toBeLessThan(0.01),
    )
    const source = terrainFromMetadata(placed.project.terrain)!
    expect(source.elevationAt(...lonLat(200, 200))).toBeCloseTo(ground(200), 1)
    // The TIN went through the fit with the grid; its levels are as read.
    const tin = placed.project.terrain.preparation!.tin!
    expect(tin.elevations).toEqual(project.terrain.preparation!.tin!.elevations)
    expect(Math.abs(tin.coordinates[0] - E0)).toBeLessThan(0.01)
    expect(placed.project.terrain.preparation!.sources[0].epsg).toBe(32610)
    expect(() => parseProject(placed.project)).not.toThrow()
    expect(placed.notes.join(' ')).toMatch(/Fitted 2 control points: scale 1\.0000\d, rotation -?0\.000°/)
  })

  it('asks for a CRS when it may not lay the files on a plane, and joins an open plane', () => {
    expect(() => roadEngProject(files('1|-1|-1'), { ...options, noCrs: 'ask' })).toThrow(AlignmentCrsQuestion)
    const answered = roadEngProject(files('1|-1|-1'), { ...options, noCrs: 'ask', epsg: 26910 })
    expect(answered.epsg).toBe(26910)
    const open = roadEngProject(files('1|-1|-1'), options).localPlane!
    const joined = roadEngProject([{ name: 'Spur 7.dsnx', bytes: design }], { ...options, noCrs: open })
    expect(joined.localPlane).toBe(open)
  })

  it('reads a zipped project as its parts, and refuses what is not RoadEng', () => {
    const zipped = zipSync({ 'job/Spur 7.dsnx': design, 'job/Valley.terx': terx('1|51|10010') })
    const collected = collectRoadEngFiles([{ name: 'job.zip', bytes: zipped }])
    expect(collected.designs.map((f) => f.name)).toEqual(['Spur 7.dsnx'])
    expect(collected.terrains.map((f) => f.name)).toEqual(['Valley.terx'])
    expect(roadEngProject([{ name: 'job.zip', bytes: zipped }], options).epsg).toBe(26910)
    expect(() => collectRoadEngFiles([{ name: 'notes.txt', bytes: strToU8('hello') }])).toThrow(/not a RoadEng design/)
    expect(() => collectRoadEngFiles([{ name: 'empty.zip', bytes: zipSync({ 'a.txt': strToU8('x') }) }])).toThrow(
      /holds no RoadEng design/,
    )
  })

  it('keeps a window layout chosen with the terrain, found by its content', () => {
    const layout = strToU8('[3dwindow]\r\nsize=1,2\r\n[dlinedefl]\r\nscale=5.3\r\n')
    const collected = collectRoadEngFiles([...files('1|51|10010'), { name: 'Cable layout.ilt', bytes: layout }])
    expect(collected.layouts.map((f) => f.name)).toEqual(['Cable layout.ilt'])
    const opened = roadEngProject([...files('1|51|10010'), { name: 'Cable layout.ilt', bytes: layout }], options)
    expect(opened.terrain.roadEngSource?.layouts).toEqual([{ name: 'Cable layout', text: strFromU8(layout, true) }])
    // The road keeps its design's parts and the frame it was read in.
    expect(opened.roads[0].alignment.roadEngSource).toMatchObject({ part: 'Location1', epsg: 26910, startStation: 0 })
    expect(stated.cables[0].roadEng?.spars.map((sp) => sp.height)).toEqual([18, 8])
  })

  it('joins a terrain’s sets, notes and looks to a project, replacing an earlier import of them', () => {
    const set = (id: string, name: string) => ({ id, name, rigging: { ...EXAMPLE_RIGGING } })
    const note = (id: string, text: string) => ({
      id,
      kind: 'pin' as const,
      points: [[0, 0] as Coordinate],
      text,
      color: '#0f172a',
      createdAt: '2026-11-14T00:00:00Z',
    })
    const merged = mergeRoadEngParts(
      {
        riggingSets: [set('roadeng-system-1', 'Highlead'), set('mine', 'Grapple')],
        notes: [note('roadeng-note-1', 'old'), note('n', 'mine')],
        referenceStyles: [{ layer: 'RoadEng terrain/Feature', color: '#000000' }],
      },
      {
        riggingSets: [set('roadeng-system-1', 'Highlead'), set('roadeng-system-4', 'Grapple')],
        mapNotes: [note('roadeng-note-1', 'Access Road')],
        referenceStyles: [{ layer: 'RoadEng terrain/Feature', color: '#ff7f00' }],
      },
    )
    expect(merged.riggingSets!.map((s) => [s.id, s.name])).toEqual([
      ['mine', 'Grapple'],
      ['roadeng-system-1', 'Highlead'],
      ['roadeng-system-4', 'Grapple (2)'],
    ])
    expect(merged.notes!.map((n) => n.text)).toEqual(['mine', 'Access Road'])
    expect(merged.referenceStyles).toEqual([{ layer: 'RoadEng terrain/Feature', color: '#ff7f00' }])
  })

  it('refuses a placement it cannot make', () => {
    const project = asProject(roadEngProject(files('1|-1|-1'), options))
    expect(() => placeProject({ ...project, drainage: {} as never }, { kind: 'crs', epsg: 26910 })).toThrow(
      /Remove drainage runs first/,
    )
    expect(() =>
      placeProject(
        { ...project, terrain: { ...project.terrain, localPlane: { ...project.terrain.localPlane!, unitM: 0.3048 } } },
        { kind: 'crs', epsg: 26910 },
      ),
    ).toThrow(/in feet/)
    expect(() => placeProject(asProject(stated), { kind: 'crs', epsg: 26910 })).toThrow(/already on the map/)
  })
})

// Softree's published samples, read from a local copy and never committed (see roadEngImport.test.ts).
const samples = process.env.ROADENG_SAMPLES
const sample = (path: string) => ({
  name: path.split('/').pop()!,
  bytes: new Uint8Array(readFileSync(join(samples!, path))),
})
// A 16 MB terrain and a 27.8 km road: slow beside a full run of the suite.
describe.skipIf(!samples || !existsSync(samples ?? ''))('Softree sample projects', { timeout: 60_000 }, () => {
  const longRoad = () => [sample('LongRoad_1/LongRoad 1.dsnx'), sample('LongRoad_1/LongRoad 1.terx')]

  it('opens LongRoad in its terrain WKT CRS, on its TIN, with RoadEng section', () => {
    const p = roadEngProject(longRoad(), options)
    expect(p.epsg).toBe(26915)
    const project = asProject(p)
    const analysis = analyzeRoad(project.alignments[0], terrainFromMetadata(project.terrain)!, DEFAULT_ROAD_SETTINGS)
    // The courses' 4:1 side slopes put the subgrade 2 m past the 4.2 m lane, so a few more sections
    // reach past the TIN's edge.
    expect(analysis.completeLength / analysis.length).toBeGreaterThan(0.98)
    expect(p.notes.join(' ')).toMatch(/takes RoadEng's section; its profile is lowered 0\.50 m/)
  })

  it("reads LongRoad's ground from RoadEng's TIN, not the coarse grid its box forces", () => {
    const project = asProject(roadEngProject(longRoad(), options))
    const { preparation, raster } = project.terrain
    expect(preparation).toMatchObject({
      operation: 'roadeng-tin',
      parameters: { vertices: 100_372, triangles: 198_340 },
    })
    // One grid over the TIN's 10.6 × 17.2 km box: 7.66 m cells where half the median edge is about 3.9 m.
    expect(Math.abs(raster!.pixelSize[0])).toBeCloseTo(7.66, 2)
    expect(Number(preparation!.parameters.medianEdgeM) / 2).toBeCloseTo(3.9, 0)
    // So nothing is sized from that box: the TIN covers 3 % of it, Review states its 7.85 m point
    // spacing, drainage routes on 3.9 m cells and the plan draws about 17 m pixels, not 91 m.
    expect(terrainCoverShare(project.terrain)).toBeCloseTo(0.03, 2)
    expect(terrainResolutionText(project.terrain)).toBe('TIN, 7.85 m median point spacing')
    expect(terrainGridCellM(project.terrain)).toBeCloseTo(3.92, 2)
    expect(planTerrainCellM(project.terrain)).toBeCloseTo(17.2, 0)
    const source = terrainFromMetadata(project.terrain)!
    const toLonLat = (x: number, y: number) =>
      proj4('EPSG:4326', projectedCrsDefinition(26915)!).inverse([x, y]) as Coordinate
    const tin = preparation!.tin!
    // Each triangulated vertex reads its own level (547 of RoadEng's points are in no triangle).
    for (let k = 0; k < tin.triangles.length; k += 29_989) {
      const i = tin.triangles[k]
      expect(source.elevationAt(...toLonLat(tin.coordinates[i * 2], tin.coordinates[i * 2 + 1]))).toBeCloseTo(
        tin.elevations[i],
        3,
      )
    }
    const road = project.alignments[0]
    const onTin = analyzeRoad(road, source, DEFAULT_ROAD_SETTINGS)
    const onGrid = analyzeRoad(road, rasterSource(raster!), DEFAULT_ROAD_SETTINGS)
    expect(onTin.completeLength / onTin.length).toBeGreaterThan(0.98)
    // The grid flattens short facets; the TIN keeps them, a percent or two more earthwork.
    expect(onTin.cutVolumeM3 / onGrid.cutVolumeM3).toBeGreaterThan(1.005)
    expect(onTin.cutVolumeM3 / onGrid.cutVolumeM3).toBeLessThan(1.05)
    expect(onTin.fillVolumeM3 / onGrid.fillVolumeM3).toBeGreaterThan(1.005)
    expect(onTin.fillVolumeM3 / onGrid.fillVolumeM3).toBeLessThan(1.05)
  })

  it('keeps the cable terrain’s fine TIN as its ground too', () => {
    const p = roadEngProject([sample('Terrain_cables/CableAnalysis.terx')], options)
    expect(p.terrain.preparation).toMatchObject({
      operation: 'roadeng-tin',
      parameters: { vertices: 157_016, triangles: 313_861 },
    })
    expect(Number(p.terrain.preparation!.parameters.medianEdgeM)).toBeLessThan(1.5)
  })

  it('places LongRoad, opened without its CRS, exactly where its CRS puts it', () => {
    const [designFile, terrainFile] = longRoad()
    const parts = unzipSync(terrainFile.bytes)
    parts['Terrain1.tlt'] = strToU8(
      strFromU8(parts['Terrain1.tlt'], true).replace(/^CoordSys=.*$/m, 'CoordSys=1|-1|-1'),
      true,
    )
    const plane = asProject(roadEngProject([designFile, { name: terrainFile.name, bytes: zipSync(parts) }], options))
    expect(isLocalPlane(plane.terrain)).toBe(true)
    const direct = asProject(roadEngProject(longRoad(), options))
    const placed = placeProject(plane, { kind: 'crs', epsg: 26915 }).project
    placed.alignments[0].points.forEach((p, k) =>
      expect(distance(p.coordinate, direct.alignments[0].points[k].coordinate)).toBeLessThan(0.005),
    )
    expect(placed.terrain.raster!.origin).toEqual(direct.terrain.raster!.origin)
    // The TIN moves by the plane's offset to the millimetre it is kept to.
    const a = placed.terrain.preparation!.tin!.coordinates,
      b = direct.terrain.preparation!.tin!.coordinates
    for (let i = 0; i < a.length; i += 10_007) expect(Math.abs(a[i] - b[i])).toBeLessThan(0.0011)
  })

  it('reads the cul-de-sac shoulder lines as its own alignment, not as new roads', () => {
    const p = roadEngProject(
      [
        sample('Cul-de-sac-design/CulDeSacExample/CulDeSacExampleComplete.dsnx'),
        sample('Cul-de-sac-design/CulDeSacExample/RangeRoadTopo.terx'),
        sample('Cul-de-sac-design/CulDeSacExample/R_L_Shoulders.terx'),
      ],
      options,
    )
    expect(p.epsg).toBe(26910)
    expect(p.context).toEqual([])
    expect(p.notes).toContain('2 road lines are an imported alignment and left out.')
  })

  it('opens a design whose terrain is missing on a flat plane, in its own units', () => {
    const p = roadEngProject([sample('RoadEng-LandXML-Civil-3D/Align stage 1.dsnx')], options)
    expect(p.epsg).toBe(LOCAL_PLANE_EPSG)
    expect(p.localPlane!.unitM).toBe(0.3048)
    expect(() => asProject(p)).not.toThrow()
  })
})
