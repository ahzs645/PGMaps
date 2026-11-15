import { describe, expect, it } from 'vitest'
import { designExtent, groupNotes, layerImportOptions, linePartCount, suggestedLayerRole } from './referenceImport'
import type { SpatialFile } from './spatialImport'

const road = (name: string, geometry: GeoJSON.Geometry, pdf = false): SpatialFile => ({
  fileName: `Shapefiles/${name}.shp`,
  format: pdf ? 'GeoPDF' : 'shapefile',
  crs: 'EPSG:3005',
  collection: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name }, geometry }] },
  ...(pdf ? { pdf: { source: {} as never, note: '', selected: false } } : {}),
})
const parts: GeoJSON.MultiLineString = {
  type: 'MultiLineString',
  coordinates: [
    [
      [-121.53, 54.07],
      [-121.52, 54.06],
    ],
    [
      [-121.525, 54.065],
      [-121.51, 54.08],
    ],
  ],
}

describe('importing a road of several parts', () => {
  it('offers a GIS record of several lines as a proposed road, one road per part', () => {
    const file = road('XYZ001.4000', parts)
    expect(layerImportOptions(file)).toEqual(['reference', 'proposed-road'])
    expect(suggestedLayerRole(file)).toBe('proposed-road')
    expect(linePartCount(file)).toBe(2)
  })
  it('keeps a PDF drawing of several pieces as reference only', () => {
    expect(layerImportOptions(road('Roads', parts, true))).toEqual(['reference'])
  })
})

describe('the ground an import designs on', () => {
  it('spans proposed roads and planned blocks, never reference layers', () => {
    const far: GeoJSON.LineString = {
      type: 'LineString',
      coordinates: [
        [-100, 40],
        [-99, 41],
      ],
    }
    expect(
      designExtent([
        { file: road('XYZ001.4000', parts), role: 'proposed-road' },
        { file: road('Openings', far), role: 'reference' },
      ]),
    ).toEqual([-121.53, 54.06, -121.51, 54.08])
    expect(designExtent([{ file: road('Openings', far), role: 'reference' }])).toBeNull()
  })
})

describe('import notes', () => {
  it('prints a note several files share once, naming the files', () => {
    const shared = 'PDF drawings have no original GIS attributes.'
    expect(
      groupNotes([
        `Maps/A.pdf: ${shared}`,
        'Maps/B.pdf: identical to Maps/A.pdf; duplicate left out.',
        `Maps/C.pdf: ${shared}`,
        `Maps/C.pdf: ${shared}`,
      ]),
    ).toEqual([`${shared} (2 files: A.pdf, C.pdf)`, 'Maps/B.pdf: identical to Maps/A.pdf; duplicate left out.'])
  })
})
