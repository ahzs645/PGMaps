import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
// PGMaps' own KMZ reader, so the archive is checked the way the road designer imports it.
import { kmzDocument, parseKml } from '@/pages/dev-forestry-roads/surveyInterchange'
import { writeKmz } from './kmz'
import { gisLayerFromShapeLayer } from './layers'
import { ROAD_SHAPE_LAYERS } from './testLayers'

const road = ROAD_SHAPE_LAYERS.map(gisLayerFromShapeLayer)

describe('KMZ writer', () => {
  it('zips doc.kml first, with any files beside it, and reads back through PGMaps’ reader', async () => {
    const icon = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    const { bytes, warnings } = writeKmz(road, {
      name: 'Road',
      styles: { road_stations: { iconHref: 'files/station.png' } },
      files: { 'files/station.png': icon },
      modified: new Date('2026-11-18T12:00:00Z'),
    })
    expect(warnings).toEqual([])
    const entries = unzipSync(bytes)
    expect(Object.keys(entries)).toEqual(['doc.kml', 'files/station.png'])
    expect(entries['files/station.png']).toEqual(icon)
    const kml = await kmzDocument(bytes)
    expect(kml).toContain('<Icon><href>files/station.png</href></Icon>')
    expect(parseKml(kml).features).toHaveLength(4)
  })

  it('refuses a file that would leave the archive or a second KML', () => {
    expect(() => writeKmz(road, { name: 'x', files: { '../x.png': new Uint8Array() } })).toThrow(/inside the archive/)
    expect(() => writeKmz(road, { name: 'x', files: { 'other.kml': new Uint8Array() } })).toThrow(/second KML/)
  })
})
