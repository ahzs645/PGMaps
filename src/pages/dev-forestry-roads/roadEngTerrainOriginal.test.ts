import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import proj4 from 'proj4'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { projectedCrsDefinition } from '@/lib/geo/projectedCrs'
import { parseProject } from './project'
import { encodeRoadEngDLineChunks, roadEngDLineFor } from './roadEngDLines'
import { crsMisfit, roadEngProject, withRoadEngOriginal } from './roadEngProject'
import { roadEngExportGrid, roadEngProjectExport } from './roadEngProjectExport'
import { parseRoadEngTer, ROADENG_FLAG_NOT_MODELLED, ROADENG_FLAG_POINT_SET } from './roadEngTerrain'
import { buildTer, chunk, type SynthFeature } from './roadEngTerrain.testkit'
import { roadEngTerLayout } from './roadEngTerrainExport'
import {
  parseRoadEngOriginalTer,
  roadEngCarryOverHtml,
  roadEngGridFingerprint,
  roadEngOriginalsToPrune,
  roadEngTerCandidates,
  ROADENG_ORIGINAL_PRUNE_GRACE_MS,
  sha256Hex,
} from './roadEngTerrainOriginal'
import { createDemoProject, DEFAULT_TEMPLATE, exportGrid, terrainFromMetadata } from './terrain'
import type { Coordinate, RoadProject } from './types'

// A 200 m square of DEM posts in a TIN in UTM zone 10, with what RoadEng draws on it: a stream with a
// long name and a point-level chunk, a D-line with cable settings, a breakline the TIN uses, a rock
// bluff with its own format chunk, a landing and a model contour. Section 3 holds a schema and a
// defaults entry, as RoadEng's files do.
const E0 = 515_000,
  N0 = 5_975_000
const utm10 = proj4('EPSG:4326', projectedCrsDefinition(26910)!)
const ground = (x: number) => 800 + 0.05 * x
const posts: [number, number, number][] = []
for (let j = 0; j <= 10; j++) for (let i = 0; i <= 10; i++) posts.push([E0 + i * 20, N0 + j * 20, ground(i * 20)])
const at = (i: number, j: number) => j * 11 + i
const triangles: [number, number, number][] = []
for (let j = 0; j < 10; j++)
  for (let i = 0; i < 10; i++)
    triangles.push([at(i, j), at(i, j + 1), at(i + 1, j)], [at(i + 1, j), at(i, j + 1), at(i + 1, j + 1)])
const line = (pts: [number, number][], z = 805): [number, number, number][] => pts.map(([x, y]) => [E0 + x, N0 + y, z])
const STREAM = 0,
  DLINE = 1,
  POSTS = 2,
  BREAK = 3,
  BLUFF = 4
const features: SynthFeature[] = [
  {
    name: 'Sml Stream',
    points: line([
      [30, 0],
      [40, 100],
      [50, 200],
    ]),
    flags: ROADENG_FLAG_NOT_MODELLED,
    colorRef: 0xff0000,
    subId: 7,
  },
  {
    name: 'D-Line',
    points: line([
      [120, 120],
      [180, 180],
    ]),
    flags: ROADENG_FLAG_NOT_MODELLED,
  },
  { name: 'DEM posts', points: posts, flags: ROADENG_FLAG_POINT_SET | 1, kind: 3 },
  {
    name: 'BREAK 1',
    points: line([
      [0, 100],
      [200, 100],
    ]),
  },
  {
    name: 'Rock Bluff',
    points: line([
      [150, 20],
      [170, 40],
      [190, 30],
    ]),
    flags: ROADENG_FLAG_NOT_MODELLED,
  },
  { name: 'Landing', points: line([[100, 190]]), flags: ROADENG_FLAG_NOT_MODELLED },
  {
    name: 'CNTR810',
    points: line(
      [
        [200, 0],
        [200, 200],
      ],
      810,
    ),
    flags: ROADENG_FLAG_NOT_MODELLED,
    kind: 2,
  },
]
const groupPayload = (index: number, name: string) => {
  const p = new Uint8Array(268)
  new DataView(p.buffer).setInt32(0, index, true)
  p.set(strToU8(name), 4)
  return p
}
const format = new Uint8Array(56)
new DataView(format.buffer).setInt32(0, 1, true)
new DataView(format.buffer).setInt32(4, -1, true)
new DataView(format.buffer).setInt32(8, -1, true)
new DataView(format.buffer).setFloat64(40, 1, true)
const defaultsFormat = new Uint8Array(400).map((_, k) => (k * 7) & 0xff)
const attributes = [
  ...chunk(100, -1, strToU8('7000|1|0|4|General|General|0|0|Comment|Comment|0|0|0\n\0')),
  ...chunk(52, -1, groupPayload(-1, '%$^**&@')),
  ...chunk(58, -1, defaultsFormat),
  ...chunk(52, -1, groupPayload(STREAM, 'Sml Stream - Willow Creek')),
  ...chunk(51, 1, new Uint8Array(32).fill(3)),
  ...chunk(52, -1, groupPayload(DLINE, 'D-Line')),
  ...encodeRoadEngDLineChunks(
    roadEngDLineFor({ lengthM: Math.hypot(60, 60), yarderHeight: 18, tailholdHeight: 8, deflectionPercent: 5 }),
  ),
  ...chunk(52, -1, groupPayload(BLUFF, 'Rock Bluff')),
  ...chunk(58, -1, format),
]
const tinVertices: [number, number][] = [...posts.map((_, k): [number, number] => [POSTS, k]), [BREAK, 0], [BREAK, 1]]
const ter = buildTer({ features, tin: { vertices: tinVertices, triangles }, attributes })
// RoadEng's header counts the attribute chunks; the test kit leaves it 0.
new DataView(ter.buffer).setUint32(38 + 12, roadEngTerLayout(ter).chunks.length, true)
const tlt = [
  '[main]',
  'CoordSys=1|51|10010',
  'units=10000',
  '[TerLayers]',
  'Layer0=CNTR*,Contours from model,',
  '',
].join('\r\n')
const te1 = strToU8('AC1014 symbols')
const terx = zipSync({ 'Terrain1.ter': ter, 'Terrain1.tlt': strToU8(tlt, true), 'Terrain1.te1': te1 })

let n = 0
const options = {
  newId: () => `id${n++}`,
  color: () => '#123456',
  template: { ...DEFAULT_TEMPLATE },
  verticalReference: 'CGVD2013',
}

/** A RoadEng terrain opened as the page opens one: hashed, recorded, saved and read back. */
async function open(bytes: Uint8Array, name = 'Valley.terx') {
  const read = roadEngProject([{ name, bytes }], options)
  const sha256 = await sha256Hex(read.originalTer!.bytes)
  const terrain = withRoadEngOriginal(read.terrain, { record: read.originalTer!.record, sha256 })
  const project = parseProject(
    JSON.parse(
      JSON.stringify({
        ...createDemoProject(),
        terrain,
        context: read.context,
        cables: read.cables,
        reference: read.reference,
        ...(read.riggingSets.length ? { riggingSets: read.riggingSets } : {}),
        ...(read.mapNotes.length ? { notes: read.mapNotes } : {}),
        ...(read.referenceStyles.length ? { referenceStyles: read.referenceStyles } : {}),
      }),
    ),
  )
  return { project, ter: read.originalTer!.bytes }
}

/** The project's terrain and layers written as a RoadEng project, and its Terrain1.ter. */
function write(project: RoadProject, originalTer: Uint8Array | null) {
  const source = terrainFromMetadata(project.terrain)!
  const grid = roadEngExportGrid(
    project.terrain,
    exportGrid(project.terrain, project.alignments[0].points[0].coordinate),
  )
  const written = roadEngProjectExport({
    name: 'Valley',
    roads: [],
    grid,
    context: project.context,
    cables: project.cables,
    reference: project.reference ?? [],
    elevationAt: (c) => source.elevationAt(c[0], c[1]),
    riggingSets: project.riggingSets ?? [],
    notes: project.notes ?? [],
    referenceStyles: project.referenceStyles ?? [],
    terrainSource: project.terrain.roadEngSource ?? null,
    terrain: project.terrain,
    originalTer,
    wholeTerrain: true,
  })
  const outer = unzipSync(written.bytes)
  const files = unzipSync(Object.entries(outer).find(([k]) => k.endsWith('.terx'))![1])
  return { ...written, ter: files['Terrain1.ter'], files }
}

const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i])
/** Each feature's record and points, and each feature's group chunks, from a layout. */
function parts(bytes: Uint8Array) {
  const layout = roadEngTerLayout(bytes)
  const { offsets, pointStart } = layout
  const records = Array.from({ length: layout.featureCount }, (_, i) => ({
    record: bytes.subarray(offsets[1] + i * 104, offsets[1] + (i + 1) * 104),
    points: bytes.subarray(offsets[2] + pointStart[i] * 40, offsets[2] + pointStart[i + 1] * 40),
  }))
  const groups = new Map<number, Uint8Array[]>()
  for (const c of layout.chunks) {
    const list = groups.get(c.owner) ?? []
    list.push(bytes.subarray(c.at, c.at + c.length))
    groups.set(c.owner, list)
  }
  const tin = [4, 5, 6, 7, 8].map((k) => bytes.subarray(offsets[k], offsets[k] + layout.sizes[k]))
  return { layout, records, groups, tin, tail: bytes.subarray(layout.end) }
}
const move = (c: Coordinate, dx: number, dy: number): Coordinate => {
  const [x, y] = utm10.forward([...c])
  return utm10.inverse([x + dx, y + dy]) as Coordinate
}

describe("RoadEng's own terrain file", () => {
  it('reads a terrain in feet in the feet its .tlt states, and writes it back as read', async () => {
    // No sample shows the unit of a D-line's cable settings in feet, so this terrain draws none.
    const feetTer = buildTer({
      features: features.map((f, k) => (k === DLINE ? { ...f, name: 'Old trail' } : f)),
      tin: { vertices: tinVertices, triangles },
      attributes: [
        ...chunk(100, -1, strToU8('7000|1|0|4|General|General|0|0|Comment|Comment|0|0|0\n\0')),
        ...chunk(52, -1, groupPayload(-1, '%$^**&@')),
        ...chunk(58, -1, defaultsFormat),
        ...chunk(52, -1, groupPayload(STREAM, 'Sml Stream - Willow Creek')),
        ...chunk(51, 1, new Uint8Array(32).fill(3)),
        ...chunk(52, -1, groupPayload(BLUFF, 'Rock Bluff')),
        ...chunk(58, -1, format),
      ],
    })
    new DataView(feetTer.buffer).setUint32(38 + 12, roadEngTerLayout(feetTer).chunks.length, true)
    const inFeet = zipSync({
      'Terrain1.ter': feetTer,
      'Terrain1.tlt': strToU8(tlt.replace('units=10000', 'units=3048'), true),
      'Terrain1.te1': te1,
    })
    const read = roadEngProject([{ name: 'Valley.terx', bytes: inFeet }], options)
    // Its posts are 20 feet apart, and its code (NAD83 / UTM zone 10N) is not read in feet.
    expect(read.localPlane?.unitM).toBe(0.3048)
    expect(read.notes).toContain('Its terrain states EPSG:26910, which this workspace does not read in feet.')
    const { project, ter: kept } = await open(inFeet)
    const out = write(project, kept)
    expect(out.carryOver.why).toBeNull()
    expect(out.carryOver.ground).toBe('roadeng')
    for (const name of ['Terrain1.ter', 'Terrain1.tlt', 'Terrain1.te1'])
      expect(equal(out.files[name], unzipSync(inFeet)[name]), name).toBe(true)
  })

  it('does not take a coordinate system that puts the terrain outside where it applies', () => {
    // RoadEng's default code, NAD83 / UTM zone 10N, on a terrain whose grid is a state plane's.
    expect(crsMisfit(26910, [[669_255, 100_844]])).toBe('0.91° N, 121.48° W')
    expect(crsMisfit(26910, [[E0, N0]])).toBeNull()
    expect(crsMisfit(32612, [[590_572, 5_703_440]])).toBeNull()
    expect(crsMisfit(3005, [[1_200_000, 1_000_000]])).toBeNull()
    const equator = zipSync({
      'Terrain1.ter': ter,
      'Terrain1.tlt': strToU8(tlt, true),
      'Terrain1.te1': te1,
    })
    expect(roadEngProject([{ name: 'Valley.terx', bytes: equator }], options).epsg).toBe(26910)
  })

  it('records the file and the objects made from it, and reads the reference back', async () => {
    const { project } = await open(terx)
    const original = project.terrain.roadEngSource!.original!
    expect(original).toMatchObject({ size: ter.length, unitM: 1, features: 7, triangles: triangles.length })
    expect(original.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(original.classes).toEqual({
      stream: 1,
      'd-line': 1,
      'mass-points': 1,
      breakline: 1,
      'rock-bluff': 1,
      landing: 1,
      contour: 1,
    })
    expect(Object.values(original.objects).map(([index, , inTin, cls]) => [index, inTin, cls])).toEqual([
      [STREAM, 0, 'stream'],
      [BREAK, 1, 'breakline'],
      [BLUFF, 0, 'rock-bluff'],
      [5, 0, 'landing'],
      [DLINE, 0, 'd-line'],
    ])
    expect(parseRoadEngOriginalTer(JSON.parse(JSON.stringify(original)))).toEqual(original)
  })

  it('writes an unedited terrain back byte for byte, with its .tlt and .te1', async () => {
    const { project, ter: kept } = await open(terx)
    const out = write(project, kept)
    expect(equal(out.ter, ter)).toBe(true)
    expect(strFromU8(out.files['Terrain1.tlt'], true)).toBe(tlt)
    expect(equal(out.files['Terrain1.te1'], te1)).toBe(true)
    expect(out.carryOver.ground).toBe('roadeng')
    expect(out.carryOver.why).toBeNull()
    expect(out.carryOver.unchanged.map((i) => [i.label, i.count])).toEqual(
      expect.arrayContaining([
        ["triangles of RoadEng's TIN", triangles.length],
        ['point set', 1],
        ['contour from the model', 1],
        ['D-line', 1],
        ['stream', 1],
      ]),
    )
    expect(out.carryOver.rewritten).toEqual([])
    expect(out.carryOver.leftOut).toEqual([])
    expect(out.notes.join(' ')).toMatch(
      /The ground is RoadEng's own terrain file: its TIN of 200 triangles and 7 of its features as read\./,
    )
  })

  it('rewrites only the record, points and box of an edited feature', async () => {
    const { project, ter: kept } = await open(terx)
    const stream = project.context.find((f) => f.id === `roadeng-0-${STREAM}`)!
    const coords = stream.geometry.coordinates as Coordinate[]
    const edited = {
      ...project,
      context: project.context.map((f) =>
        f === stream
          ? { ...f, geometry: { ...stream.geometry, coordinates: [coords[0], move(coords[1], 5, 0), coords[2]] } }
          : f,
      ),
    } as RoadProject
    const out = write(edited, kept)
    expect(out.carryOver.ground).toBe('roadeng')
    expect(out.carryOver.rewritten).toEqual([{ label: 'stream edited here', count: 1 }])
    const before = parts(ter),
      after = parts(out.ter)
    expect(after.layout.featureCount).toBe(7)
    for (let i = 0; i < 7; i++) {
      if (i === STREAM) continue
      expect(equal(after.records[i].record, before.records[i].record)).toBe(true)
      expect(equal(after.records[i].points, before.records[i].points)).toBe(true)
    }
    // The stream keeps its sub ID, colour and flags, and its points their padding; only places move.
    const r = new DataView(after.records[STREAM].record.slice().buffer)
    expect([r.getUint32(4, true), r.getUint32(12, true), r.getUint16(80, true)]).toEqual([7, 0xff0000, 0x40])
    const read = parseRoadEngTer(out.ter).features[STREAM]
    expect(read.points[3]).toBeCloseTo(E0 + 45, 3)
    expect(read.name).toBe('Sml Stream - Willow Creek')
    expect(after.records[STREAM].points[28]).toBe(0xcd)
    // Its group keeps its point-level chunk (the point count did not change); every other chunk is as read.
    for (const [owner, chunks] of before.groups)
      expect(after.groups.get(owner)!.map((c) => [...c])).toEqual(chunks.map((c) => [...c]))
    after.tin.forEach((section, k) => expect(equal(section, before.tin[k])).toBe(true))
    expect(equal(after.tail, before.tail)).toBe(true)
  })

  it("writes a D-line's new settings over its feature as read, and a new name into its group", async () => {
    const { project, ter: kept } = await open(terx)
    const out = write(
      {
        ...project,
        cables: project.cables.map((c) => ({ ...c, startHeight: 21 })),
        context: project.context.map((f) =>
          f.id === `roadeng-0-${STREAM}` ? { ...f, name: 'Sml Stream - Cedar Creek' } : f,
        ),
      },
      kept,
    )
    expect(out.carryOver.rewritten).toEqual(
      expect.arrayContaining([
        { label: 'D-line edited here', count: 1 },
        { label: 'stream edited here', count: 1 },
      ]),
    )
    const before = parts(ter),
      after = parts(out.ter)
    // The D-line's record and points stay as read; its settings chunks carry the new height.
    expect(equal(after.records[DLINE].record, before.records[DLINE].record)).toBe(true)
    expect(equal(after.records[DLINE].points, before.records[DLINE].points)).toBe(true)
    const read = parseRoadEngTer(out.ter)
    expect(read.features[DLINE].dLine!.spars.map((x) => [x.station, x.height])).toEqual([
      [0, 21],
      [parseRoadEngTer(ter).features[DLINE].dLine!.spars[1].station, 8],
    ])
    // The stream's new name goes into its record and group; its points stay as read.
    expect(read.features[STREAM].name).toBe('Sml Stream - Cedar Creek')
    expect(equal(after.records[STREAM].points, before.records[STREAM].points)).toBe(true)
    for (const i of [POSTS, BREAK, BLUFF, 5, 6])
      expect(equal(after.records[i].record, before.records[i].record)).toBe(true)
  })

  it('leaves out a removed feature and keeps the TIN on the points after it', async () => {
    const { project, ter: kept } = await open(terx)
    const out = write({ ...project, cables: [] }, kept)
    expect(out.carryOver.leftOut).toEqual([{ label: 'D-line', count: 1, why: 'removed from the project' }])
    const read = parseRoadEngTer(out.ter),
      was = parseRoadEngTer(ter)
    expect(read.features.map((f) => f.name)).toEqual(was.features.filter((_, i) => i !== DLINE).map((f) => f.name))
    expect(read.features.some((f) => f.dLine)).toBe(false)
    expect([...read.tin!.coords]).toEqual([...was.tin!.coords])
    expect([...read.tin!.triangles]).toEqual([...was.tin!.triangles])
    // Groups after the D-line name their features' new places.
    const after = parts(out.ter)
    expect([...after.groups.keys()].filter((k) => k >= 0)).toEqual([STREAM, BLUFF - 1])
    const header = new DataView(out.ter.buffer, out.ter.byteOffset + 38)
    expect(header.getUint32(12, true)).toBe(after.layout.chunks.length)
  })

  it('adds a new feature after the file’s own', async () => {
    const { project, ter: kept } = await open(terx)
    const extra = {
      id: 'new-stream',
      name: 'Cedar Creek',
      kind: 'stream' as const,
      geometry: {
        type: 'LineString' as const,
        coordinates: [utm10.inverse([E0 + 10, N0 + 10]), utm10.inverse([E0 + 20, N0 + 150])] as Coordinate[],
      },
    }
    const out = write({ ...project, context: [...project.context, extra] }, kept)
    expect(out.carryOver.rewritten).toEqual([{ label: 'stream added here', count: 1 }])
    const before = parts(ter),
      after = parts(out.ter)
    expect(after.layout.featureCount).toBe(8)
    for (let i = 0; i < 7; i++) expect(equal(after.records[i].record, before.records[i].record)).toBe(true)
    expect(parseRoadEngTer(out.ter).features[7].name).toBe('Sml Stream - Cedar Creek')
  })

  it('writes the grid, and says why, when the terrain changed or the file is missing', async () => {
    const { project, ter: kept } = await open(terx)
    const regridded: RoadProject = {
      ...project,
      terrain: {
        ...project.terrain,
        raster: {
          ...project.terrain.raster!,
          values: project.terrain.raster!.values.map((v) => (v === null ? v : v + 1)),
        },
      },
    }
    const changed = write(regridded, kept)
    expect(changed.carryOver.ground).toBe('grid')
    expect(changed.carryOver.why).toMatch(/no longer the grid read from RoadEng's terrain file/)
    expect(parseRoadEngTer(changed.ter).features.some((f) => f.name === 'DEM')).toBe(true)
    expect(changed.carryOver.leftOut).toEqual(
      expect.arrayContaining([
        { label: "triangles of RoadEng's TIN", count: 200, why: 'the grid is written instead' },
        { label: 'point set', count: 1, why: 'part of the ground the grid replaces' },
      ]),
    )

    const missing = write(project, null)
    expect(missing.carryOver.ground).toBe('grid')
    expect(missing.carryOver.why).toMatch(/not stored in this browser/)

    const wrong = write(project, ter.slice(0, ter.length - 24))
    expect(wrong.carryOver.why).toMatch(/not the one this terrain was read from/)

    const { original: _, ...older } = project.terrain.roadEngSource!
    void _
    const before = write({ ...project, terrain: { ...project.terrain, roadEngSource: older } }, kept)
    expect(before.carryOver.why).toMatch(/read before PG Maps kept/)
  })

  it('writes the grid when a feature the TIN is built on was edited', async () => {
    const { project, ter: kept } = await open(terx)
    const out = write(
      {
        ...project,
        reference: project.reference!.map((f) => (f.id === `roadeng-0-${BREAK}` ? { ...f, name: 'Ridge break' } : f)),
      },
      kept,
    )
    expect(out.carryOver.ground).toBe('grid')
    expect(out.carryOver.why).toMatch(/1 feature RoadEng's TIN is built on was edited or removed here/)
  })

  it('renders what goes back for the export preview', () => {
    const html = roadEngCarryOverHtml(
      {
        ground: 'grid',
        why: 'The file <is> missing.',
        unchanged: [{ label: 'symbol library (Terrain1.te1)' }],
        rewritten: [{ label: 'mass points from the terrain grid', count: 12_000 }],
        leftOut: [],
      },
      ['A note.'],
    )
    expect(html).toContain('What goes back to RoadEng')
    expect(html).toContain('The file &lt;is&gt; missing.')
    expect(html).toContain('<span class="n">12,000</span> mass points from the terrain grid')
    expect(html).toContain('Nothing is left out.')
  })

  it('finds the file in a .ter, a .terx or a zipped project, and prunes what nothing names', () => {
    expect(roadEngTerCandidates(ter)).toEqual([ter])
    expect(roadEngTerCandidates(terx).map((b) => b.length)).toEqual([ter.length])
    const zipped = zipSync({ 'Valley.terx': terx, 'Spur.dsnx': strToU8('x') })
    expect(roadEngTerCandidates(zipped).map((b) => b.length)).toEqual([ter.length])
    expect(roadEngTerCandidates(strToU8('not a terrain'))).toEqual([])
    const now = 10 * ROADENG_ORIGINAL_PRUNE_GRACE_MS
    expect(
      roadEngOriginalsToPrune(
        [
          { sha256: 'a', storedAt: 0 },
          { sha256: 'b', storedAt: 0 },
          { sha256: 'c', storedAt: now - 1000 },
        ],
        ['b'],
        now,
      ),
    ).toEqual(['a'])
  })

  it('fingerprints every level, null included, and refuses a malformed reference', () => {
    const grid = { origin: [0, 0], pixelSize: [1, -1], width: 2, height: 1, values: [1, null] }
    expect(roadEngGridFingerprint(grid)).toMatch(/^[a-f0-9]{16}$/)
    expect(roadEngGridFingerprint({ ...grid, values: [1, 0] })).not.toBe(roadEngGridFingerprint(grid))
    expect(roadEngGridFingerprint({ ...grid, origin: [0, 1e-9] })).not.toBe(roadEngGridFingerprint(grid))
    expect(() => parseRoadEngOriginalTer({ sha256: 'x' })).toThrow(/sha256/)
    const good = {
      sha256: 'a'.repeat(64),
      size: 10,
      grid: '0'.repeat(16),
      unitM: 1,
      features: 2,
      triangles: 0,
      classes: { stream: 1 },
      objects: { 'roadeng-0-1': [1, '1'.repeat(16), 0, 'stream'] },
    }
    expect(parseRoadEngOriginalTer(good)).toEqual(good)
    expect(() => parseRoadEngOriginalTer({ ...good, objects: { x: [5, '1'.repeat(16), 0, 'stream'] } })).toThrow(
      /object x/,
    )
    expect(() => parseRoadEngOriginalTer({ ...good, classes: { lake: 1 } })).toThrow(/class lake/)
  })
})

// Softree's published samples, read from a local copy and never committed (see roadEngImport.test.ts).
const samples = process.env.ROADENG_SAMPLES
const sample = (path: string) => new Uint8Array(readFileSync(join(samples!, path)))
describe.skipIf(!samples || !existsSync(samples ?? ''))(
  "Softree samples' own terrain files",
  { timeout: 120_000 },
  () => {
    const terrains = [
      'LongRoad_1/LongRoad 1.terx',
      ...['', ' - 1', ' - 2', ' - 3', ' - 4'].map((s) => `Terrain_cables/CableAnalysis${s}.terx`),
    ]
    for (const path of terrains)
      it(`writes ${path}'s Terrain1.ter back byte for byte after an unedited open`, async () => {
        const bytes = sample(path)
        const { project, ter: kept } = await open(bytes, path.split('/').pop())
        const out = write(project, kept)
        expect(out.carryOver.ground).toBe('roadeng')
        expect(equal(out.ter, unzipSync(bytes)['Terrain1.ter'])).toBe(true)
      })

    it('rewrites only the D-line moved in CableAnalysis - 4', async () => {
      const bytes = sample('Terrain_cables/CableAnalysis - 4.terx')
      const { project, ter: kept } = await open(bytes, 'CableAnalysis - 4.terx')
      const cable = project.cables[0]
      const index = Number(cable.id.split('-').pop())
      const out = write(
        { ...project, cables: [{ ...cable, start: move(cable.start, 3, 0), end: move(cable.end, 3, 0) }] },
        kept,
      )
      expect(out.carryOver.rewritten).toEqual([{ label: 'D-line edited here', count: 1 }])
      const before = parts(kept),
        after = parts(out.ter)
      let differing = 0
      for (let i = 0; i < before.layout.featureCount; i++)
        if (
          !equal(after.records[i].record, before.records[i].record) ||
          !equal(after.records[i].points, before.records[i].points)
        )
          differing++
      expect(differing).toBe(1)
      expect(equal(after.records[index].record, before.records[index].record)).toBe(false)
      after.tin.slice(0, 4).forEach((section, k) => expect(equal(section, before.tin[k])).toBe(true))
    })

    it("changes only the D-line's settings chunks when its yarder height changes in CableAnalysis - 4", async () => {
      const bytes = sample('Terrain_cables/CableAnalysis - 4.terx')
      const { project, ter: kept } = await open(bytes, 'CableAnalysis - 4.terx')
      const out = write({ ...project, cables: project.cables.map((c) => ({ ...c, startHeight: 21 })) }, kept)
      const before = parts(kept),
        after = parts(out.ter)
      // Every record and point as read; of the attribute chunks, only the D-line's settings and spars.
      expect(after.records.every((r, i) => equal(r.record, before.records[i].record))).toBe(true)
      expect(after.records.every((r, i) => equal(r.points, before.records[i].points))).toBe(true)
      after.tin.slice(0, 4).forEach((section, k) => expect(equal(section, before.tin[k])).toBe(true))
      const index = Number(project.cables[0].id.split('-').pop())
      for (const [owner, chunks] of before.groups) {
        if (owner === index) continue
        expect(after.groups.get(owner)!.every((c, k) => equal(c, chunks[k]))).toBe(true)
      }
      const changed = after.groups.get(index)!.filter((c, k) => !equal(c, before.groups.get(index)![k]))
      expect(changed.map((c) => new DataView(c.buffer, c.byteOffset).getUint32(8, true))).toEqual([63, 12])
      expect(parseRoadEngTer(out.ter).features[index].dLine!.spars[0].height).toBeCloseTo(21, 9)
    })
  },
)

// The RoadEng sample pack, read in place and never committed: set ROADENG_SAMPLE_PACK to its samples
// folder. Three of its terrains are in feet; two state a coordinate system their coordinates are not in.
const pack = process.env.ROADENG_SAMPLE_PACK
describe.skipIf(!pack || !existsSync(pack ?? ''))(
  "RoadEng sample pack's own terrain files",
  { timeout: 120_000 },
  () => {
    for (const path of [
      'widening-only/Widening only/Topo.terx',
      'tutorial-v10/RoadEngCivil/Location/Topo.terx',
      'tutorial-v10/RoadEngCivil/Location2/bluff_road.terx',
      'tutorial-v10/SoftreeOptimal/Hart Rd.terx',
      'tutorial-v10/RoadEngResource/Traverse/spur.terx',
      'tutorial-v11/RoadEngResource/Location/Terrain9_1.terx',
      'tutorial-v11/RoadEngResource/Location/image.terx',
      'tutorial-v11/RoadEngResource/Location/Terrain 13_1 - Ground type notes.terx',
    ])
      it(`writes ${path} back byte for byte after an unedited open`, async () => {
        const bytes = new Uint8Array(readFileSync(join(pack!, path)))
        const { project, ter: kept } = await open(bytes, path.split('/').pop())
        const out = write(project, kept)
        expect(out.carryOver.ground).toBe('roadeng')
        const parts = unzipSync(bytes)
        for (const name of Object.keys(parts)) expect(equal(out.files[name], parts[name]), name).toBe(true)
      })

    it('reads spur.terx in the feet its .tlt states, and keeps it in feet only while nothing drawn changes', async () => {
      const bytes = new Uint8Array(readFileSync(join(pack!, 'tutorial-v10/RoadEngResource/Traverse/spur.terx')))
      const { project, ter: kept } = await open(bytes, 'spur.terx')
      expect(project.terrain.roadEngSource!.original!.unitM).toBe(0.3048)
      expect(project.terrain.localPlane?.unitM).toBe(0.3048)
      // A stream drawn here is a feature to add, which this export writes only in metres.
      // On the flat plane, which is centred on 0°, 0°.
      const at: Coordinate = [0.0001, 0.0001]
      const stream = {
        id: 'drawn-stream',
        name: 'Spur Creek',
        kind: 'stream' as const,
        geometry: { type: 'LineString' as const, coordinates: [at, [at[0] + 1e-4, at[1] + 1e-4] as Coordinate] },
      }
      const out = write({ ...project, context: [...project.context, stream] }, kept)
      expect(out.carryOver.ground).toBe('grid')
      expect(out.carryOver.why).toMatch(/in feet/)
    })
  },
)
