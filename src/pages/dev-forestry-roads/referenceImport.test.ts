import { describe, expect, it } from 'vitest'
import {
  designExtent,
  groupNotes,
  layerImportOptions,
  linePartCount,
  preferTighterRegistration,
  suggestedLayerRole,
} from './referenceImport'
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

describe('Forest Operations Map layers', () => {
  const fom = (fileName: string, properties: Record<string, unknown>, geometry: GeoJSON.Geometry): SpatialFile => ({
    fileName,
    format: 'shapefile',
    crs: 'EPSG:3005',
    collection: { type: 'FeatureCollection', features: [{ type: 'Feature', properties, geometry }] },
  })
  const line: GeoJSON.LineString = {
    type: 'LineString',
    coordinates: [
      [-118.79, 51.17],
      [-118.78, 51.16],
    ],
  }
  const square: GeoJSON.Polygon = {
    type: 'Polygon',
    coordinates: [
      [
        [-118.79, 51.17],
        [-118.78, 51.17],
        [-118.78, 51.16],
        [-118.79, 51.17],
      ],
    ],
  }
  it('suggests a published road section as a proposed road and a cutblock as a planned block', () => {
    // Full names, as the WFS and GeoJSON downloads write them.
    expect(
      suggestedLayerRole(
        fom('road.geojson', { FOM_RS_SYSID: 1, FOM_ID: 2, ROAD_SECTION_ID: '3', NAME: 'Made up 1' }, line),
      ),
    ).toBe('proposed-road')
    // A shapefile's DBF cuts field names to ten characters.
    expect(
      suggestedLayerRole(fom('a/boundary.shp', { FOM_C_SYSI: 1, FOM_ID: 2, CUT_BLOCK_: '3', NAME: 'X' }, square)),
    ).toBe('planned-block')
  })
  it('leaves other FOM layers and look-alikes as reference', () => {
    expect(suggestedLayerRole(fom('wtra.shp', { FOM_RA_SYSI: 1, FOM_ID: 2 }, square))).toBe('reference')
    expect(suggestedLayerRole(fom('road.shp', { ROAD_SECTI: '3', NAME: 'X' }, line))).toBe('reference')
    // A cutblock record is never offered as a road.
    expect(suggestedLayerRole(fom('odd.shp', { FOM_C_SYSI: 1, FOM_ID: 2 }, line))).toBe('reference')
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

describe('two sheets of one map frame', () => {
  const frame = (shift = 0): GeoJSON.Polygon => ({
    type: 'Polygon',
    coordinates: [
      [
        [-121.547 + shift, 54.072],
        [-121.498 + shift, 54.07],
        [-121.5 + shift, 54.048],
        [-121.547 + shift, 54.05],
        [-121.547 + shift, 54.072],
      ],
    ],
  })
  const sheet = (file: string, fit: number, extra: Record<string, unknown> = {}, shift = 0): SpatialFile => ({
    fileName: `${file}/Page 1/${'classGrid' in extra ? 'Slope classes' : 'Map sheet'}`,
    format: 'GeoPDF',
    crs: 'Embedded',
    collection: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: frame(shift) }] },
    pdf: {
      source: { file: `Maps/${file}`, sha256: '', page: 1, layer: 'x', profile: 'p', registrationErrorM: fit },
      note: '',
      selected: true,
      sheet: { image: '', corners: [] as never },
      ...extra,
    },
  })
  const slope = { classGrid: { kind: 'slope' } as never }

  it('takes a class raster both offer from the sheet registered more tightly, and says which sits off', () => {
    // A copy 2 m west of the original, read first, so its raster was the one ticked.
    const files = [
      sheet('revised.pdf', 1.21, {}, -0.00003),
      { ...sheet('revised.pdf', 1.21, slope, -0.00003) },
      sheet('Slope_Map.pdf', 0.08),
      { ...sheet('Slope_Map.pdf', 0.08, slope), pdf: { ...sheet('Slope_Map.pdf', 0.08, slope).pdf!, selected: false } },
    ]
    preferTighterRegistration(files)
    expect(files.map((file) => file.pdf!.selected)).toEqual([true, false, true, true])
    expect(files[3].notices).toEqual([
      'Slope_Map.pdf: chosen over revised.pdf for the same layer, because its registration points fit 0.1 m against 1.2 m.',
    ])
    expect(files[0].notices).toEqual([
      "revised.pdf shows the same map frame as Slope_Map.pdf, but its registration points fit 1.2 m against 0.1 m, so its layers can sit about that far off. Use Slope_Map.pdf's layers where both offer one.",
    ])
    expect(files[2].notices).toBeUndefined()
  })

  it('leaves sheets of different frames, and fits about as tight, alone', () => {
    const apart = [sheet('a.pdf', 1.2), sheet('b.pdf', 0.1, {}, 0.01)]
    preferTighterRegistration(apart)
    expect(apart.every((file) => !file.notices)).toBe(true)
    const close = [sheet('a.pdf', 0.3, slope), sheet('b.pdf', 0.1, slope)]
    close[1].pdf!.selected = false
    preferTighterRegistration(close)
    expect(close.map((file) => file.pdf!.selected)).toEqual([true, false])
    expect(close.every((file) => !file.notices)).toBe(true)
  })
})
