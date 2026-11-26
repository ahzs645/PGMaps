import { describe, expect, it } from 'vitest'
import {
  designExtent,
  groupNotes,
  layerImportOptions,
  linePartCount,
  preferTighterRegistration,
  readReferenceImport,
  suggestedLayerRole,
  tickSheetsByFrame,
  unreadFilesNote,
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

describe('sheets of different areas', () => {
  const frame = (shift: number): GeoJSON.Polygon => ({
    type: 'Polygon',
    coordinates: [
      [
        [-121.5 + shift, 54.07],
        [-121.4 + shift, 54.07],
        [-121.4 + shift, 54.0],
        [-121.5 + shift, 54.0],
        [-121.5 + shift, 54.07],
      ],
    ],
  })
  const sheet = (file: string, shift: number, selected = false): SpatialFile => ({
    fileName: `${file}/Page 1/Map sheet`,
    format: 'GeoPDF',
    crs: 'Embedded',
    collection: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: frame(shift) }] },
    pdf: {
      source: { file, sha256: '', page: 1, layer: 'Map sheet', profile: 'p', registrationErrorM: 0 },
      note: '',
      selected,
      sheet: { image: '', corners: [] as never },
    },
  })

  it('ticks one sheet of each frame, not a second sheet of a frame already shown', () => {
    const files = [sheet('a.pdf', 0, true), sheet('a-canopy.pdf', 0), sheet('b.pdf', 1), sheet('c.pdf', 2)]
    tickSheetsByFrame(files, null)
    expect(files.map((file) => file.pdf!.selected)).toEqual([true, false, true, true])
  })

  it('with GIS layers in the import, adds only the frames over them', () => {
    const files = [sheet('a.pdf', 0, true), sheet('b.pdf', 1), sheet('c.pdf', 2)]
    tickSheetsByFrame(files, [-120.48, 54.01, -120.42, 54.05])
    expect(files.map((file) => file.pdf!.selected)).toEqual([true, true, false])
  })
})

describe('files a folder holds that are not read', () => {
  it('names them in one note, and passes over a shapefile’s sidecars', () => {
    expect(
      unreadFilesNote([
        'Plan/blocks.shp',
        'Plan/blocks.dbf',
        'Plan/blocks.sbn',
        'Plan/blocks.shp.xml',
        'Plan/blocks.shp.HOST.1.2.sr.lock',
        'Plan/blocks.shp.HOST.3.4.sr.lock',
        'Plan/Plan notes.docx',
        'Plan/~$an notes.docx',
        'Plan/Maps/sheet.pdf',
      ]),
    ).toBe('Not read: 2 ArcGIS lock files; Plan notes.docx (Word document); 1 Office lock file.')
    expect(unreadFilesNote(['blocks.shp', 'blocks.prj', 'sheet.pdf'])).toBeNull()
  })
})

describe('a plan’s block file', () => {
  const blocks = (fileName: string, properties: Record<string, unknown>): SpatialFile => ({
    fileName,
    format: 'shapefile',
    crs: 'EPSG:3005',
    collection: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties,
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-121.5, 54],
                [-121.49, 54],
                [-121.49, 54.01],
                [-121.5, 54],
              ],
            ],
          },
        },
      ],
    },
  })

  it('is suggested as planned cutblocks when its name says plan and it carries a block identifier', () => {
    expect(suggestedLayerRole(blocks('Plan/District_5_Year_Plan.shp', { Block_ID: '', Area: 3 }))).toBe('planned-block')
    expect(suggestedLayerRole(blocks('Plan/proposed.shp', { CUT_BLOCK_: 'A1' }))).toBe('planned-block')
    // A plan file without a block field, or a block file not named as a plan, stays reference.
    expect(suggestedLayerRole(blocks('Plan/District_5_Year_Plan.shp', { Area: 3 }))).toBe('reference')
    expect(suggestedLayerRole(blocks('Plan/Openings.shp', { Block_ID: 'A1' }))).toBe('reference')
  })
})

describe('folder layer review', () => {
  function picked(path: string, contents: string) {
    return { path, file: new File([contents], path.split('/').at(-1)!) }
  }

  const block = {
    type: 'Feature',
    properties: { name: 'Block A' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-122.8, 53.9],
          [-122.79, 53.9],
          [-122.79, 53.91],
          [-122.8, 53.9],
        ],
      ],
    },
  }
  const line = {
    type: 'Feature',
    properties: { name: 'Old road' },
    geometry: {
      type: 'LineString',
      coordinates: [
        [-122.8, 53.9],
        [-122.79, 53.9],
      ],
    },
  }
  const invalid = picked('Folder/manifest.json', '{"title":"not a map"}')

  it('keeps valid layers on either side of an unreadable file and reports the path', async () => {
    const files = await readReferenceImport([
      picked('Folder/a.geojson', JSON.stringify(block)),
      invalid,
      picked('Folder/sub/z.geojson', JSON.stringify(line)),
      picked('Folder/readme.csv', 'a,b'),
    ])
    expect(files.map((file) => file.fileName)).toEqual(['Folder/a.geojson', 'Folder/sub/z.geojson'])
    expect(files[0].notices).toEqual([
      expect.stringContaining('Could not read Folder/manifest.json:'),
      expect.stringContaining('Not read: readme.csv'),
    ])
  })

  it('rejects an all-invalid import, and does not turn cancellation into a warning', async () => {
    await expect(readReferenceImport([invalid])).rejects.toThrow('Folder/manifest.json')
    const controller = new AbortController()
    controller.abort()
    await expect(readReferenceImport([invalid], controller.signal)).rejects.toHaveProperty('name', 'AbortError')
  })

  it('makes polygons in a mixed file selectable as blocks without making the line a road by default', async () => {
    const files = await readReferenceImport([
      picked('Folder/mixed.geojson', JSON.stringify({ type: 'FeatureCollection', features: [block, line] })),
    ])
    expect(files.map((file) => file.fileName)).toEqual(['Folder/mixed.geojson/Polygons', 'Folder/mixed.geojson/Lines'])
    expect(files.map(layerImportOptions)).toEqual([
      ['reference', 'planned-block'],
      ['reference', 'proposed-road'],
    ])
    expect(files.map(suggestedLayerRole)).toEqual(['reference', 'reference'])
    expect(files.map((file) => file.collection.features.map((feature) => feature.properties?.name))).toEqual([
      ['Block A'],
      ['Old road'],
    ])
  })
})
