import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { catalogueSymbolLibrary } from '@/lib/forestry/blockSheet/symbolLibrary'
import { checkedSheetSymbol } from '../checkedSymbol'
import { FIXTURE_DATA, FIXTURE_DOCUMENT, FIXTURE_LAYOUT, FIXTURE_LIBRARY } from '../fixtures'
import { documentProblems, ruleFor, type StyledLayer } from '../model'
import { canonicalSymbol } from './compare'
import { exclusiveExpressions, qgisRuleMatches } from './expression'
import { qgisLayerStyles, qmlForLayer, rendererKind } from './qml'
import { qgisLayoutTemplate, qgisProject } from './qgisProject'
import { qgisStyleLibraryXml } from './qgisStyleLibrary'
import { readQgisFile } from './read'

const layer = (id: string) => FIXTURE_DOCUMENT.layers.find((l) => l.id === id)!
const text = (content: string | Uint8Array) =>
  typeof content === 'string' ? content : new TextDecoder().decode(content)

/** A layer as compared after a round trip: field kinds are not stored by QGIS styles. */
const canonicalLayer = (l: StyledLayer) => ({
  geometry: l.geometry,
  rules: l.rules.map((rule) => ({ label: rule.label, filter: rule.filter, symbol: canonicalSymbol(rule.symbol) })),
  label: l.label ?? null,
})

describe('QGIS layer styles', () => {
  it('chooses single, categorized or rule-based renderers by the rules', () => {
    expect(rendererKind(layer('context_areas'))).toBe('categorizedSymbol')
    expect(rendererKind(layer('road_points'))).toBe('categorizedSymbol')
    expect(rendererKind(layer('road_centrelines'))).toBe('RuleRenderer')
    expect(rendererKind({ ...layer('road_points'), rules: [layer('road_points').rules[2]] })).toBe('singleSymbol')
  })

  it('names each style after its layer so QGIS loads it beside the shapefile', () => {
    const { files } = qgisLayerStyles(FIXTURE_DOCUMENT)
    expect(files.map((f) => f.path)).toEqual(FIXTURE_DOCUMENT.layers.map((l) => `${l.id}.qml`))
    expect(text(files[0].content)).toMatch(/^<!DOCTYPE qgis/)
  })

  it.each(FIXTURE_DOCUMENT.layers.map((l) => [l.id, l] as const))('reads %s back as written', (_id, original) => {
    const { qml } = qmlForLayer(original)
    const read = readQgisFile(`${original.id}.qml`, qml)
    expect(read.format).toBe('qml')
    expect(read.diagnostics.filter((d) => d.severity !== 'info')).toEqual([])
    expect(read.layers).toHaveLength(1)
    expect(read.layers[0].id).toBe(original.id)
    expect(canonicalLayer(read.layers[0])).toEqual(canonicalLayer(original))
    expect(documentProblems({ ...FIXTURE_DOCUMENT, layers: read.layers })).toEqual([])
  })

  it('gives rule-based filters that never both match, and match the rule PGMaps draws', () => {
    const roads = layer('road_centrelines')
    const expressions = exclusiveExpressions(roads.rules)
    const samples: Record<string, unknown>[] = [
      ...FIXTURE_DATA.road_centrelines.features.map((f) => f.properties!),
      { NAME: 'Main line', MAXGRADE: 20 },
      { NAME: "Spur B's", MAXGRADE: 13 },
      { NAME: 'Spur A', MAXGRADE: null },
      { NAME: null, MAXGRADE: 15 },
      { NAME: null, MAXGRADE: null },
      { NAME: 'x', MAXGRADE: 12 },
      { NAME: 'x', MAXGRADE: 11.999 },
    ]
    for (const properties of samples) {
      const matches = expressions
        .map((expression, i) => (expression === 'ELSE' ? null : qgisRuleMatches(expression, properties) ? i : null))
        .filter((i): i is number => i !== null)
      const drawn = matches.length ? matches : [expressions.indexOf('ELSE')]
      expect(drawn).toHaveLength(1)
      expect(roads.rules[drawn[0]]).toBe(ruleFor(roads, properties))
    }
  })

  it("quotes field names and doubles single quotes in Spur B's", () => {
    const expressions = exclusiveExpressions(layer('road_centrelines').rules)
    expect(expressions[1]).toContain(`"NAME" IN ('Spur A', 'Spur B''s')`)
    const { qml } = qmlForLayer(layer('road_centrelines'))
    expect(qml).toContain('&quot;NAME&quot; IN (&apos;Spur A&apos;, &apos;Spur B&apos;&apos;s&apos;)')
    const read = readQgisFile('road_centrelines.qml', qml).layers[0]
    expect(read.rules[1].filter).toEqual({ field: 'NAME', op: 'in', values: ['Spur A', "Spur B's"] })
  })
})

describe('QGIS style library', () => {
  it('writes and reads back every catalogue symbol', () => {
    const library = catalogueSymbolLibrary()
    const { files } = qgisStyleLibraryXml(library)
    const xml = text(files[0].content)
    expect(xml).toContain('<qgis_style version="2">')
    const read = readQgisFile(files[0].path, xml)
    expect(read.format).toBe('qgis-style')
    expect(read.diagnostics.filter((d) => d.severity !== 'info')).toEqual([])
    expect(read.symbols.map((s) => s.id)).toEqual(library.symbols.map((s) => s.id))
    read.symbols.forEach((entry, i) => {
      const original = library.symbols[i]
      expect(entry.symbol.kind, original.id).toBe(original.symbol.kind)
      expect(canonicalSymbol(entry.symbol), original.id).toEqual(canonicalSymbol(original.symbol))
      expect(entry.name).toBe(original.name)
      expect(entry.category).toBe(original.category)
      expect(entry.tags).toEqual(original.tags.filter((tag) => tag !== original.category))
      expect(() => checkedSheetSymbol(entry.symbol), original.id).not.toThrow()
    })
  })

  it('keeps names unique for Style Manager', () => {
    const twice = {
      ...FIXTURE_LIBRARY,
      symbols: [...FIXTURE_LIBRARY.symbols, { ...FIXTURE_LIBRARY.symbols[0], id: 'copy' }],
    }
    const xml = text(qgisStyleLibraryXml(twice).files[0].content)
    const names = [...xml.matchAll(/<symbol [^>]*name="([^"]*)"[^>]*tags=/g)].map((m) => m[1])
    expect(new Set(names).size).toBe(names.length)
    expect(readQgisFile('lib.xml', xml).symbols.map((s) => s.id)).toEqual([
      ...FIXTURE_LIBRARY.symbols.map((s) => s.id),
      'copy',
    ])
  })
})

describe('QGIS project and layout', () => {
  it('writes a .qgz whose layers, order, visibility and layout read back', () => {
    const doc = {
      ...FIXTURE_DOCUMENT,
      layers: FIXTURE_DOCUMENT.layers.map((l, i) => (i === 0 ? { ...l, hidden: true } : l)),
    }
    const { files, diagnostics } = qgisProject(doc, { layouts: [FIXTURE_LAYOUT] })
    expect(diagnostics.filter((d) => d.severity !== 'info')).toEqual([])
    expect(files[0].path).toBe('Fixture-road-project.qgz')
    const inside = unzipSync(files[0].content as Uint8Array)
    const qgs = new TextDecoder().decode(inside['Fixture-road-project.qgs'])
    expect(qgs).toContain('<datasource>./data/road_points.shp</datasource>')
    expect(qgs).toContain('<authid>EPSG:3005</authid>')
    // The tree lists the top layer (drawn last) first.
    const treeIds = [...qgs.matchAll(/<layer-tree-layer id="([^"]+)"/g)].map((m) => m[1])
    expect(treeIds).toEqual([...doc.layers].reverse().map((l) => l.id))
    const read = readQgisFile(files[0].path, files[0].content)
    expect(read.format).toBe('qgs')
    expect(read.diagnostics.filter((d) => d.severity !== 'info')).toEqual([])
    expect(read.layers.map((l) => l.id)).toEqual(doc.layers.map((l) => l.id))
    expect(read.layers.map((l) => l.name)).toEqual(doc.layers.map((l) => l.name))
    expect(read.layers.map((l) => Boolean(l.hidden))).toEqual([true, false, false, false])
    read.layers.forEach((l, i) => expect(canonicalLayer(l)).toEqual(canonicalLayer(doc.layers[i])))
    expect(read.layouts).toHaveLength(1)
    expect(read.layouts[0]).toEqual(FIXTURE_LAYOUT)
  })

  it('writes a .qpt on tabloid paper that reads back as the same template', () => {
    const { files } = qgisLayoutTemplate(FIXTURE_LAYOUT, FIXTURE_DOCUMENT)
    expect(files[0].path).toBe('Field-layout.qpt')
    const xml = text(files[0].content)
    expect(xml).toContain('size="431.8,279.4,mm"')
    for (const id of [
      'map',
      'title',
      'subtitle',
      'legend',
      'scalebar',
      'north_arrow',
      'panel:blockInfo',
      'panel-title:roadTable',
    ])
      expect(xml).toContain(`id="${id}"`)
    const read = readQgisFile(files[0].path, xml)
    expect(read.diagnostics.filter((d) => d.severity !== 'info')).toEqual([])
    expect(read.layouts[0].template).toBe(FIXTURE_LAYOUT.template)
    expect(read.layouts[0]).toEqual(FIXTURE_LAYOUT)
  })

  it('measures extent and scale from the map item once it has moved', () => {
    const xml = text(qgisLayoutTemplate(FIXTURE_LAYOUT, FIXTURE_DOCUMENT).files[0].content)
    const moved = xml.replace(/<Extent xmin="([\d.-]+)"/, (_m, x: string) => `<Extent xmin="${Number(x) - 1}"`)
    const read = readQgisFile('moved.qpt', moved).layouts[0]
    expect(read.scale).toBeGreaterThan(9990)
    expect(read.scale).toBeLessThan(10010)
    expect(read.extent![0]).toBeLessThan(FIXTURE_LAYOUT.extent![0])
  })
})
