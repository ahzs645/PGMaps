import { describe, expect, it } from 'vitest'
import * as runtime from 'pdfjs-dist/legacy/build/pdf.mjs'
import { canforPdfFixture } from '../../../tests/fixtures/canforPdf'
import { SYNTHETIC_JPEGS } from '../../../tests/fixtures/syntheticClassJpeg'
import { applyLayerImport, layerImportOptions } from '@/pages/dev-forestry-roads/referenceImport'
import { createDemoProject } from '@/pages/dev-forestry-roads/terrain'
import { parseProject, serializeProject } from '@/pages/dev-forestry-roads/project'
import { referenceGeoJson } from '@/pages/dev-forestry-roads/referenceFeatures'
import { buildSpatialImport, type SpatialFile } from '@/pages/dev-forestry-roads/spatialImport'
import { vehicleToolSources } from '@/pages/dev-forestry-roads/vehicleTools'
import { blockChoices } from '@/pages/dev-forestry-roads/blockSheet'
import { jpegComponents, mosaicSampler, mosaicTileCorners, parseImageMosaic } from './imageMosaic'
import { readGeoPdf } from './read'
import type { PdfImageMosaic } from './types'

const limits = { maxFeatures: 500, maxVertices: 50_000 }
const read = async (picture: 'png' | 'jpeg') => {
  const result = await readGeoPdf(await canforPdfFixture({ picture }), 'Hillshade.pdf', runtime, limits)
  return { result, layer: result.layers.find((l) => l.imageMosaic)! }
}

describe('image layers at their own pixels', () => {
  it('places lossless tiles on their common pixel grid and writes them as PNG', async () => {
    const { result, layer } = await read('png')
    expect(layer, result.notices.join('\n')).toBeDefined()
    expect(layer).toMatchObject({ name: 'Hillshade', suggestedRole: 'reference', selected: true })
    expect(layer.source.layer).toBe('Hillshade')
    const mosaic = parseImageMosaic(layer.imageMosaic)!
    expect(mosaic).toMatchObject({ kind: 'hillshade', width: 4, height: 4 })
    expect(mosaic.tiles.map(({ col, row, width, height, lossy }) => ({ col, row, width, height, lossy }))).toEqual([
      { col: 0, row: 0, width: 2, height: 4, lossy: false },
      { col: 2, row: 0, width: 2, height: 4, lossy: false },
    ])
    expect(mosaic.tiles.every((tile) => tile.image.startsWith('data:image/png;base64,iVBOR'))).toBe(true)
    // 180 points of page are 1,800 m of ground in the fixture: a pixel is 450 m.
    expect(Math.hypot(mosaic.transform[0], mosaic.transform[1])).toBeCloseTo(450, 3)
    // The second tile starts where the first ends: no gap and no overlap between them.
    const [first, second] = mosaic.tiles.map((tile) => mosaicTileCorners(mosaic, tile))
    expect(second[0][0]).toBeCloseTo(first[1][0], 9)
    expect(second[0][1]).toBeCloseTo(first[1][1], 9)
    expect(second[3][0]).toBeCloseTo(first[2][0], 9)
  })

  it('keeps a JPEG tile as the file the PDF stores, undecoded', async () => {
    const { layer } = await read('jpeg')
    const mosaic = layer.imageMosaic!
    expect(mosaic).toMatchObject({ width: 120, height: 88 })
    expect(mosaic.tiles).toHaveLength(1)
    expect(mosaic.tiles[0].image).toBe(`data:image/jpeg;base64,${SYNTHETIC_JPEGS.plain.b64}`)
    expect(mosaic.tiles[0].lossy).toBe(true)
  })

  it('reads the nearest pixel of the tile that covers a point', async () => {
    const { layer } = await read('png')
    const mosaic = layer.imageMosaic!
    // The fixture's greys: 10 × column + row, one byte a pixel.
    const pixels = mosaic.tiles.map((_tile, index) =>
      Uint8Array.from({ length: 8 }, (_, i) => 10 * ((i % 2) + index * 2) + Math.floor(i / 2)),
    )
    const sample = mosaicSampler(mosaic, pixels)
    const out = new Uint8ClampedArray(8)
    const corners = mosaicTileCorners(mosaic, { ...mosaic.tiles[0], col: 3, row: 2, width: 1, height: 1 })
    const centre = [(corners[0][0] + corners[2][0]) / 2, (corners[0][1] + corners[2][1]) / 2]
    expect(sample(centre[0], centre[1], out, 4)).toBe(true)
    expect([...out]).toEqual([0, 0, 0, 0, 32, 32, 32, 255])
    // Four bytes a pixel are read as colour.
    const rgba = mosaic.tiles.map(() => Uint8Array.from({ length: 32 }, (_, i) => i))
    expect(mosaicSampler(mosaic, rgba)(centre[0], centre[1], out, 0)).toBe(true)
    expect([...out.subarray(0, 4)]).toEqual([20, 21, 22, 23])
    // Outside the mosaic, and under a tile that did not decode, nothing is written.
    expect(sample(centre[0] + 1, centre[1], out, 0)).toBe(false)
    expect(mosaicSampler(mosaic, [pixels[0], null])(centre[0], centre[1], out, 0)).toBe(false)
  })

  it('survives a project file and a GeoJSON round trip, and is never a block, a vehicle source or a road', async () => {
    const { layer } = await read('png')
    const file: SpatialFile = {
      fileName: 'Hillshade.pdf/Page 1/Hillshade',
      format: 'GeoPDF',
      crs: 'Embedded map',
      collection: { type: 'FeatureCollection', features: layer.features },
      pdf: { source: layer.source, note: layer.note, selected: true, imageMosaic: layer.imageMosaic },
    }
    expect(layerImportOptions(file)).toEqual(['reference'])
    const base = createDemoProject()
    expect(() => applyLayerImport(base, [{ file, role: 'planned-block' }], () => 'picture')).toThrow()
    const project = applyLayerImport(base, [{ file, role: 'reference' }], () => 'picture').project
    expect(project.terrain).toEqual(base.terrain)
    const restored = parseProject(JSON.parse(serializeProject(project)))
    expect(restored.reference![0].imageMosaic).toEqual(layer.imageMosaic)
    const back = buildSpatialImport(
      {
        fileName: 'roundtrip.geojson',
        format: 'GeoJSON',
        crs: 'WGS84',
        collection: referenceGeoJson(project.reference!),
      },
      { point: 'reference', line: 'reference', polygon: 'reference' },
      'reference',
    )
    expect(back.reference[0].imageMosaic).toEqual(layer.imageMosaic)
    expect(referenceGeoJson(project.reference!, false).features[0].properties).toMatchObject({ imageFrame: true })
    expect(vehicleToolSources([], restored.reference!)).toEqual([])
    expect(blockChoices(restored)).toEqual(blockChoices(base))
  })

  it('refuses a stored layer whose tiles do not fit it', async () => {
    const { layer } = await read('png')
    const mosaic = JSON.parse(JSON.stringify(layer.imageMosaic)) as PdfImageMosaic
    expect(parseImageMosaic(mosaic)).toBe(mosaic)
    expect(() => parseImageMosaic({ ...mosaic, tiles: [{ ...mosaic.tiles[0], col: 3 }] })).toThrow(/tile/)
    expect(() =>
      parseImageMosaic({ ...mosaic, tiles: [{ ...mosaic.tiles[0], image: 'data:text/html;base64,AAAA' }] }),
    ).toThrow(/tile/)
    expect(() => parseImageMosaic({ ...mosaic, kind: 'slope' })).toThrow(/dimensions/)
    expect(() => parseImageMosaic({ ...mosaic, tiles: [] })).toThrow(/tiles/)
  })

  it("counts a JPEG file's colour components from its frame header", () => {
    const jpeg = Uint8Array.from(atob(SYNTHETIC_JPEGS.plain.b64), (c) => c.charCodeAt(0))
    expect(jpegComponents(jpeg)).toBe(3)
    expect(jpegComponents(Uint8Array.of(0x89, 0x50, 0x4e, 0x47))).toBe(0)
    expect(jpegComponents(jpeg.subarray(0, 12))).toBe(0)
  })
})
