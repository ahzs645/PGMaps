import { DOMParser, type Element } from '@xmldom/xmldom'
import { describe, expect, it } from 'vitest'
// PGMaps' own KML reader: what the road designer imports, so a write-then-read round trip is the test that matters.
import { parseKml } from '@/pages/dev-forestry-roads/surveyInterchange'
import { decimalText, kmlColor, KML_NAMESPACE, writeKml } from './kml'
import { GisCoordinateError, gisLayerFromShapeLayer, type GisLayer } from './layers'
import { ROAD_SHAPE_LAYERS } from './testLayers'

/** Parses strictly: any XML error fails the test. */
function parse(kml: string) {
  const document = new DOMParser({
    onError: (level, message) => {
      // The U+FFFD written for a control character draws a warning; only errors mean broken XML.
      if (level !== 'warning') throw Error(`${level}: ${message}`)
    },
  }).parseFromString(kml, 'text/xml')
  return document.documentElement!
}
const all = (node: Element, name: string) => Array.from(node.getElementsByTagNameNS(KML_NAMESPACE, name))
const child = (node: Element, name: string) =>
  Array.from(node.childNodes).find((c): c is Element => c.nodeType === 1 && (c as Element).localName === name)
const textOf = (node: Element | undefined) => node?.textContent ?? null

const road = ROAD_SHAPE_LAYERS.map(gisLayerFromShapeLayer)
const views: GisLayer = {
  name: 'views',
  title: 'Views of interest',
  description: 'Planned <viewpoints> & framing',
  geometry: 'point',
  fields: [
    { name: 'label', type: 'text', title: 'Viewpoint' },
    { name: 'note', type: 'text' },
    { name: 'eye_m', type: 'real' },
    { name: 'tiny', type: 'real' },
    { name: 'visible', type: 'boolean' },
  ],
  features: [
    {
      points: [[-122.79, 53.905, 812.5]],
      attributes: { label: 'Tabor <lookout> & "west"', note: 'bell\u0007 here', eye_m: 1.5, tiny: 1e-7, visible: true },
    },
    { points: [[-122.78, 53.906]], attributes: { label: null, note: null, eye_m: null, tiny: 2.5e21, visible: false } },
  ],
}

describe('KML writer', () => {
  it('writes a Folder and a Style per layer with every field as ExtendedData', () => {
    const { kml, warnings } = writeKml([...road, views], {
      name: 'Spur road & blocks',
      styles: {
        road_centrelines: { lineColor: '#16817a', lineWidth: 3 },
        context_areas: { lineColor: '#000', fillColor: '#ff8000', fillOpacity: 0.4 },
        views: { iconColor: '#ff000080', iconScale: 1.2 },
        road_stations: { iconColor: 'teal' },
      },
      nameField: { views: 'label' },
    })
    const root = parse(kml)
    expect(root.localName).toBe('kml')
    expect(root.namespaceURI).toBe(KML_NAMESPACE)
    const document = child(root, 'Document')!
    expect(textOf(child(document, 'name'))).toBe('Spur road & blocks')

    const styles = all(root, 'Style')
    expect(styles.map((s) => s.getAttribute('id'))).toEqual([
      'style_road_centrelines',
      'style_road_stations',
      'style_context_areas',
      'style_views',
    ])
    // KML colours are aabbggrr.
    expect(textOf(all(styles[0], 'color')[0])).toBe('ff7a8116')
    expect(textOf(all(styles[0], 'width')[0])).toBe('3')
    const poly = all(styles[2], 'PolyStyle')[0]
    expect(textOf(child(poly, 'color'))).toBe('660080ff')
    expect(textOf(child(poly, 'fill'))).toBe('1')
    expect(textOf(child(poly, 'outline'))).toBe('1')
    expect(textOf(all(styles[2], 'LineStyle')[0])).toBe('ff000000')
    expect(textOf(all(styles[3], 'color')[0])).toBe('800000ff')
    expect(textOf(all(styles[3], 'scale')[0])).toBe('1.2')
    expect(warnings).toEqual([
      'road_stations: icon colour "teal" left out; it is not a hex colour.',
      'views: 1 vertex has no height; KML clients read it at altitude 0.',
      '1 character XML cannot hold (control characters or broken surrogates) written as U+FFFD.',
    ])

    const folders = all(root, 'Folder')
    expect(folders.map((f) => textOf(child(f, 'name')))).toEqual([
      'road_centrelines',
      'road_stations',
      'context_areas',
      'Views of interest',
    ])
    expect(textOf(child(folders[3], 'description'))).toBe('Planned <viewpoints> & framing')
    for (const [i, folder] of folders.entries())
      for (const mark of all(folder, 'Placemark'))
        expect(textOf(child(mark, 'styleUrl'))).toBe(`#${styles[i].getAttribute('id')}`)

    const [centreline] = all(folders[0], 'Placemark')
    expect(textOf(child(centreline, 'name'))).toBe('Spur road · été')
    const data = all(centreline, 'Data').map((d) => [d.getAttribute('name'), textOf(child(d, 'value'))])
    expect(data).toEqual([
      ['NAME', 'Spur road · été'],
      ['LENGTH_M', '300.12'],
      ['COST_CAD', '41500'],
    ])
    // lon,lat order, plain decimals, draped over the terrain because the layer has no heights.
    const line = all(centreline, 'LineString')[0]
    expect(textOf(child(line, 'coordinates'))).toBe('-122.8,53.9 -122.797,53.902')
    expect(textOf(child(line, 'tessellate'))).toBe('1')
    expect(child(line, 'altitudeMode')).toBeUndefined()

    // Stations have no name field, so they are numbered within their layer.
    expect(all(folders[1], 'Placemark').map((m) => textOf(child(m, 'name')))).toEqual([
      'road_stations 1',
      'road_stations 2',
    ])
    expect(all(all(folders[1], 'Placemark')[1], 'Data').map((d) => textOf(child(d, 'value')))).toEqual([
      '150',
      'steep; cut > 2 m',
    ])

    const polygon = all(folders[2], 'Polygon')[0]
    const ring = textOf(all(child(polygon, 'outerBoundaryIs')!, 'coordinates')[0])!.split(' ')
    // Closed, counter-clockwise.
    expect(ring).toEqual(['-122.81,53.9', '-122.8,53.9', '-122.8,53.91', '-122.81,53.91', '-122.81,53.9'])

    const [lookout, highway] = all(folders[3], 'Placemark')
    expect(textOf(child(lookout, 'name'))).toBe('Tabor <lookout> & "west"')
    expect(kml).toContain('<name>Tabor &lt;lookout&gt; &amp; &quot;west&quot;</name>')
    const point = all(lookout, 'Point')[0]
    expect(textOf(child(point, 'altitudeMode'))).toBe('absolute')
    expect(textOf(child(point, 'coordinates'))).toBe('-122.79,53.905,812.5')
    const lookoutData = Object.fromEntries(
      all(lookout, 'Data').map((d) => [
        d.getAttribute('name'),
        [textOf(child(d, 'displayName')), textOf(child(d, 'value'))],
      ]),
    )
    expect(lookoutData).toEqual({
      label: ['Viewpoint', 'Tabor <lookout> & "west"'],
      note: [null, 'bell\uFFFD here'],
      eye_m: [null, '1.5'],
      tiny: [null, '0.0000001'],
      visible: [null, 'true'],
    })
    // A placemark with no name falls back to its layer and number; unknown values are left out.
    expect(textOf(child(highway, 'name'))).toBe('Views of interest 2')
    expect(all(highway, 'Data').map((d) => d.getAttribute('name'))).toEqual(['tiny', 'visible'])
    expect(textOf(all(highway, 'value')[0])).toBe('2500000000000000000000')
    expect(textOf(all(highway, 'coordinates')[0])).toBe('-122.78,53.906')
  })

  it('reads back through PGMaps’ own KML reader with geometry and attributes', () => {
    const { kml } = writeKml(road, { name: 'Road' })
    const read = parseKml(kml)
    expect(read.features.map((f) => [f.geometry.type, f.properties!.name])).toEqual([
      ['LineString', 'Spur road · été'],
      ['Point', 'road_stations 1'],
      ['Point', 'road_stations 2'],
      ['Polygon', 'Block A'],
    ])
    expect(read.features[0].properties).toMatchObject({
      NAME: 'Spur road · été',
      LENGTH_M: '300.12',
      COST_CAD: '41500',
    })
    expect((read.features[0].geometry as GeoJSON.LineString).coordinates).toEqual([
      [-122.8, 53.9],
      [-122.797, 53.902],
    ])
    expect(read.features[2].properties).toMatchObject({ STATION_M: '150', FLAGS: 'steep; cut > 2 m' })
  })

  it('writes several parts as a MultiGeometry', () => {
    const layer: GisLayer = {
      name: 'streams',
      geometry: 'line',
      fields: [],
      features: [
        {
          lines: [
            [
              [-122.8, 53.9],
              [-122.8, 53.91],
            ],
            [
              [-122.7, 53.9],
              [-122.7, 53.91],
            ],
          ],
          attributes: {},
        },
      ],
    }
    const root = parse(writeKml([layer], { name: 'Streams' }).kml)
    const multi = all(root, 'MultiGeometry')
    expect(multi).toHaveLength(1)
    expect(all(multi[0], 'LineString')).toHaveLength(2)
    expect(parseKml(writeKml([layer], { name: 'Streams' }).kml).features).toHaveLength(2)
  })

  it('refuses a coordinate it cannot write, naming the layer and feature, and never writes NaN', () => {
    const layer: GisLayer = {
      name: 'road_centrelines',
      geometry: 'line',
      fields: [{ name: 'NAME', type: 'text' }],
      features: [
        {
          lines: [
            [
              [-122.8, 53.9],
              [-122.79, 53.91],
            ],
          ],
          attributes: { NAME: 'Main' },
        },
        {
          lines: [
            [
              [-122.8, 53.9],
              [Number.NaN, 53.91],
            ],
          ],
          attributes: { NAME: 'Spur 2' },
        },
      ],
    }
    expect(() => writeKml([layer], { name: 'x' })).toThrow(GisCoordinateError)
    expect(() => writeKml([layer], { name: 'x' })).toThrow('Layer "road_centrelines", feature 2 (Spur 2)')
  })

  it('formats numbers and colours the way KML readers take them', () => {
    expect(decimalText(1e-7)).toBe('0.0000001')
    expect(decimalText(-1.5e-8)).toBe('-0.000000015')
    expect(decimalText(1.25e21)).toBe('1250000000000000000000')
    expect(decimalText(-122.80000000000001)).toBe('-122.80000000000001')
    expect(kmlColor('#abc')).toBe('ffccbbaa')
    expect(kmlColor('#11223344')).toBe('44332211')
    expect(kmlColor('#112233', 0.5)).toBe('80332211')
    expect(kmlColor('red')).toBeNull()
  })
})
