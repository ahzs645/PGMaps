import { describe, expect, it } from 'vitest'
import { catalogueSymbolLibrary } from '@/lib/forestry/blockSheet/symbolLibrary'
import { FIXTURE_DOCUMENT } from '../fixtures'
import type { StyledLayer } from '../model'
import { parseXml, descendants, localName, textOf } from '../xml'
import { hatchMark, readSld, SE_PX_PER_PT, sldForLayer, sldLayerStyles } from './sld'

const layer = (id: string) => FIXTURE_DOCUMENT.layers.find((l) => l.id === id)!
/** The SLD without its PGMaps comment, as another application would save it. */
const stripped = (sld: string) => sld.replace(/<!--pgmaps-style-exchange-v1:[^>]*-->/, '')

describe('SLD writer', () => {
  it('writes one SLD 1.1 per layer, named by layer id', () => {
    const { files } = sldLayerStyles(FIXTURE_DOCUMENT)
    expect(files.map((f) => f.path)).toEqual(FIXTURE_DOCUMENT.layers.map((l) => `${l.id}.sld`))
    const root = parseXml(files[0].content as string)
    expect(root.getAttribute('version')).toBe('1.1.0')
    expect(textOf(descendants(root, 'NamedLayer')[0].getElementsByTagName('se:Name')[0])).toBe('context_areas')
  })

  it('keeps first-match meaning: overlapping rules exclude those above, the last rule is ElseFilter', () => {
    const root = parseXml(sldForLayer(layer('road_centrelines')).sld)
    const rules = descendants(root, 'Rule').filter((r) => descendants(r, 'TextSymbolizer').length === 0)
    const filterOf = (rule: (typeof rules)[number]) => descendants(rule, 'Filter')[0]
    // Main line, then the spurs (disjoint values of NAME: no exclusion needed).
    expect(descendants(filterOf(rules[1]), 'Not')).toHaveLength(0)
    // Steep filters on MAXGRADE, which can overlap both NAME rules: it excludes them.
    const steep = filterOf(rules[2])
    expect(localName(steep.firstChild!.nextSibling as never)).toBe('And')
    expect(descendants(steep, 'Not')).toHaveLength(1)
    expect(descendants(rules[3], 'ElseFilter')).toHaveLength(1)
  })

  it("quotes Spur B's as text and writes numeric bounds as numbers", () => {
    const sld = sldForLayer(layer('road_centrelines')).sld
    expect(sld).toContain('<ogc:Literal>Spur B&apos;s</ogc:Literal>')
    expect(sld).toContain('<ogc:Literal>12</ogc:Literal>')
    expect(sld).toContain('PropertyIsGreaterThanOrEqualTo')
  })

  it('writes widths as SE pixels of 0.28 mm, with the unit stated', () => {
    const sld = sldForLayer(layer('context_lines')).sld
    expect(sld).toContain('uom="http://www.opengeospatial.org/se/units/pixel"')
    // The stream is 1 pt.
    expect(sld).toContain(`<se:SvgParameter name="stroke-width">${Number(SE_PX_PER_PT.toFixed(3))}</se:SvgParameter>`)
  })

  it('writes hatches as QGIS line pattern fills', () => {
    expect(hatchMark({ angleDeg: 45, spacing: 5, stroke: { color: '#000', width: 1 } })).toEqual({
      mark: 'horline',
      size: 5,
      rotation: 45,
    })
    expect(hatchMark({ angleDeg: -45, spacing: 5, stroke: { color: '#000', width: 1 } }).rotation).toBe(135)
  })

  it('writes every catalogue symbol without throwing', () => {
    for (const entry of catalogueSymbolLibrary().symbols) {
      const geometry = entry.symbol.kind === 'line' ? 'line' : entry.symbol.kind === 'point' ? 'point' : 'polygon'
      const single: StyledLayer = {
        id: 'x',
        name: entry.name,
        geometry,
        fields: [],
        rules: [{ label: entry.name, filter: null, symbol: entry.symbol }],
      }
      const { sld } = sldForLayer(single)
      expect(() => parseXml(sld)).not.toThrow()
    }
  })
})

describe('SLD reader', () => {
  it('reads back exactly what PGMaps wrote, literal types included', () => {
    for (const original of FIXTURE_DOCUMENT.layers) {
      const read = readSld(sldForLayer(original).sld)
      expect(read.diagnostics.filter((d) => d.severity !== 'info')).toEqual([])
      expect(read.layers).toEqual([original])
    }
  })

  it('reads every catalogue symbol back exactly', () => {
    for (const entry of catalogueSymbolLibrary().symbols) {
      const geometry = entry.symbol.kind === 'line' ? 'line' : entry.symbol.kind === 'point' ? 'point' : 'polygon'
      const single: StyledLayer = {
        id: 'x',
        name: entry.name,
        geometry,
        fields: [],
        rules: [{ label: entry.name, filter: null, symbol: entry.symbol }],
      }
      expect(readSld(sldForLayer(single).sld).layers[0]).toEqual(single)
    }
  })

  it('reads the XML alone when the PGMaps comment is gone, within stated tolerances', () => {
    // Tolerances: sizes to 0.001 pt (pixel conversion rounding), colours exact, rule order and
    // filters exact (numbers typed from range use), class symbols come back as areas.
    for (const original of FIXTURE_DOCUMENT.layers) {
      const read = readSld(stripped(sldForLayer(original).sld))
      expect(read.layers).toHaveLength(1)
      const back = read.layers[0]
      expect(back.id).toBe(original.id)
      expect(back.name).toBe(original.name)
      expect(back.geometry).toBe(original.geometry)
      expect(back.rules.map((r) => r.label)).toEqual(original.rules.map((r) => r.label))
      expect(back.rules.map((r) => r.filter)).toEqual(original.rules.map((r) => r.filter))
      expect(back.label).toEqual(original.label)
      back.rules.forEach((rule, i) =>
        expect(rule.symbol).toEqual({ ...original.rules[i].symbol, label: original.rules[i].label }),
      )
    }
  })

  it('treats a comment that no longer matches the XML as absent', () => {
    const sld = sldForLayer(layer('road_points')).sld.replace(
      '<se:Title>Proposed culvert</se:Title>',
      '<se:Title>Culvert (edited)</se:Title>',
    )
    const read = readSld(sld)
    expect(read.diagnostics.some((d) => /edited/.test(d.message))).toBe(true)
    expect(read.layers[0].rules[0].label).toBe('Culvert (edited)')
    expect(read.layers[0].rules[0].symbol).toMatchObject({ kind: 'point', icon: 'culvert', color: '#e60000' })
  })

  it('reads a hand-written SLD conservatively, reporting what it cannot carry', () => {
    const xml = `<?xml version="1.0"?>
<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc">
  <NamedLayer><Name>roads</Name><UserStyle><Title>Roads</Title><FeatureTypeStyle>
    <Rule><Name>Paved</Name><ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>SURF</ogc:PropertyName><ogc:Literal>paved</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter>
      <LineSymbolizer><Stroke><CssParameter name="stroke">#333333</CssParameter><CssParameter name="stroke-width">2</CssParameter></Stroke></LineSymbolizer></Rule>
    <Rule><Name>Wide</Name><ogc:Filter><ogc:PropertyIsGreaterThan><ogc:PropertyName>LANES</ogc:PropertyName><ogc:Literal>2</ogc:Literal></ogc:PropertyIsGreaterThan></ogc:Filter>
      <MaxScaleDenominator>50000</MaxScaleDenominator>
      <LineSymbolizer><Stroke><CssParameter name="stroke">#ff0000</CssParameter></Stroke></LineSymbolizer></Rule>
    <Rule><Name>Like</Name><ogc:Filter><ogc:PropertyIsLike wildCard="*" singleChar="." escape="!"><ogc:PropertyName>N</ogc:PropertyName><ogc:Literal>A*</ogc:Literal></ogc:PropertyIsLike></ogc:Filter>
      <LineSymbolizer><Stroke/></LineSymbolizer></Rule>
    <Rule><Name>Icon</Name><PointSymbolizer><Graphic><ExternalGraphic><OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="icons/x.png"/><Format>image/png</Format></ExternalGraphic></Graphic></PointSymbolizer></Rule>
  </FeatureTypeStyle></UserStyle></NamedLayer>
</StyledLayerDescriptor>`
    const read = readSld(xml)
    const roads = read.layers[0]
    expect(roads).toMatchObject({ id: 'roads', name: 'Roads', geometry: 'line' })
    expect(roads.rules.map((r) => r.filter)).toEqual([
      { field: 'SURF', op: 'eq', value: 'paved' },
      { field: 'LANES', op: 'range', min: 2 },
    ])
    expect(roads.fields).toEqual([
      { name: 'SURF', type: 'string' },
      { name: 'LANES', type: 'number' },
    ])
    const messages = read.diagnostics.map((d) => `${d.severity}: ${d.message}`).join('\n')
    expect(messages).toMatch(/warning: "> 2" is read as "≥ 2"/)
    expect(messages).toMatch(/warning: The rule draws only at some scales/)
    expect(messages).toMatch(/error: ogc:PropertyIsLike filters are not read/)
    expect(messages).toMatch(/error: A point symbol on a line layer is not read/)
    expect(messages).toMatch(/error: The symbol is an image outside the file/)
  })

  it('refuses entity declarations and reports a wrong root', () => {
    expect(readSld('<!DOCTYPE x [<!ENTITY a "b">]><x/>').diagnostics[0].severity).toBe('error')
    expect(readSld('<qgis/>').diagnostics[0].message).toMatch(/not StyledLayerDescriptor/)
  })
})
