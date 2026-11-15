import JSZip from 'jszip'
import proj4 from 'proj4'
import { describe, expect, it } from 'vitest'
import { projectionDefinition } from '@/lib/geo/projectedCrs'
import { roadDxf } from './dxfExport'
import { analyzeRoad, centrelineSamples, horizontalGeometry, offsetCoordinate } from './engine'
import { localPlaneProjection } from './localPlane'
import { sectionCodePoints } from './sectionGeometry'
import { featureSectionAnchor } from './sectionReferences'
import { createDemoProject, DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE, localMetricGrid } from './terrain'
import { writeShapefileLayer, type ShapeLayer } from './shapefile'
import {
  applyLayerImport,
  readReferenceImport,
  removeImportedLayer,
  suggestedLayerRole,
  designRoadForProposedLine,
  loadImportedProposedRoads,
  defaultHiddenReferenceLayers,
} from './referenceImport'
import { cutblockBufferFeatures, layerFitPoints } from './cutblockBuffers'
import { cutblockBufferSymbol } from './cutblockBufferStyle'
import { parseProject, serializeProject } from './project'
import { importedCutblockFeatures, referenceFolders, referenceLayers } from './referenceFeatures'
import {
  applySpatialImport,
  buildSpatialImport,
  epsgFromPrj,
  proposeRoles,
  readSpatialImport,
  spatialFeatureName,
  spatialInventory,
  SpatialCrsQuestion,
  SpatialImportError,
  statedRole,
  type SpatialFile,
} from './spatialImport'
import type { Alignment, Coordinate, TerrainSource } from './types'

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

describe('folder import roles and road profiles', () => {
  it('suggests numbered roads and one canonical block while leaving boundary copies as reference', () => {
    expect(spatialFeatureName({ FEATURE_NA: 'ABC123.1000', STATUS: 'Planned' })).toBe('ABC123.1000')
    expect(suggestedLayerRole(spatial('Study/ABC123.1000_Rd.shp', [line(road, { name: 'ABC123.1000' })]))).toBe(
      'proposed-road',
    )
    expect(suggestedLayerRole(spatial('Study/ABC123.shp', [square()]))).toBe('planned-block')
    expect(suggestedLayerRole(spatial('Study/ABC123_Bdy_2026_08_29.shp', [square()]))).toBe('reference')
  })

  it('loads several named roads alongside one block, hides their reference copies, and avoids identical duplicates', () => {
    let id = 0
    const uid = () => `folder-${++id}`
    const source = createDemoProject()
    const imported = applyLayerImport(
      source,
      [
        { file: spatial('Study/ABC123.shp', [square({ name: 'ABC123' })]), role: 'planned-block' },
        {
          file: spatial('Study/roads.shp', [
            line(road, { name: 'ABC123.1000' }),
            line(road.slice(0, 2), { name: 'ABC123.2000' }),
          ]),
          role: 'proposed-road',
        },
        { file: spatial('Study/reference.geojson', [square({ name: 'Visual context' })]), role: 'reference' },
      ],
      uid,
    )
    const loaded = loadImportedProposedRoads(imported.project, imported.imported, uid)
    expect(loaded.alignments.slice(-2).map((a) => a.name)).toEqual(['ABC123.1000', 'ABC123.2000'])
    expect(loaded.alignments.slice(-2).every((a) => a.vertical.length === 0)).toBe(true)
    expect(loaded.context.filter((f) => f.layerSource === 'Study/ABC123.shp')).toHaveLength(1)
    expect(defaultHiddenReferenceLayers(loaded)).toEqual(['Study/roads.shp', 'Study/reference.geojson'])
    expect(loadImportedProposedRoads(loaded, imported.imported, uid).alignments).toHaveLength(loaded.alignments.length)
    // The Layers tree reads which design road a proposed line became, and whether it has moved since.
    const proposed = loaded.reference!.find((f) => f.name === 'ABC123.1000')!
    const made = loaded.alignments.find((a) => a.name === 'ABC123.1000')!
    expect(designRoadForProposedLine(proposed, loaded.alignments)).toEqual({ road: made, edited: false })
    const renamed = loaded.alignments.map((a) => (a === made ? { ...a, name: 'Mainline' } : a))
    expect(designRoadForProposedLine(proposed, renamed)).toMatchObject({ road: { name: 'Mainline' }, edited: false })
    const moved = loaded.alignments.map((a) =>
      a === made
        ? {
            ...a,
            points: a.points.map((p, i) => (i ? p : { ...p, coordinate: [p.coordinate[0] + 0.001, p.coordinate[1]] })),
          }
        : a,
    ) as typeof loaded.alignments
    expect(designRoadForProposedLine(proposed, moved)).toMatchObject({ road: { name: 'ABC123.1000' }, edited: true })
    expect(designRoadForProposedLine(proposed, imported.project.alignments)).toBeNull()
    expect(
      parseProject(JSON.parse(serializeProject(loaded)))
        .alignments.slice(-2)
        .map((a) => a.name),
    ).toEqual(['ABC123.1000', 'ABC123.2000'])
  })
})

describe('reading reference layers', () => {
  it('pairs loose shapefile parts by directory and stem and keeps GIS names', async () => {
    const picked = (directory: string, roadId: string) =>
      Object.entries(
        writeShapefileLayer({
          name: 'Roads',
          type: 'polyline',
          fields: [{ name: 'ROAD_ID', type: 'C', length: 20 }],
          features: [{ parts: [road], attributes: { ROAD_ID: roadId } }],
        }).files,
      ).map(([name, bytes]) => ({
        file: file(name, bytes),
        path: `Study/${directory}/${name.endsWith('.dbf') ? name.toUpperCase() : name}`,
      }))
    const result = await readReferenceImport([...picked('a', 'First road'), ...picked('b', 'Second road')])
    expect(result.map(({ fileName, collection }) => [fileName, collection.features[0].properties?.name])).toEqual([
      ['Study/a/Roads.shp', 'First road'],
      ['Study/b/Roads.shp', 'Second road'],
    ])
  })

  it('keeps each shapefile inside a ZIP as a layer and treats design-tagged GeoJSON as reference', async () => {
    const zip = new JSZip()
    for (const layer of ['One', 'Two']) {
      const written = writeShapefileLayer({
        name: layer,
        type: 'polyline',
        fields: name,
        features: [{ parts: [road], attributes: { NAME: layer } }],
      })
      for (const [part, bytes] of Object.entries(written.files)) zip.file(part, bytes)
    }
    const layers = await readReferenceImport([
      { file: file('Survey.zip', await zip.generateAsync({ type: 'uint8array' })), path: 'Survey.zip' },
      { file: file('Design.geojson', JSON.stringify(line(road, { kind: 'alignment' }))), path: 'Design.geojson' },
    ])
    const result = applyLayerImport(
      createDemoProject(),
      layers.map((file) => ({ file, role: 'reference' })),
      () => crypto.randomUUID(),
    )
    expect(result.project.reference?.map(({ source, geometry }) => [source, geometry.type])).toEqual([
      ['Design.geojson', 'LineString'],
      ['Survey.zip/One.shp', 'LineString'],
      ['Survey.zip/Two.shp', 'LineString'],
    ])
  })

  it('keeps proposed roads in their folder and puts only chosen polygons in planned cutblocks', () => {
    const choices = [
      { file: spatial('Study/Roads.geojson', [line(road, { name: 'Spur' })]), role: 'proposed-road' },
      { file: spatial('Study/Plans/Blocks.geojson', [square({ name: 'Block A' })]), role: 'planned-block' },
      { file: spatial('Study/Plans/Buffer.geojson', [square({ name: 'Buffer' })]), role: 'reference' },
    ] as const
    const base = createDemoProject()
    const result = applyLayerImport(base, choices, () => crypto.randomUUID()).project
    expect(result.alignments).toEqual(base.alignments)
    expect(result.reference?.map(({ role, name }) => [role, name])).toEqual([
      ['proposed-road', 'Spur'],
      [undefined, 'Buffer'],
    ])
    const blocks = importedCutblockFeatures(result.context)
    expect(blocks.map(({ name, source }) => [name, source])).toEqual([['Block A', 'Study/Plans/Blocks.geojson']])
    expect(result.context.find(({ id }) => id === blocks[0].id)?.harvestEvidence?.status).toBe('proposed')
    const tree = referenceFolders(referenceLayers([...(result.reference ?? []), ...blocks]))
    expect(
      tree.folders
        .get('Study')
        ?.folders.get('Plans')
        ?.layers.map(({ name }) => name),
    ).toEqual(['Buffer', 'Blocks'])
    const again = applyLayerImport(result, choices, () => crypto.randomUUID()).project
    expect(importedCutblockFeatures(again.context)[0].id).toBe(blocks[0].id)
    expect(again.reference).toHaveLength(2)
  })

  it('stores an imported buffer with its cutblocks and releases it when the parent layer is deleted', () => {
    const layer = 'Study/Blocks.geojson'
    const source = 'Study/Buffer.geojson'
    const setting = { layer, source, color: '#15803d', pattern: 'crosshatch' as const }
    const base = createDemoProject()
    const project = applyLayerImport(
      base,
      [
        { file: spatial(layer, [square()]), role: 'planned-block', buffer: setting },
        { file: spatial(source, [square()]), role: 'reference' },
      ],
      () => crypto.randomUUID(),
    ).project
    expect(parseProject(serializeProject(project)).cutblockBuffers).toEqual([setting])
    expect(cutblockBufferSymbol(setting)).toMatchObject({
      fill: '#15803d',
      hatches: [{ angleDeg: 45, stroke: { color: '#15803d' } }, { angleDeg: 135 }],
    })
    expect(
      cutblockBufferFeatures(setting, project.context, project.reference ?? []).map(({ geometry }) => geometry),
    ).toEqual([square().geometry])
    const deleted = removeImportedLayer(project, layer)
    expect(deleted.context).toEqual(base.context)
    expect(deleted.alignments).toEqual(base.alignments)
    expect(deleted.cutblockBuffers).toBeUndefined()
    expect(deleted.reference?.map(({ source }) => source)).toEqual([source])
    expect(removeImportedLayer(project, source).cutblockBuffers).toBeUndefined()
  })

  it('generates a display buffer without changing cutblock geometry', () => {
    const layer = 'Blocks.geojson'
    const setting = { layer, metres: 400 }
    const project = applyLayerImport(
      createDemoProject(),
      [{ file: spatial(layer, [square()]), role: 'planned-block', buffer: setting }],
      () => crypto.randomUUID(),
    ).project
    const block = project.context.find(({ layerSource }) => layerSource === layer)!
    expect(block.geometry).toEqual(square().geometry)
    const bounds = layerFitPoints(cutblockBufferFeatures(setting, project.context, []))
    expect(bounds[0][0]).toBeLessThan(-122.82)
    expect(bounds[1][1]).toBeGreaterThan(53.892)
  })
})

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
      'notes.txt is not a file this import can read. Use GeoJSON (.geojson or .json), a zipped shapefile (.zip), KML, KMZ or DXF (.dxf).',
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

/** An R12-style DXF built from group-code pairs, with an optional `$INSUNITS`. */
function dxfText(entities: Array<[number, string | number]>, insUnits?: number) {
  const pairs: Array<[number, string | number]> = [
    [0, 'SECTION'],
    [2, 'HEADER'],
    [9, '$ACADVER'],
    [1, insUnits === undefined ? 'AC1009' : 'AC1032'],
    ...(insUnits === undefined
      ? []
      : ([
          [9, '$INSUNITS'],
          [70, insUnits],
        ] as Array<[number, number | string]>)),
    [0, 'ENDSEC'],
    [0, 'SECTION'],
    [2, 'ENTITIES'],
    ...entities,
    [0, 'ENDSEC'],
    [0, 'EOF'],
  ]
  return pairs.map(([code, value]) => `${code}\n${value}`).join('\n') + '\n'
}
const dxfLine = (a: number[], b: number[], layer = 'ROAD'): Array<[number, number | string]> => [
  [0, 'LINE'],
  [8, layer],
  [10, a[0]],
  [20, a[1]],
  [30, 0],
  [11, b[0]],
  [21, b[1]],
  [31, 0],
]

describe('reading a DXF drawing', () => {
  const utm = [
    [512100, 5972300],
    [512050, 5971800],
  ]
  const toLonLat26910 = proj4(projectionDefinition(26910), 'EPSG:4326')

  it('reads a drawing in the projected CRS the person chose, with its layer and entity', async () => {
    const read = await readSpatialImport(file('plan.dxf', dxfText(dxfLine(utm[0], utm[1]))), { crs: { epsg: 26910 } })
    expect(read.format).toBe('DXF')
    expect(read.crs).toBe('EPSG:26910 (NAD83 / UTM zone 10N); drawing in metres (the drawing states no units)')
    const [feature] = read.collection.features
    expect(feature.properties).toEqual({ name: 'ROAD', layer: 'ROAD', dxfEntity: 'LINE' })
    const coordinates = (feature.geometry as GeoJSON.LineString).coordinates
    coordinates.forEach((c, i) => {
      const expected = toLonLat26910.forward(utm[i])
      expect(c).toHaveLength(2)
      expect(c[0]).toBeCloseTo(expected[0], 9)
      expect(c[1]).toBeCloseTo(expected[1], 9)
    })
  })

  it('asks where a drawing is rather than guessing, with its extent in file units', async () => {
    const reading = readSpatialImport(file('plan.dxf', dxfText(dxfLine(utm[0], utm[1]))))
    await expect(reading).rejects.toBeInstanceOf(SpatialCrsQuestion)
    const question = (await reading.catch((error: unknown) => error)) as SpatialCrsQuestion
    expect(question).toBeInstanceOf(SpatialImportError)
    expect(question).toMatchObject({
      reason: 'crs',
      fileName: 'plan.dxf',
      bounds: [512050, 5971800, 512100, 5972300],
      unitM: null,
      unitName: null,
    })
    expect(question.message).toMatch(/^plan\.dxf is a DXF drawing, which states no coordinate system/)
  })

  it('never reads feet as metres: it asks, and converts only on the person’s word', async () => {
    const feet = utm.map(([x, y]) => [x / 0.3048, y / 0.3048])
    const drawing = () => file('plan.dxf', dxfText(dxfLine(feet[0], feet[1]), 2))
    const question = (await readSpatialImport(drawing(), { crs: { epsg: 26910 } }).catch((e: unknown) => e)) as
      | SpatialCrsQuestion
      | undefined
    expect(question).toBeInstanceOf(SpatialCrsQuestion)
    expect(question).toMatchObject({ reason: 'units', unitM: 0.3048, unitName: 'feet' })
    expect(question!.message).toMatch(/says it is drawn in feet, and EPSG:26910 is in metres/)
    const converted = await readSpatialImport(drawing(), { crs: { epsg: 26910 }, unitM: 0.3048 })
    const first = (converted.collection.features[0].geometry as GeoJSON.LineString).coordinates[0]
    const expected = toLonLat26910.forward(utm[0])
    expect(first[0]).toBeCloseTo(expected[0], 9)
    expect(first[1]).toBeCloseTo(expected[1], 9)
    expect(converted.crs).toMatch(/drawing in feet \(as you confirmed\)$/)
  })

  it('places a drawing on the project’s plane in the plane’s unit, and asks when the drawing says otherwise', async () => {
    const plane = { offsetM: [1000, 2000] as [number, number], unitM: 0.3048 }
    const local = [
      [3300, 6500],
      [3400, 6600],
    ]
    for (const insUnits of [undefined, 2]) {
      const read = await readSpatialImport(file('plan.dxf', dxfText(dxfLine(local[0], local[1]), insUnits)), {
        crs: { plane },
      })
      const first = (read.collection.features[0].geometry as GeoJSON.LineString).coordinates[0]
      const expected = localPlaneProjection(plane.offsetM).toLonLat([3300 * 0.3048, 6500 * 0.3048])
      expect(first[0]).toBeCloseTo(expected[0], 12)
      expect(first[1]).toBeCloseTo(expected[1], 12)
      expect(read.crs).toMatch(/^the project's flat plane; drawing in feet/)
    }
    await expect(
      readSpatialImport(file('plan.dxf', dxfText(dxfLine(local[0], local[1]), 6)), { crs: { plane } }),
    ).rejects.toMatchObject({ reason: 'units', unitM: 1 })
  })

  it('refuses a UTM zone for a drawing in local coordinates, binary DXF and RoadEng profile files', async () => {
    await expect(
      readSpatialImport(file('plan.dxf', dxfText(dxfLine([0, 0], [100, 50]))), { crs: { epsg: 26910 } }),
    ).rejects.toThrow(/outside any UTM zone's eastings/)
    await expect(
      readSpatialImport(file('plan.dxf', dxfText(dxfLine(utm[0], utm[1]))), { crs: { epsg: 3857 } }),
    ).rejects.toThrow(/EPSG:3857 is not a projected coordinate system in metres this import reads/)
    await expect(
      readSpatialImport(file('plan.dxf', new TextEncoder().encode('AutoCAD Binary DXF\r\n\x1a\x00\x00'))),
    ).rejects.toThrow(/^plan\.dxf is a binary DXF/)
    await expect(
      readSpatialImport(file('Spur7-pro01.dxf', dxfText(dxfLine(utm[0], utm[1]))), { crs: { epsg: 26910 } }),
    ).rejects.toThrow(/looks like a RoadEng profile, section or multi-plot drawing/)
    await expect(readSpatialImport(file('plan.dxf', '0\nSECTION\n2\nENTITIES\n0\nLINE\n'))).rejects.toThrow(
      /^plan\.dxf could not be read as DXF: it ends inside its ENTITIES section/,
    )
  })

  describe('a round trip of PGMaps’ own DXF export', () => {
    const origin: Coordinate = [-122.75, 53.917]
    const at = (east: number, north: number) =>
      offsetCoordinate(origin, (Math.atan2(east, north) * 180) / Math.PI, Math.hypot(east, north))
    const spur: Alignment = {
      id: 'r',
      name: 'Spur 7',
      color: '#000000',
      points: [
        { id: 'a', coordinate: at(0, 0), radiusM: 0 },
        { id: 'b', coordinate: at(0, 150), radiusM: 60 },
        { id: 'c', coordinate: at(120, 220), radiusM: 50, spiralM: 20 },
        { id: 'd', coordinate: at(120, 380), radiusM: 0 },
      ],
      vertical: [
        { id: 'v0', chainage: 0, elevation: 800, curveLength: 0 },
        { id: 'v1', chainage: 380, elevation: 812, curveLength: 0 },
      ],
      template: { ...DEFAULT_TEMPLATE },
      overrides: [],
    }
    const hill: TerrainSource = {
      elevationAt: (lon, lat) => 800 + (lat - origin[1]) * 3000 + (lon - origin[0]) * 800,
    }
    const grid = localMetricGrid(origin)
    const drawing = roadDxf({
      name: 'Spur 7',
      alignment: spur,
      analysis: analyzeRoad(spur, hill, DEFAULT_ROAD_SETTINGS),
      terrain: { name: 'DEM', verticalReference: 'CGVD2013' },
      ...grid,
    })

    it('brings the plan centreline back on the road, as one line, and leaves the profile and sections out', async () => {
      // The export names its grid in a header comment, so no CRS has to be asked.
      const read = await readSpatialImport(file('Spur 7.dxf', drawing))
      expect(read.crs).toMatch(/^EPSG:32610 \(WGS84 \/ UTM zone 10N\), as the drawing states/)
      const layers = new Set(read.collection.features.map((f) => f.properties?.layer))
      for (const layer of layers) expect(layer).not.toMatch(/^(PROF|SECT)_/)
      expect(read.notices?.[0]).toMatch(
        /^Left out the profile and cross-section drawings \(layers PROF_TEXT, PROF_GRID, PROF_GROUND, PROF_DESIGN, SECT_TEXT, SECT_GRID, SECT_GROUND, SECT_DESIGN\)/,
      )
      const centrelines = read.collection.features.filter((f) => f.properties?.layer === 'CL')
      expect(centrelines).toHaveLength(1)
      expect(centrelines[0].properties).toMatchObject({ name: 'CL', dxfEntity: 'LINE+ARC+POLYLINE' })
      const imported = (centrelines[0].geometry as GeoJSON.LineString).coordinates.map((c) =>
        grid.toGrid(c as Coordinate),
      )
      const dense = centrelineSamples(spur, 0.25)
      const truth = dense.samples.map((s) => grid.toGrid(dense.toCoordinate(s.x, s.y)))
      const offRoad = (p: [number, number]) => {
        let best = Infinity
        for (let i = 1; i < truth.length; i++) {
          const [ax, ay] = truth[i - 1],
            [bx, by] = truth[i]
          const dx = bx - ax,
            dy = by - ay
          const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy || 1)))
          best = Math.min(best, Math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy))
        }
        return best
      }
      // Every vertex lies on what the export drew: its lines, spiral vertices and true grid arcs.
      const arcs = horizontalGeometry(spur).flatMap((piece) => {
        if (piece.kind !== 'arc') return []
        const a = grid.toGrid(piece.start),
          b = grid.toGrid(piece.end)
        const delta = piece.length / piece.radius
        const chord = Math.hypot(b[0] - a[0], b[1] - a[1])
        const radius = chord / (2 * Math.sin(delta / 2))
        const toCentre = (piece.rotation === 'ccw' ? 1 : -1) * radius * Math.cos(delta / 2)
        const centre = [
          (a[0] + b[0]) / 2 - ((b[1] - a[1]) / chord) * toCentre,
          (a[1] + b[1]) / 2 + ((b[0] - a[0]) / chord) * toCentre,
        ]
        return [{ centre, radius }]
      })
      const offDrawing = (p: [number, number]) =>
        Math.min(
          offRoad(p),
          ...arcs.map(({ centre, radius }) => Math.abs(Math.hypot(p[0] - centre[0], p[1] - centre[1]) - radius)),
        )
      expect(Math.max(...imported.map(offDrawing))).toBeLessThan(0.001)
      // The export draws each curve as a circle in the UTM grid, where the engine's arc is very slightly
      // elliptical (sphere against ellipsoid scale): about 1 cm mid-curve on this 60 m radius.
      expect(Math.max(...imported.map(offRoad))).toBeLessThan(0.015)
      // Same direction and ends as the road.
      expect(Math.hypot(imported[0][0] - truth[0][0], imported[0][1] - truth[0][1])).toBeLessThan(0.005)
      const last = imported[imported.length - 1],
        end = truth[truth.length - 1]
      expect(Math.hypot(last[0] - end[0], last[1] - end[1])).toBeLessThan(0.005)
      let length = 0
      for (let i = 1; i < imported.length; i++)
        length += Math.hypot(imported[i][0] - imported[i - 1][0], imported[i][1] - imported[i - 1][1])
      expect(Math.abs(length - dense.length)).toBeLessThan(0.5)
    })

    it('keeps the 3D feature lines’ heights only when asked', async () => {
      const flat = await readSpatialImport(file('Spur 7.dxf', drawing))
      const raised = await readSpatialImport(file('Spur 7.dxf', drawing), { keepHeights: true })
      const centreline3d = (read: SpatialFile) =>
        (read.collection.features.find((f) => f.properties?.layer === 'CL_3D')!.geometry as GeoJSON.LineString)
          .coordinates
      expect(centreline3d(flat)[0]).toHaveLength(2)
      expect(centreline3d(raised)[0][2]).toBeCloseTo(800, 0)
      // The 2D plan centreline stays 2D: a drawing at elevation 0 states no heights.
      const plan = raised.collection.features.find((f) => f.properties?.layer === 'CL')!
      expect((plan.geometry as GeoJSON.LineString).coordinates[0]).toHaveLength(2)
    })

    it('says its CL layer is the road and the rest drawing output', async () => {
      const read = await readSpatialImport(file('Spur 7.dxf', drawing))
      const byLayer = (layer: string) => read.collection.features.find((f) => f.properties?.layer === layer)!
      expect(statedRole(byLayer('CL'))).toBe('road')
      for (const layer of ['CL_3D', 'EDGE_L', 'CATCH_R', 'STATIONS', 'LABELS'])
        expect(statedRole(byLayer(layer))).toBe('skip')
      expect(read.notices).toContain(
        "The road is the drawing's CL layer; PGMaps' 3D section lines, station ticks and labels are drawing output.",
      )
      // Through the road picker: one road, and nothing else made of the drawing output.
      expect(buildSpatialImport(read, proposeRoles(read, 'road').roles, 'road').alignments).toHaveLength(1)
      const labels = read.collection.features.filter((f) => f.properties?.dxfEntity === 'TEXT')
      expect(labels.length).toBeGreaterThan(5)
      expect(labels[0].properties).toMatchObject({ name: '0+000', text: '0+000', layer: 'LABELS' })
    })
  })
})
