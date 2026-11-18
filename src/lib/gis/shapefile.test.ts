import { zipSync } from 'fflate'
import shp from 'shpjs'
import { describe, expect, it } from 'vitest'
import { gisLayerFromShapeLayer, layerToGeoJson } from './layers'
import { writeShapefileLayer } from './shapefile'
import { ROAD_SHAPE_LAYERS } from './testLayers'

// The writer's own cases (dBase limits, ring order) are in src/pages/dev-forestry-roads/shapefile.test.ts,
// which reads it through the road designer's path; this one checks it from shared code on its own.
describe('shared shapefile writer', () => {
  it('writes layers a shapefile reader parses back as the same features as the neutral layer', async () => {
    const files: Record<string, Uint8Array> = {}
    for (const layer of ROAD_SHAPE_LAYERS) {
      const written = writeShapefileLayer(layer)
      expect(written.warnings).toEqual([])
      Object.assign(files, written.files)
    }
    expect(new TextDecoder().decode(files['road_stations.prj'])).toContain('GCS_WGS_1984')
    const parsed = (await shp(zipSync(files).buffer as ArrayBuffer)) as (GeoJSON.FeatureCollection & {
      fileName: string
    })[]
    for (const layer of ROAD_SHAPE_LAYERS) {
      const read = parsed.find((collection) => collection.fileName === layer.name)!
      const expected = layerToGeoJson(gisLayerFromShapeLayer(layer))
      expect(read.features.map((f) => f.properties)).toEqual(expected.features.map((f) => f.properties))
      expect(read.features.map((f) => f.geometry.type)).toEqual(expected.features.map((f) => f.geometry!.type))
    }
  })
})
