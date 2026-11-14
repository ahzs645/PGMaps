import { describe, expect, it } from 'vitest'
import { analyzeRoad } from './engine'
import { parseProject, projectGeoJson, serializeProject } from './project'
import {
  compactReferenceFolder,
  parseReferenceFeatures,
  referenceBounds,
  referenceFolders,
  referenceGeoJson,
  type ReferenceFeature,
  type ReferenceLayer,
} from './referenceFeatures'
import { buildSpatialImport, statedRole } from './spatialImport'
import { createDemoProject, demoTerrain } from './terrain'

const landing: ReferenceFeature = {
  id: 'landing-1',
  name: 'Landing 1',
  geometry: { type: 'Point', coordinates: [-122.8177, 53.8909] },
  source: 'Landings.zip',
}
const boundary: ReferenceFeature = {
  id: 'lot-a',
  name: 'Lot A',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [-122.82, 53.89],
        [-122.81, 53.89],
        [-122.81, 53.9],
        [-122.82, 53.89],
      ],
    ],
  },
}

describe('reference features', () => {
  it('accepts points, lines and closed polygons and rejects anything malformed', () => {
    expect(parseReferenceFeatures([landing, boundary])).toEqual([landing, boundary])
    expect(() => parseReferenceFeatures([landing, landing])).toThrow(/unique/)
    expect(() => parseReferenceFeatures([{ ...landing, name: ' ' }])).toThrow(/needs a name/)
    expect(() =>
      parseReferenceFeatures([{ ...landing, geometry: { type: 'Point', coordinates: [512100, 5972300] } }]),
    ).toThrow(/longitude\/latitude/)
    const open = { type: 'Polygon', coordinates: [(boundary.geometry as GeoJSON.Polygon).coordinates[0].slice(0, 3)] }
    expect(() => parseReferenceFeatures([{ ...boundary, geometry: open }])).toThrow(/at least 4 vertices/)
    expect(() =>
      parseReferenceFeatures([{ ...landing, geometry: { type: 'MultiPoint', coordinates: [[0, 0]] } }]),
    ).toThrow(/a point, a line or a polygon/)
    expect(referenceBounds(boundary)).toEqual([-122.82, 53.89, -122.81, 53.9])
  })

  it('travels in a project file and changes no calculated result', () => {
    const base = createDemoProject()
    // A line and an area laid right across the road: as context they would be crossings.
    const across: ReferenceFeature = {
      id: 'across',
      name: 'Property line',
      geometry: {
        type: 'LineString',
        coordinates: [base.alignments[0].points[0].coordinate, base.alignments[0].points.at(-1)!.coordinate],
      },
    }
    const project = parseProject({ ...base, reference: [landing, boundary, across] })
    expect(project.reference).toEqual([landing, boundary, across])
    expect(parseProject(JSON.parse(serializeProject(project))).reference).toEqual(project.reference)
    const before = analyzeRoad(base.alignments[0], demoTerrain, base.settings, base.context)
    const after = analyzeRoad(project.alignments[0], demoTerrain, project.settings, project.context)
    expect(after.crossings).toEqual(before.crossings)
    expect(after.estimatedCost).toBe(before.estimatedCost)
    expect(project.context).toEqual(base.context)
  })

  it('exports as reference and imports back as reference through any picker', () => {
    const project = parseProject({ ...createDemoProject(), reference: [landing, boundary] })
    const exported = projectGeoJson(project, new Map())
    const reference = exported.features.filter((feature) => feature.properties?.kind === 'reference')
    expect(reference.map((feature) => feature.properties?.name)).toEqual(['Landing 1', 'Lot A'])
    expect(reference.map(statedRole)).toEqual(['reference', 'reference'])
    expect(referenceGeoJson([landing]).features[0].properties).toMatchObject({ shape: 'point', source: 'Landings.zip' })
    const built = buildSpatialImport(
      {
        fileName: 'job.geojson',
        format: 'GeoJSON',
        crs: 'WGS84 longitude/latitude',
        collection: { type: 'FeatureCollection', features: reference },
      },
      { point: null, line: null, polygon: null },
    )
    expect(built.reference.map((feature) => [feature.geometry.type, feature.name])).toEqual([
      ['Point', 'Landing 1'],
      ['Polygon', 'Lot A'],
    ])
    expect(built.context).toEqual([])
  })

  it('shows a chain of folders that each hold only the next one as a single row', () => {
    const layer = (key: string): ReferenceLayer => ({ key, name: key, features: [] })
    const root = referenceFolders([
      layer('Shapefiles/Rd_1000/Rd_1000/road.shp'),
      layer('Shapefiles/Zips/2026/blocks.shp'),
      layer('Shapefiles/boundary.shp'),
    ])
    const shapefiles = root.folders.get('Shapefiles')!
    // A folder with layers or several folders of its own stays a row.
    expect(compactReferenceFolder(shapefiles)).toEqual({ folder: shapefiles, label: 'Shapefiles' })
    // An archive unpacked into a folder of its own name prints that name once, and a chain that
    // ends in a single layer hands that layer over to be listed in the folder's place.
    const road = compactReferenceFolder(shapefiles.folders.get('Rd_1000')!)
    expect(road.label).toBe('Rd_1000')
    expect(road.folder.path).toBe('Shapefiles/Rd_1000/Rd_1000')
    expect(road.onlyLayer?.key).toBe('Shapefiles/Rd_1000/Rd_1000/road.shp')
    const blocks = compactReferenceFolder(shapefiles.folders.get('Zips')!)
    expect(blocks.label).toBe('Zips / 2026')
    expect(blocks.folder.path).toBe('Shapefiles/Zips/2026')
    // Two layers keep their folder.
    const pair = referenceFolders([layer('Survey/a.shp'), layer('Survey/b.shp')]).folders.get('Survey')!
    expect(compactReferenceFolder(pair).onlyLayer).toBeUndefined()
  })
})
