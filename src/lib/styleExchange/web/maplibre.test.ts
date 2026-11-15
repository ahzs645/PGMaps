import { describe, expect, it } from 'vitest'
import { catalogueSymbolLibrary } from '@/lib/forestry/blockSheet/symbolLibrary'
import { encodePng } from '@/lib/mapSheet/png'
import { FIXTURE_DATA, FIXTURE_DOCUMENT } from '../fixtures'
import { filterMatches, ruleFor, STYLE_EXCHANGE_SCHEMA, type StyleDocument, type StyledLayer } from '../model'
import {
  exclusiveFilter,
  filterExpression,
  MAPLIBRE_METADATA_KEY,
  maplibreStyle,
  packSprite,
  readMaplibreStyle,
} from './maplibre'

const GLYPHS = 'https://example.org/fonts/{fontstack}/{range}.pbf'
const write = (doc: StyleDocument = FIXTURE_DOCUMENT) => maplibreStyle(doc, FIXTURE_DATA, { encodePng, glyphs: GLYPHS })
const styleOf = async (doc?: StyleDocument) => JSON.parse((await write(doc)).files[0].content as string)

/** A tiny evaluator for the expressions the writer emits, to check first-match exclusivity. */
function evaluate(expr: unknown, props: Record<string, unknown>): unknown {
  if (!Array.isArray(expr)) return expr
  const [op, ...args] = expr
  const v = (i: number) => evaluate(args[i], props)
  switch (op) {
    case 'get':
      return props[args[0] as string] ?? null
    case 'literal':
      return args[0]
    case 'typeof':
      return typeof v(0) === 'number' ? 'number' : 'other'
    case '==':
      return v(0) === v(1)
    case '>=':
      return (v(0) as number) >= (v(1) as number)
    case '<':
      return (v(0) as number) < (v(1) as number)
    case 'in':
      return (v(1) as unknown[]).includes(v(0))
    case 'all':
      return args.every((a) => evaluate(a, props) === true)
    case 'any':
      return args.some((a) => evaluate(a, props) === true)
    case '!':
      return !v(0)
    default:
      throw Error(`unexpected ${String(op)}`)
  }
}

describe('MapLibre writer', () => {
  it('writes style.json with inline GeoJSON sources and a sprite at 1x and 2x', async () => {
    const { files } = await write()
    expect(files.map((f) => f.path)).toEqual([
      'style.json',
      'sprite.json',
      'sprite.png',
      'sprite@2x.json',
      'sprite@2x.png',
    ])
    const style = JSON.parse(files[0].content as string)
    expect(style.version).toBe(8)
    expect(Object.keys(style.sources)).toEqual(FIXTURE_DOCUMENT.layers.map((l) => l.id))
    expect(style.sources.road_points.data.features).toHaveLength(3)
    const sprite = JSON.parse(files[1].content as string)
    const sprite2 = JSON.parse(files[3].content as string)
    expect(Object.keys(sprite).sort()).toEqual(Object.keys(sprite2).sort())
    const icons = style.layers.flatMap((l: { layout?: Record<string, unknown> }) =>
      [l.layout?.['icon-image']].filter(Boolean),
    )
    for (const id of icons) expect(sprite[id as string]).toBeDefined()
    const png = files[2].content as Uint8Array
    expect([...png.slice(1, 4)].map((c) => String.fromCharCode(c)).join('')).toBe('PNG')
  })

  it('keeps first-match meaning: each fixture feature draws exactly its own rule', async () => {
    const style = await styleOf()
    for (const layer of FIXTURE_DOCUMENT.layers) {
      for (const feature of FIXTURE_DATA[layer.id].features) {
        const expected = layer.rules.indexOf(ruleFor(layer, feature.properties!)!)
        const drawn = new Set(
          style.layers
            .filter(
              (l: { source: string; id: string; filter?: unknown }) =>
                l.source === layer.id && !l.id.endsWith('-label'),
            )
            .filter(
              (l: { filter?: unknown }) => l.filter === undefined || evaluate(l.filter, feature.properties!) === true,
            )
            .map((l: { id: string }) => Number(/-r(\d+)-/.exec(l.id)![1])),
        )
        expect([...drawn]).toEqual([expected])
      }
    }
  })

  it("types literals: Spur B's stays text, a range checks for a number first", () => {
    expect(filterExpression({ field: 'NAME', op: 'in', values: ['Spur A', "Spur B's"] })).toEqual([
      'in',
      ['get', 'NAME'],
      ['literal', ['Spur A', "Spur B's"]],
    ])
    const range = filterExpression({ field: 'MAXGRADE', op: 'range', min: 12 })
    expect(evaluate(range, { MAXGRADE: '14' })).toBe(false)
    expect(evaluate(range, { MAXGRADE: 14 })).toBe(true)
    // A feature with no value is not steep, so the else rule still draws it.
    const otherwise = exclusiveFilter(null, [{ field: 'MAXGRADE', op: 'range', min: 12 }])
    expect(evaluate(otherwise, {})).toBe(true)
    expect(filterMatches({ field: 'MAXGRADE', op: 'range', min: 12 }, {})).toBe(false)
  })

  it('leaves labels out without a glyph server, and says so', async () => {
    const { files, diagnostics } = await maplibreStyle(FIXTURE_DOCUMENT, FIXTURE_DATA, { encodePng })
    const style = JSON.parse(files[0].content as string)
    expect(style.layers.some((l: { id: string }) => l.id.endsWith('-label'))).toBe(false)
    expect(diagnostics.some((d) => /glyph/.test(d.message))).toBe(true)
    expect(style.sprite).toBe('./sprite')
    expect(diagnostics.some((d) => /absolute sprite URL/.test(d.message))).toBe(true)
  })

  it('writes every catalogue symbol without throwing', async () => {
    const library = catalogueSymbolLibrary()
    const doc: StyleDocument = {
      schema: STYLE_EXCHANGE_SCHEMA,
      name: 'catalogue',
      layers: library.symbols.map((entry, i) => ({
        id: `s${i}`,
        name: entry.name,
        geometry: entry.symbol.kind === 'line' ? 'line' : entry.symbol.kind === 'point' ? 'point' : 'polygon',
        fields: [],
        rules: [{ label: entry.name, filter: null, symbol: entry.symbol }],
      })),
    }
    const { files } = await maplibreStyle(doc, {}, { encodePng, spriteUrl: 'https://example.org/sprite' })
    expect(JSON.parse(files[0].content as string).sprite).toBe('https://example.org/sprite')
    const read = readMaplibreStyle(files[0].content as string)
    expect(read.layers).toEqual(doc.layers)
  })

  it('packs sprite images without overlap', () => {
    const image = (id: string, w: number, h: number) => ({
      id,
      pixelRatio: 1,
      image: { width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255) },
    })
    const sheet = packSprite([image('a', 10, 20), image('b', 30, 5), image('c', 7, 7)])
    const boxes = Object.values(sheet.json)
    for (const a of boxes)
      for (const b of boxes)
        if (a !== b)
          expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(
            true,
          )
    expect(Math.max(...boxes.map((b) => b.x + b.width))).toBeLessThanOrEqual(sheet.width)
  })
})

describe('MapLibre reader', () => {
  it('reads back exactly what PGMaps wrote', async () => {
    const read = readMaplibreStyle((await write()).files[0].content as string)
    expect(read.layers).toEqual(FIXTURE_DOCUMENT.layers)
  })

  it('reads the style layers alone when the PGMaps metadata is gone, within stated tolerances', async () => {
    // Tolerances: widths and sizes to 0.001 pt; icons from the sprite are dots (error diagnostic);
    // hatch and marker-fill patterns are errors (their tiles are sprite images); inside casings
    // come back centred on the edge; else rules and filters are exact.
    const style = await styleOf()
    for (const layer of style.layers) delete layer.metadata
    const read = readMaplibreStyle(JSON.stringify(style))
    const byId = (id: string) => read.layers.find((l) => l.id === id)!
    const lines = byId('road_centrelines')
    const original = FIXTURE_DOCUMENT.layers.find((l) => l.id === 'road_centrelines')!
    expect(lines.rules.map((r) => r.filter)).toEqual(original.rules.map((r) => r.filter))
    lines.rules.forEach((rule, i) => {
      const symbol = original.rules[i].symbol as Extract<StyledLayer['rules'][number]['symbol'], { kind: 'line' }>
      expect(rule.symbol).toEqual({ ...symbol, label: rule.label })
    })
    expect(lines.label).toEqual(original.label)
    expect(lines.fields).toEqual(original.fields)
    const areas = byId('context_areas')
    expect(areas.rules.map((r) => r.filter)).toEqual(FIXTURE_DOCUMENT.layers[0].rules.map((r) => r.filter))
    expect(read.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/fill pattern from the sprite/),
        expect.stringMatching(/comes from the style's sprite/),
      ]),
    )
  })

  it('reads a foreign style: legacy and expression filters, case colours, zoom functions', () => {
    const style = {
      version: 8,
      sources: { osm: { type: 'vector', url: 'https://example.org/tiles.json' } },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#fff' } },
        {
          id: 'water',
          type: 'fill',
          source: 'osm',
          'source-layer': 'water',
          paint: { 'fill-color': 'rgb(170, 211, 223)' },
        },
        {
          id: 'roads-major',
          type: 'line',
          source: 'osm',
          'source-layer': 'transportation',
          filter: ['all', ['==', '$type', 'LineString'], ['in', 'class', 'primary', 'trunk']],
          paint: {
            'line-color': '#f00',
            'line-width': {
              stops: [
                [10, 1],
                [16, 4],
              ],
            },
          },
        },
        {
          id: 'roads-minor',
          type: 'line',
          source: 'osm',
          'source-layer': 'transportation',
          filter: ['==', ['get', 'class'], 'minor'],
          minzoom: 12,
          paint: { 'line-color': '#888', 'line-width': 1.5, 'line-dasharray': [2, 1] },
        },
        {
          id: 'parks',
          type: 'fill',
          source: 'osm',
          'source-layer': 'park',
          paint: {
            'fill-color': ['case', ['==', ['get', 'kind'], 'np'], '#0a0', ['>=', ['get', 'area'], 5], '#6c6', '#cfc'],
          },
        },
        {
          id: 'names',
          type: 'symbol',
          source: 'osm',
          'source-layer': 'park',
          layout: { 'text-field': '{name}', 'text-size': 12 },
        },
        {
          id: 'weird',
          type: 'line',
          source: 'osm',
          'source-layer': 'boundary',
          filter: ['!=', ['get', 'admin'], 2],
          paint: {},
        },
      ],
    }
    const read = readMaplibreStyle(JSON.stringify(style))
    expect(read.layers.map((l) => [l.name, l.geometry, l.rules.length])).toEqual([
      ['water', 'polygon', 1],
      ['transportation', 'line', 2],
      ['park', 'polygon', 3],
    ])
    const roads = read.layers[1]
    expect(roads.rules[0].filter).toEqual({ field: 'class', op: 'in', values: ['primary', 'trunk'] })
    expect(roads.rules[1].symbol).toMatchObject({
      kind: 'line',
      layers: [{ color: '#888888', dash: [2 * 1.125, 1.125] }],
    })
    const parks = read.layers[2]
    expect(parks.rules.map((r) => r.filter)).toEqual([
      { field: 'kind', op: 'eq', value: 'np' },
      { field: 'area', op: 'range', min: 5 },
      null,
    ])
    expect(parks.label).toMatchObject({ field: 'name', placement: 'point' })
    const messages = read.diagnostics.map((d) => `${d.severity}: ${d.message}`).join('\n')
    expect(messages).toMatch(/info: The background layer "bg" is not read/)
    expect(messages).toMatch(/warning: The line width changes with zoom; it is read at zoom 14/)
    expect(messages).toMatch(/warning: The layer draws only at some zooms/)
    expect(messages).toMatch(/error: The "!=" filter has no PGMaps rule equivalent/)
    expect(MAPLIBRE_METADATA_KEY).toBe('pgmaps:style-exchange')
  })
})
