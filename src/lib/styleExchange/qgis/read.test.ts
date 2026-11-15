/**
 * The reader on files QGIS 4.3 wrote itself. `testdata/saved-*` are QGIS's own saves of our fixture
 * export (`saveNamedStyle`, `saveAsTemplate`, `QgsStyle.exportXml`, from
 * `scripts/style-exchange/qgis-check.py`); `testdata/native-*` are styles built with the PyQGIS API
 * (brush hatches, a hash line, a foreign SVG, a font marker, graduated classes, list categories).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkedSheetSymbol } from '../checkedSymbol'
import { FIXTURE_DOCUMENT, FIXTURE_LAYOUT, FIXTURE_LIBRARY } from '../fixtures'
import { canonicalSymbol } from './compare'
import { readQgisFile } from './read'

const sample = (name: string) => readFileSync(path.join(import.meta.dirname, 'testdata', name))
const read = (name: string) => readQgisFile(name.replace(/^(saved|native)-/, ''), sample(name))

describe('reading files QGIS wrote', () => {
  it.each(['road_centrelines', 'road_points', 'context_areas', 'context_lines'])(
    'reads QGIS’s own save of %s as the original',
    (id) => {
      const result = read(`saved-${id}.qml`)
      expect(result.diagnostics.filter((d) => d.severity !== 'info')).toEqual([])
      const original = FIXTURE_DOCUMENT.layers.find((l) => l.id === id)!
      const layer = result.layers[0]
      expect(layer.rules.map((r) => [r.label, r.filter, canonicalSymbol(r.symbol)])).toEqual(
        original.rules.map((r) => [r.label, r.filter, canonicalSymbol(r.symbol)]),
      )
      expect(layer.label).toEqual(original.label)
    },
  )

  it('reads QGIS’s save of the layout template as the fixture layout', () => {
    const result = read('saved-layout.qpt')
    expect(result.layouts).toEqual([FIXTURE_LAYOUT])
  })

  it('reads a style library QGIS exported, whatever its order', () => {
    const result = read('saved-library.xml')
    expect(result.diagnostics.filter((d) => d.severity !== 'info')).toEqual([])
    const byId = new Map(result.symbols.map((s) => [s.id, s]))
    for (const entry of FIXTURE_LIBRARY.symbols)
      expect(canonicalSymbol(byId.get(entry.id)!.symbol)).toEqual(canonicalSymbol(entry.symbol))
  })

  it('reads brush hatches, pattern fills, list categories and the else category', () => {
    const result = read('native-fill_cat.qml')
    const [a, bc, other] = result.layers[0].rules
    expect(a.filter).toEqual({ field: 'KEY', op: 'eq', value: 'a' })
    expect(bc.filter).toEqual({ field: 'KEY', op: 'in', values: ['b', 'c'] })
    expect(other.filter).toBeNull()
    expect(a.symbol.kind).toBe('area')
    if (a.symbol.kind !== 'area') return
    expect(a.symbol.hatches?.map((h) => h.angleDeg)).toEqual([45, 30])
    expect(a.symbol.hatches?.[1]).toMatchObject({ spacing: 6, phase: 2 })
    expect(a.symbol.markerFill).toMatchObject({ icon: 'dot', spacingX: 10, spacingY: 8, stagger: true })
    expect(a.symbol.outline[0]).toMatchObject({ inside: true, color: '#0000ff' })
    expect(result.diagnostics.map((d) => d.message)).toEqual(
      expect.arrayContaining([expect.stringMatching(/b_diagonal/), expect.stringMatching(/"circle" marker/)]),
    )
    for (const rule of result.layers[0].rules) expect(() => checkedSheetSymbol(rule.symbol)).not.toThrow()
  })

  it('reads a rule-based line, refusing the foreign SVG and approximating the hash line', () => {
    const result = read('native-line_rule.qml')
    const [spur, other] = result.layers[0].rules
    expect(spur.filter).toEqual({ field: 'NAME', op: 'eq', value: "Spur B's" })
    expect(other.filter).toBeNull()
    expect(spur.symbol).toMatchObject({
      kind: 'line',
      layers: [{ color: '#ff0000', width: 2.5, opacity: 0.502, dash: [4, 2], offset: 3, cap: 'round' }],
      markers: [{ icon: 'tick', start: 0 }],
    })
    const errors = result.diagnostics.filter((d) => d.severity === 'error')
    expect(errors.map((d) => d.message)).toEqual([expect.stringMatching(/foreign SVG.*choose a PGMaps icon/)])
    expect(result.layers[0].label).toEqual({
      field: 'NAME',
      size: 7,
      color: '#112233',
      halo: { color: '#ffffff', width: 1 },
      placement: 'line',
      bold: true,
    })
  })

  it('reads graduated classes as ranges and refuses shapes without a PGMaps icon', () => {
    const result = read('native-point_grad.qml')
    expect(result.layers[0].rules).toHaveLength(1)
    expect(result.layers[0].rules[0]).toMatchObject({
      filter: { field: 'V', op: 'range', min: 0, max: 10 },
      symbol: { kind: 'point', icon: 'diamond' },
    })
    expect(result.diagnostics.some((d) => d.severity === 'error' && /"star"/.test(d.message))).toBe(true)
    expect(result.diagnostics.some((d) => d.severity === 'warning' && /upper bound/.test(d.message))).toBe(true)
  })

  it('never reads a font marker, and says so', () => {
    const result = read('native-point_font.qml')
    expect(result.layers).toEqual([])
    expect(result.diagnostics[0]).toMatchObject({ severity: 'error', message: expect.stringMatching(/symbol font/) })
  })
})
