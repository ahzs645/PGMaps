import { describe, expect, it } from 'vitest'
import { catalogueSymbolLibrary } from '@/lib/forestry/blockSheet/symbolLibrary'
import type { AreaSymbol } from '@/lib/mapSheet/symbols'
import { FIXTURE_DATA, FIXTURE_DOCUMENT, FIXTURE_LAYOUT, FIXTURE_LIBRARY } from '../fixtures'
import type { StyleDocument } from '../model'
import {
  geolibreLayerStyles,
  geolibreProject,
  geolibreStyleLibrary,
  patternFromSvg,
  patternTileSvg,
  readGeolibreFile,
  type GeolibreRule,
} from './geolibre'

const project = () =>
  JSON.parse(geolibreProject(FIXTURE_DOCUMENT, FIXTURE_DATA, { layout: FIXTURE_LAYOUT }).files[0].content as string)
const areas = FIXTURE_DOCUMENT.layers[0]
const points = FIXTURE_DOCUMENT.layers[3]
/** One pattern and one icon per layer: what GeoLibre carries whole. */
const UNIFORM: StyleDocument = {
  ...FIXTURE_DOCUMENT,
  name: 'Uniform',
  layers: [
    { ...areas, rules: [areas.rules[1], { ...areas.rules[1], label: 'Else', filter: null }] },
    { ...points, rules: [points.rules[0], { ...points.rules[0], label: 'Else', filter: null }] },
  ],
}

describe('GeoLibre project', () => {
  it('writes a .geolibre project with GeoJSON inline and rule-based styles', () => {
    const { files } = geolibreProject(FIXTURE_DOCUMENT, FIXTURE_DATA, { layout: FIXTURE_LAYOUT })
    expect(files[0].path).toBe('Fixture-road-project.geolibre')
    const json = JSON.parse(files[0].content as string)
    expect(json.version).toBe('0.2.0')
    expect(json.layers.map((l: { id: string }) => l.id)).toEqual(FIXTURE_DOCUMENT.layers.map((l) => l.id))
    expect(json.layers[2].geojson.features).toHaveLength(4)
    expect(json.layers[2].style.vectorStyleMode).toBe('rule-based')
    expect(json.printLayout).toMatchObject({
      title: 'Fixture road project',
      paperSize: 'tabloid',
      orientation: 'landscape',
    })
  })

  it("writes rule filters as typed MapLibre JSON, Spur B's included, in first-match order", () => {
    const rules = project().layers[2].style.vectorRules as GeolibreRule[]
    expect(rules.map((r) => r.filter)).toEqual([
      '["==",["get","NAME"],"Main line"]',
      '["in",["get","NAME"],["literal",["Spur A","Spur B\'s"]]]',
      '["all",["==",["typeof",["get","MAXGRADE"]],"number"],[">=",["get","MAXGRADE"],12]]',
      '',
    ])
    expect(rules.at(-1)).toMatchObject({ isElse: true, color: '#ff0000' })
  })

  it('hides features no rule matches with a switched-off else rule', () => {
    const doc: StyleDocument = { ...FIXTURE_DOCUMENT, layers: [{ ...areas, rules: areas.rules.slice(0, 2) }] }
    const json = JSON.parse(geolibreProject(doc, FIXTURE_DATA).files[0].content as string)
    expect(json.layers[0].style.vectorRules.at(-1)).toMatchObject({ isElse: true, enabled: false })
    expect(readGeolibreFile('x.geolibre', JSON.stringify(json)).layers[0].rules).toHaveLength(2)
  })

  it('reports what GeoLibre cannot carry', () => {
    const { diagnostics } = geolibreProject(FIXTURE_DOCUMENT, FIXTURE_DATA)
    const messages = diagnostics.map((d) => d.message).join('\n')
    expect(messages).toMatch(/more stroke \(casing or centre line\) not carried/)
    expect(messages).toMatch(/different fill patterns/)
    expect(messages).toMatch(/different point icons/)
    expect(messages).toMatch(/Line offsets are not carried/)
  })

  it('reads the project back: filters, labels and main strokes exact; the rest as reported', () => {
    // Tolerances: widths to 0.001 pt; a line keeps only its main stroke; an area keeps one outline
    // and, without a shared pattern, its key colour; points without a shared icon come back as dots.
    const read = readGeolibreFile('Fixture-road-project.geolibre', JSON.stringify(project()))
    expect(read.layers.map((l) => [l.name, l.geometry])).toEqual(
      FIXTURE_DOCUMENT.layers.map((l) => [l.name, l.geometry]),
    )
    read.layers.forEach((layer, i) => {
      const original = FIXTURE_DOCUMENT.layers[i]
      expect(layer.rules.map((r) => r.filter)).toEqual(original.rules.map((r) => r.filter))
      expect(layer.rules.map((r) => r.label)).toEqual(original.rules.map((r) => r.label))
    })
    expect(read.layers[2].label).toEqual(FIXTURE_DOCUMENT.layers[2].label)
    expect(read.layers[2].fields).toEqual(FIXTURE_DOCUMENT.layers[2].fields)
    expect(read.layers[2].rules[0].symbol).toEqual({
      kind: 'line',
      label: 'Main line',
      layers: [{ color: '#d97706', width: 2.5 }],
    })
    expect(read.layers[3].rules[0].symbol).toMatchObject({ kind: 'point', icon: 'dot', color: '#e60000' })
  })

  it('carries one fill pattern and one icon per layer exactly', () => {
    const json = JSON.parse(geolibreProject(UNIFORM, FIXTURE_DATA).files[0].content as string)
    expect(json.layers[0].style).toMatchObject({ fillPattern: 'svg' })
    expect(json.layers[1].style).toMatchObject({ markerEnabled: true, markerShape: 'custom' })
    const read = readGeolibreFile('Uniform.geolibre', JSON.stringify(json))
    const riparian = areas.rules[1].symbol as AreaSymbol
    expect(read.layers[0].rules[0].symbol).toMatchObject({ hatches: riparian.hatches })
    expect(read.layers[1].rules[0].symbol).toMatchObject({ kind: 'point', icon: 'culvert', size: 9, color: '#e60000' })
  })
})

describe('GeoLibre URL styles', () => {
  it('writes one compact MapLibre style per layer, sourced from the data stem with no features', () => {
    const { files } = geolibreLayerStyles(FIXTURE_DOCUMENT)
    expect(files.map((f) => f.path)).toEqual(FIXTURE_DOCUMENT.layers.map((l) => `${l.id}.geolibre.style.json`))
    const style = JSON.parse(files[2].content as string)
    expect(Object.keys(style.sources)).toEqual(['road_centrelines'])
    expect(style.sources.road_centrelines.data.features).toEqual([])
    expect(style.layers.map((l: { id: string }) => l.id)).toEqual(['road-centrelines-line', 'road-centrelines-label'])
  })

  it('reads a URL style back to the same rules', () => {
    const { files } = geolibreLayerStyles(FIXTURE_DOCUMENT)
    files.forEach((file, i) => {
      const read = readGeolibreFile(file.path, file.content as string)
      expect(read.format).toBe('geolibre')
      expect(read.layers[0].rules.map((r) => r.filter)).toEqual(FIXTURE_DOCUMENT.layers[i].rules.map((r) => r.filter))
    })
    const uniform = geolibreLayerStyles(UNIFORM).files[0]
    const read = readGeolibreFile(uniform.path, uniform.content as string)
    expect(read.layers[0].rules[0].symbol).toMatchObject({ hatches: (areas.rules[1].symbol as AreaSymbol).hatches })
  })
})

describe('GeoLibre Style Manager bundle', () => {
  it('writes every catalogue symbol and reads each back with its geometry', () => {
    const library = catalogueSymbolLibrary()
    const { files } = geolibreStyleLibrary(library)
    const bundle = JSON.parse(files[0].content as string)
    expect(bundle).toMatchObject({ type: 'geolibre-style-library', version: 1 })
    expect(bundle.entries).toHaveLength(library.symbols.length)
    const read = readGeolibreFile(files[0].path, files[0].content as string)
    expect(read.symbols.map((s) => s.id)).toEqual(library.symbols.map((s) => s.id))
    read.symbols.forEach((symbol, i) => {
      const kind = library.symbols[i].symbol.kind
      expect(symbol.symbol.kind).toBe(kind === 'class' ? 'area' : kind)
    })
  })

  it('keeps hatches and icons of library symbols exactly', () => {
    const { files } = geolibreStyleLibrary(FIXTURE_LIBRARY)
    const read = readGeolibreFile(files[0].path, files[0].content as string)
    FIXTURE_LIBRARY.symbols.forEach((entry, i) => {
      const symbol = entry.symbol
      if (symbol.kind === 'area' && symbol.markerFill)
        expect(read.symbols[i].symbol).toMatchObject({ markerFill: symbol.markerFill })
      if (symbol.kind === 'point')
        expect(read.symbols[i].symbol).toMatchObject({ icon: symbol.icon, color: symbol.color })
    })
  })
})

describe('pattern tiles', () => {
  it('describe themselves, so a reader restores the hatch exactly', () => {
    const symbol = areas.rules[0].symbol as AreaSymbol
    const svg = patternTileSvg(symbol)!
    expect(svg).toContain('<svg data-pgmaps-pattern=')
    expect(patternFromSvg(svg)).toEqual({ hatches: symbol.hatches })
    expect(patternFromSvg('<svg/>')).toBeNull()
  })

  it('reports a file that is no GeoLibre file', () => {
    expect(readGeolibreFile('x.json', '{"hello":1}').diagnostics[0].severity).toBe('error')
    expect(readGeolibreFile('x.json', 'nope').diagnostics[0].severity).toBe('error')
  })
})
