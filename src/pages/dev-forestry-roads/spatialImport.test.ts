import JSZip from 'jszip'
import proj4 from 'proj4'
import { describe, expect, it } from 'vitest'
import { projectionDefinition } from '@/lib/geo/projectedCrs'
import { analyzeRoad, offsetCoordinate } from './engine'
import { sectionCodePoints } from './sectionGeometry'
import { featureSectionAnchor } from './sectionReferences'
import { createDemoProject, DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import { writeShapefileLayer, type ShapeLayer } from './shapefile'
import {
  applySpatialImport,
  buildSpatialImport,
  epsgFromPrj,
  proposeRoles,
  readSpatialImport,
  spatialFeatureName,
  spatialInventory,
  SpatialImportError,
  statedRole,
  type SpatialFile,
} from './spatialImport'
import type { Alignment, Coordinate } from './types'

/** The ESRI projection file of a NAD83(CSRS) / UTM zone 10N shapefile: no authority code in it. */
const CSRS_UTM10_PRJ =
  'PROJCS["NAD_1983_CSRS_UTM_Zone_10N",GEOGCS["GCS_North_American_1983_CSRS",DATUM["D_North_American_1983_CSRS",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-123.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]'

const file = (name: string, content: string | Uint8Array) =>
  new File([typeof content === 'string' ? content : (content.buffer as ArrayBuffer)], name)

/** A zipped shapefile whose coordinates are whatever the layer holds, with the given projection file. */
async function shapefileZip(layer: ShapeLayer, prj: string | null) {
  const zip = new JSZip()
  for (const [name, bytes] of Object.entries(writeShapefileLayer(layer).files))
    if (!name.endsWith('.prj')) zip.file(name, bytes)
    else if (prj !== null) zip.file(name, prj)
  return zip.generateAsync({ type: 'uint8array' })
}
const name = [{ name: 'NAME', type: 'C' as const, length: 20 }]
const line = (coordinates: Coordinate[], properties: Record<string, unknown> = {}): GeoJSON.Feature => ({
  type: 'Feature',
  properties,
  geometry: { type: 'LineString', coordinates },
})
const square = (properties: Record<string, unknown> = {}): GeoJSON.Feature => ({
  type: 'Feature',
  properties,
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [-122.82, 53.89],
        [-122.816, 53.89],
        [-122.816, 53.892],
        [-122.82, 53.892],
        [-122.82, 53.89],
      ],
    ],
  },
})
const spatial = (fileName: string, features: GeoJSON.Feature[]): SpatialFile => ({
  fileName,
  format: 'GeoJSON',
  crs: 'WGS84 longitude/latitude',
  collection: { type: 'FeatureCollection', features },
})
const road: Coordinate[] = [
  [-122.8158, 53.8989],
  [-122.8165, 53.895],
  [-122.8177, 53.8909],
]

describe('reading a spatial file', () => {
  it('reprojects a zipped shapefile with the workspace transformation for its CRS and keeps NAME', async () => {
    // Projected coordinates of a road, as a NAD83(CSRS) UTM 10N shapefile stores them.
    const utm: Coordinate[] = [
      [512100, 5972300],
      [512050, 5971800],
      [511980, 5971400],
    ]
    const bytes = await shapefileZip(
      {
        name: 'Prelim_Rd',
        type: 'polyline',
        fields: name,
        features: [{ parts: [utm], attributes: { NAME: 'Prelim Rd' } }],
      },
      CSRS_UTM10_PRJ,
    )
    const read = await readSpatialImport(file('Prelim_Rd.zip', bytes))
    expect(read.format).toBe('zipped shapefile')
    expect(read.crs).toBe('EPSG:3157 (NAD83(CSRS) / UTM zone 10N)')
    expect(read.collection.features).toHaveLength(1)
    expect(read.collection.features[0].properties?.name).toBe('Prelim Rd')
    // The terrain in EPSG:3157 goes through this same definition, so a vertex lands on its own ground.
    const expected = proj4(projectionDefinition(3157), 'EPSG:4326').forward(utm[0])
    const first = (read.collection.features[0].geometry as GeoJSON.LineString).coordinates[0]
    expect(first[0]).toBeCloseTo(expected[0], 9)
    expect(first[1]).toBeCloseTo(expected[1], 9)
    // A reader that ignores the datum shift puts the same vertex more than a metre away.
    const unshifted = proj4('+proj=utm +zone=10 +ellps=GRS80 +units=m +no_defs', 'EPSG:4326').forward(utm[0])
    expect(Math.hypot((first[0] - unshifted[0]) * 65_000, (first[1] - unshifted[1]) * 111_000)).toBeGreaterThan(1)
  })

  it('reads the EPSG code a projection file means, with or without an authority tag', () => {
    expect(epsgFromPrj(CSRS_UTM10_PRJ)).toBe(3157)
    expect(
      epsgFromPrj(
        'PROJCS["NAD_1983_UTM_Zone_9N",GEOGCS["GCS_North_American_1983",DATUM["D_North_American_1983",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-129.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]',
      ),
    ).toBe(26909)
    expect(
      epsgFromPrj(
        'PROJCS["NAD83 / BC Albers",GEOGCS["NAD83",DATUM["North_American_Datum_1983",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Albers_Conic_Equal_Area"],PARAMETER["latitude_of_center",45],PARAMETER["longitude_of_center",-126],PARAMETER["standard_parallel_1",50],PARAMETER["standard_parallel_2",58.5],PARAMETER["false_easting",1000000],PARAMETER["false_northing",0],UNIT["metre",1],AUTHORITY["EPSG","3005"]]',
      ),
    ).toBe(3005)
    expect(epsgFromPrj('not a projection')).toBeNull()
  })

  it('reads a KMZ by its content, keeping placemark names and points, and classifies nothing', async () => {
    const zip = new JSZip()
    zip.file(
      'doc.kml',
      '<kml><Document><Placemark><name>Block A</name><description>Planned cutblock</description><Polygon><outerBoundaryIs><LinearRing><coordinates>-122.82,53.89,0 -122.816,53.89,0 -122.816,53.892,0 -122.82,53.89,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark><Placemark><name>Landing 1</name><Point><coordinates>-122.8177,53.8909,0</coordinates></Point></Placemark></Document></kml>',
    )
    // Named .zip on purpose: the content decides, so the same file reads through any picker.
    const read = await readSpatialImport(file('Block.zip', await zip.generateAsync({ type: 'uint8array' })))
    expect(read.format).toBe('KMZ')
    expect(read.collection.features.map((f) => [f.geometry.type, f.properties?.name])).toEqual([
      ['Polygon', 'Block A'],
      ['Point', 'Landing 1'],
    ])
    expect(read.collection.features.every((f) => f.properties?.kind === undefined)).toBe(true)
    expect(read.collection.features.map(statedRole)).toEqual([null, null])
  })

  it('reprojects GeoJSON that names a CRS the workspace knows', async () => {
    const read = await readSpatialImport(
      file(
        'road.geojson',
        JSON.stringify({
          type: 'FeatureCollection',
          crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::3157' } },
          features: [
            line(
              [
                [512100, 5972300],
                [512050, 5971800],
              ] as Coordinate[],
              { Name: 'Spur 2' },
            ),
          ],
        }),
      ),
    )
    expect(read.crs).toMatch(/^EPSG:3157/)
    const [lon, lat] = (read.collection.features[0].geometry as GeoJSON.LineString).coordinates[0]
    expect(lon).toBeCloseTo(-122.8158, 3)
    expect(lat).toBeCloseTo(53.8989, 3)
    expect(read.collection.features[0].properties?.name).toBe('Spur 2')
  })

  it('drops heights unless a breakline import asks to keep them', async () => {
    const ditch = JSON.stringify(
      line([
        [-122.8158, 53.8989, 761.2],
        [-122.8165, 53.895, 758.4],
      ] as unknown as Coordinate[]),
    )
    const plain = await readSpatialImport(file('ditch.geojson', ditch))
    expect((plain.collection.features[0].geometry as GeoJSON.LineString).coordinates[0]).toEqual([-122.8158, 53.8989])
    const kept = await readSpatialImport(file('ditch.geojson', ditch), { keepHeights: true })
    expect((kept.collection.features[0].geometry as GeoJSON.LineString).coordinates).toEqual([
      [-122.8158, 53.8989, 761.2],
      [-122.8165, 53.895, 758.4],
    ])
  })

  it('keeps the heights of a feature that states its vertical datum, so a section anchor reads them', async () => {
    // A surveyed bench 6 m left of a road running north, as a project's GeoJSON export writes it,
    // beside a 3D line that states no datum.
    const origin: Coordinate = [-122.8, 53.9]
    const beside = (along: number, z: number) => [...offsetCoordinate(offsetCoordinate(origin, 0, along), 270, 6), z]
    const measured = [beside(-50, 798.5), beside(150, 800.5)] as unknown as Coordinate[]
    const exported = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        line(measured, { kind: 'stream', name: 'Survey bench', referenceVerticalDatum: 'CGVD2013' }),
        line(measured, { kind: 'stream', name: 'Height of unknown datum' }),
      ],
    })
    const read = await readSpatialImport(file('survey.geojson', exported))
    const [withDatum, without] = read.collection.features.map((f) => (f.geometry as GeoJSON.LineString).coordinates)
    expect(withDatum.map((p) => p[2])).toEqual([798.5, 800.5])
    expect(without.every((p) => p.length === 2)).toBe(true)

    const imported = buildSpatialImport(read, { point: null, line: null, polygon: null }, 'streams')
    const bench = imported.context.find((feature) => feature.name === 'Survey bench')!
    expect(bench.referenceVerticalDatum).toBe('CGVD2013')
    const anchor = featureSectionAnchor(bench, offsetCoordinate(origin, 0, 50), 0, 'left', { checks: 0 })!
    expect(anchor.offset).toBeCloseTo(-6, 3)
    expect(anchor.elevation).toBeCloseTo(799.5, 6)

    // A component anchored to it takes the measured level, not the ground at the intersection (800 m).
    const road: Alignment = {
      id: 'r',
      name: 'Road',
      color: '#16817a',
      points: [
        { id: 'a', coordinate: origin, radiusM: 0 },
        { id: 'b', coordinate: offsetCoordinate(origin, 0, 100), radiusM: 0 },
      ],
      vertical: [
        { id: 'a', chainage: 0, elevation: 798, curveLength: 0 },
        { id: 'b', chainage: 100, elevation: 798, curveLength: 0 },
      ],
      template: {
        ...DEFAULT_TEMPLATE,
        components: [
          {
            id: 'anchor',
            name: 'Anchored bench',
            side: 'left',
            kind: 'slope',
            condition: 'cut',
            widthM: 1,
            riseM: 0,
            referenceFeatureId: bench.id,
            code: 'survey-edge',
          },
        ],
      },
      overrides: [],
    }
    const analysis = analyzeRoad(road, { elevationAt: () => 800 }, DEFAULT_ROAD_SETTINGS, imported.context, {
      verticalReference: 'CGVD2013',
    })
    const station = analysis.stations.find((s) => s.chainage === 50)!
    expect(sectionCodePoints(station, road.template).find((p) => p.code === 'survey-edge')?.design).toBeCloseTo(
      799.5,
      5,
    )
  })

  it('names the file and the accepted formats instead of showing a parser error', async () => {
    const reads = (name: string, content: string | Uint8Array) => readSpatialImport(file(name, content))
    await expect(reads('notes.txt', 'station,offset\n0,1')).rejects.toThrow(
      'notes.txt is not a file this import can read. Use GeoJSON (.geojson or .json), a zipped shapefile (.zip), KML or KMZ.',
    )
    await expect(reads('broken.geojson', '{"type":"FeatureCollection",')).rejects.toThrow(
      /^broken\.geojson is not valid GeoJSON\. This import reads GeoJSON/,
    )
    await expect(reads('Prelim_Rd.shp', new Uint8Array([0, 0, 0x27, 0x0a, 0, 0, 0, 0]))).rejects.toThrow(
      /Prelim_Rd\.shp is one part of a shapefile\. Zip its \.shp, \.shx, \.dbf and \.prj/,
    )
    const empty = new JSZip()
    empty.file('readme.txt', 'nothing here')
    await expect(reads('data.zip', await empty.generateAsync({ type: 'uint8array' }))).rejects.toThrow(
      /^data\.zip holds no shapefile \(\.shp\) or KML\./,
    )
    await expect(reads('job.road.json', JSON.stringify(createDemoProject()))).rejects.toThrow(
      /job\.road\.json is a road project file/,
    )
    for (const attempt of [reads('notes.txt', 'x'), reads('broken.geojson', '{')])
      await expect(attempt).rejects.toBeInstanceOf(SpatialImportError)
    // None of them leaks the JSON parser's own wording.
    await expect(reads('a.kmz', '{"oops"')).rejects.not.toThrow(/Unexpected token|JSON\.parse|position \d+/)
  })

  it('refuses projected coordinates it has no CRS for, saying what is missing', async () => {
    const utm: Coordinate[] = [
      [512100, 5972300],
      [512050, 5971800],
    ]
    const bytes = await shapefileZip(
      { name: 'Road', type: 'polyline', fields: name, features: [{ parts: [utm], attributes: { NAME: 'Road' } }] },
      null,
    )
    await expect(readSpatialImport(file('Road.zip', bytes))).rejects.toThrow(
      /^Road\.zip has no \.prj file, so its coordinate system is unknown\. Add the layer's \.prj/,
    )
    await expect(readSpatialImport(file('road.geojson', JSON.stringify(line(utm))))).rejects.toThrow(
      /road\.geojson holds coordinates that are not longitude\/latitude and names no CRS/,
    )
  })

  it('takes the name from NAME, Name or name, and from nothing else by accident', () => {
    expect(spatialFeatureName({ NAME: 'STREAM_1K-0' })).toBe('STREAM_1K-0')
    expect(spatialFeatureName({ Name: ' Landing 2 ' })).toBe('Landing 2')
    expect(spatialFeatureName({ NAME: 'upper', name: 'exact' })).toBe('exact')
    expect(spatialFeatureName({ GNIS_NAME: 'Tabor Creek' })).toBe('Tabor Creek')
    expect(spatialFeatureName({ STATUS: 'preliminary', NAME: '' })).toBeNull()
    // A layer with one text column and no name column is labelled by that column.
    expect(spatialFeatureName({ LOT: 'Lot A' })).toBe('Lot A')
    expect(spatialFeatureName({ LOT: 'Lot A', OWNER: 'Crown' })).toBeNull()
    expect(spatialFeatureName(null)).toBeNull()
  })
})

describe('what an imported feature becomes', () => {
  it('asks rather than turning a road line or a cutblock into a stream or an exclusion', () => {
    const prelim = spatial('Prelim_Rd.zip', [line(road, { name: 'Prelim Rd', STATUS: 'preliminary' })])
    expect(proposeRoles(prelim, 'streams')).toEqual({
      roles: { point: null, line: 'road', polygon: null },
      ask: true,
    })
    const block = spatial('Block.kmz', [square({ name: 'Block A', description: 'Planned cutblock' })])
    const proposal = proposeRoles(block, 'streams')
    expect(proposal.ask).toBe(true)
    expect(proposal.roles.polygon).toBe('planned-block')
    // A polygon nothing describes has no suggestion at all, and cannot be imported until one is chosen.
    const anonymous = spatial('shapes.geojson', [square()])
    expect(proposeRoles(anonymous, 'streams')).toEqual({ roles: { point: null, line: null, polygon: null }, ask: true })
    expect(() => buildSpatialImport(anonymous, { point: null, line: null, polygon: null })).toThrow(
      'Choose what the polygons in shapes.geojson are before importing.',
    )
  })

  it('imports stream data through the streams picker without asking, with its names', () => {
    const streams = spatial('Streams.zip', [
      line(road, { name: 'STREAM_1K-0' }),
      line([road[1], [-122.81, 53.8955]], { name: 'STREAM_5K-0' }),
      line([road[2], [-122.81, 53.8915]], { name: 'NO-GO-0' }),
    ])
    const proposal = proposeRoles(streams, 'streams')
    expect(proposal).toEqual({ roles: { point: null, line: 'stream', polygon: null }, ask: false })
    const built = buildSpatialImport(streams, proposal.roles)
    expect(built.context.map((f) => [f.kind, f.name])).toEqual([
      ['stream', 'STREAM_1K-0'],
      ['stream', 'STREAM_5K-0'],
      ['stream', 'NO-GO-0'],
    ])
    expect(built.notice).toBe(
      'Imported 3 streams (STREAM_1K-0, STREAM_5K-0, NO-GO-0) from Streams.zip, read as WGS84 longitude/latitude.',
    )
  })

  it('settles the shape a single-purpose picker is for, and asks about anything else in the file', () => {
    const mixed = spatial('job.geojson', [line(road, { name: 'Spur' }), square({ name: 'Lot A' })])
    expect(proposeRoles(spatial('line.geojson', [line(road)]), 'road')).toEqual({
      roles: { point: null, line: 'road', polygon: null },
      ask: false,
    })
    expect(proposeRoles(mixed, 'road')).toEqual({ roles: { point: null, line: 'road', polygon: null }, ask: true })
    expect(proposeRoles(mixed, 'reference')).toEqual({
      roles: { point: null, line: 'reference', polygon: 'reference' },
      ask: false,
    })
    // Planned or harvested is not in a plain polygon, so the cutblock picker asks too.
    expect(proposeRoles(spatial('Block.kmz', [square({ name: 'Block A' })]), 'cutblocks')).toEqual({
      roles: { point: null, line: null, polygon: 'planned-block' },
      ask: true,
    })
  })

  it('makes a planned cutblock, never an excluded constraint, when that is what was chosen', () => {
    const block = spatial('Block.kmz', [square({ name: 'Block A' })])
    const built = buildSpatialImport(block, { point: null, line: null, polygon: 'planned-block' })
    expect(built.context).toHaveLength(1)
    expect(built.context[0]).toMatchObject({
      kind: 'harvest',
      name: 'Block A',
      harvestEvidence: { source: 'user', status: 'proposed' },
    })
    expect(built.context.some((f) => f.kind === 'avoid')).toBe(false)
    expect(built.notice).toContain('1 planned cutblock (Block A)')
    const avoided = buildSpatialImport(block, { point: null, line: null, polygon: 'constraint' })
    expect(avoided.context[0]).toMatchObject({ kind: 'avoid', name: 'Block A' })
    expect(avoided.notice).toContain('1 avoidance area (Block A)')
  })

  it('imports points as named points and reference linework as features nothing reads', () => {
    const landings = spatial('Landings.zip', [
      { type: 'Feature', properties: { name: 'Landing 1' }, geometry: { type: 'Point', coordinates: road[2] } },
      { type: 'Feature', properties: {}, geometry: { type: 'MultiPoint', coordinates: [road[0], road[1]] } },
      square({ name: 'Lot A' }),
    ])
    const proposal = proposeRoles(landings, 'reference')
    expect(proposal.ask).toBe(false)
    const built = buildSpatialImport(landings, proposal.roles)
    expect(built.context).toEqual([])
    expect(built.alignments).toEqual([])
    expect(built.reference.map((f) => [f.geometry.type, f.name, f.source])).toEqual([
      ['Point', 'Landing 1', 'Landings.zip'],
      ['Point', 'Landings 2 (part 1)', 'Landings.zip'],
      ['Point', 'Landings 2 (part 2)', 'Landings.zip'],
      ['Polygon', 'Lot A', 'Landings.zip'],
    ])
    expect(built.notice).toContain(
      '3 named points (Landing 1, Landings 2 (part 1), Landings 2 (part 2)); 1 reference area (Lot A)',
    )
  })

  it('makes a road from a line, usable in a project', () => {
    const built = buildSpatialImport(spatial('Prelim_Rd.zip', [line(road, { name: 'Prelim Rd' })]), {
      point: null,
      line: 'road',
      polygon: null,
    })
    expect(built.alignments).toHaveLength(1)
    expect(built.alignments[0].name).toBe('Prelim Rd')
    expect(built.alignments[0].points.map((p) => p.coordinate)).toEqual(road)
    let n = 0
    const project = applySpatialImport(createDemoProject(), built, () => `id-${++n}`)
    expect(project.alignments.at(-1)?.name).toBe('Prelim Rd')
    expect(project.activeAlignmentId).toBe(project.alignments.at(-1)?.id)
  })

  it('keeps what a PGMaps export says a feature is, and each picker takes only the kinds it is for', () => {
    const exported = spatial('project.geojson', [
      line(road, { kind: 'alignment', name: 'Road 1' }),
      line(road, { kind: 'stream', name: 'Tabor Creek', riparianClass: 'S3' }),
      square({ kind: 'avoid', name: 'Wetland' }),
      square({
        kind: 'harvest',
        name: 'CP 12',
        harvestEvidence: { source: 'user', status: 'proposed', yearMethod: 'unknown' },
      }),
      {
        type: 'Feature',
        properties: { kind: 'crossing-review', name: 'x' },
        geometry: { type: 'Point', coordinates: road[1] },
      },
    ])
    const none = { point: null, line: null, polygon: null }
    // Nothing is asked: the file says what everything is.
    expect(proposeRoles(exported, 'streams')).toEqual({ roles: none, ask: false })
    // The general import takes every kind of context, with its evidence, and leaves the road to a road picker.
    const context = buildSpatialImport(exported, none, 'streams')
    expect(context.alignments).toEqual([])
    expect(context.context.map((f) => [f.kind, f.name])).toEqual([
      ['stream', 'Tabor Creek'],
      ['avoid', 'Wetland'],
      ['harvest', 'CP 12'],
    ])
    expect(context.context[0].streamAssessment?.importedClass).toBe('S3')
    expect(context.context[2].harvestEvidence?.status).toBe('proposed')
    expect(context.leftOut).toBe(2)
    // The road picker adds the road and not a second copy of the project's streams and areas.
    const roads = buildSpatialImport(exported, none, 'road')
    expect(roads.alignments.map((a) => a.name)).toEqual(['Road 1'])
    expect(roads.context).toEqual([])
    expect(roads.notice).toBe(
      'Imported 1 road (Road 1) from project.geojson, read as WGS84 longitude/latitude. 4 features were left out.',
    )
    expect(buildSpatialImport(exported, none, 'cutblocks').context.map((f) => f.name)).toEqual(['CP 12'])
    expect(spatialInventory(exported, 'road').stated.map((g) => [g.role, g.kept])).toEqual([
      ['road', true],
      ['stream', false],
      ['constraint', false],
      ['planned-block', false],
      ['skip', false],
    ])
    // A picker given only kinds it does not take says where they go instead.
    expect(() =>
      buildSpatialImport(spatial('streams.geojson', [exported.collection.features[1]]), none, 'road'),
    ).toThrow(
      'streams.geojson has nothing this import takes. Bring roads in with Import line on the Design tab, and streams, areas and cutblocks with Streams → Import on the Terrain tab.',
    )
  })

  it('adds an import to the project, replacing a cutblock imported twice and keeping everything else', () => {
    const block = spatial('Block.kmz', [square({ name: 'Block A' })])
    const landings = spatial('Landings.zip', [
      { type: 'Feature', properties: { name: 'Landing 1' }, geometry: { type: 'Point', coordinates: road[2] } },
    ])
    let n = 0
    const id = () => `new-${++n}`
    const base = createDemoProject()
    const planned = buildSpatialImport(block, { point: null, line: null, polygon: 'planned-block' })
    const once = applySpatialImport(base, planned, id, 2026)
    const twice = applySpatialImport(once, planned, id, 2026)
    expect(twice.context.filter((f) => f.kind === 'harvest' && f.name === 'Block A')).toHaveLength(1)
    expect(twice.harvestHistoryYear).toBe(base.harvestHistoryYear ?? 2026)
    const withPoints = applySpatialImport(
      twice,
      buildSpatialImport(landings, { point: 'reference', line: null, polygon: null }),
      id,
    )
    expect(withPoints.reference?.map((f) => f.name)).toEqual(['Landing 1'])
    expect(withPoints.context).toEqual(twice.context)
    expect(withPoints.alignments).toEqual(twice.alignments)
  })
})
