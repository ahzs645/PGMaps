import { describe, expect, it } from 'vitest'
import { pdfTextUnfolded } from '@/lib/mapSheet/renderPdf'
import type { SheetSymbol } from '@/lib/mapSheet/symbols'
import {
  findPreset,
  legendEntries,
  LIVE_PRESETS,
  LIVE_ROLES,
  presetById,
  presetSymbols,
  ROLE_NAMES,
  VIA_STYLE_PRESETS,
  type ViaRole,
} from './presets'

const HEX = /^#[0-9a-f]{6}$/i

/** Every colour a symbol carries. */
function colours(symbol: SheetSymbol): string[] {
  if (symbol.kind === 'class' || symbol.kind === 'point') return [symbol.color]
  if (symbol.kind === 'line')
    return [...symbol.layers.map((l) => l.color), ...(symbol.markers ?? []).map((m) => m.color)]
  return [
    ...(symbol.fill ? [symbol.fill] : []),
    ...(symbol.hatches ?? []).map((h) => h.stroke.color),
    ...(symbol.markerFill ? [symbol.markerFill.color] : []),
    ...symbol.outline.map((o) => o.color),
  ]
}

/** Company and agency names the reference documents carried; none may reach a preset. */
const BRANDS = /canfor|interfor|west fraser|dunkley|tolko|bcts|fls\b|forestry and land scotland|esri|google/i

describe('VIA figure style presets', () => {
  it('have unique ids and generic names, and cite their sources by document number', () => {
    const ids = VIA_STYLE_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const preset of VIA_STYLE_PRESETS) {
      expect(preset.sources.length).toBeGreaterThan(0)
      expect(preset.sources.every((s) => /^\d{2}\b/.test(s))).toBe(true)
      expect(JSON.stringify(preset)).not.toMatch(BRANDS)
    }
    expect(presetById('analysis-sheet-orange').family).toBe('A')
    expect(() => presetById('nope')).toThrow()
    expect(findPreset('nope')).toBeNull()
    expect(findPreset(null)).toBeNull()
  })

  it('give every symbol a spec and a parsable colour', () => {
    for (const preset of VIA_STYLE_PRESETS)
      for (const [role, entry] of Object.entries(preset.symbols)) {
        expect(entry!.spec.length, `${preset.id} ${role}`).toBeGreaterThan(0)
        for (const colour of colours(entry!.symbol)) expect(colour, `${preset.id} ${role}`).toMatch(HEX)
        expect('source' in entry!.data || 'missing' in entry!.data).toBe(true)
      }
    for (const preset of VIA_STYLE_PRESETS)
      for (const ramp of preset.ramps ?? []) for (const c of ramp.classes) expect(c.color).toMatch(HEX)
  })

  it('list in the legend only roles they define, and only those drawn', () => {
    for (const preset of VIA_STYLE_PRESETS) {
      for (const { role } of preset.legend.order) expect(preset.symbols[role], `${preset.id} ${role}`).toBeDefined()
      const all = new Set(Object.keys(preset.symbols) as ViaRole[])
      expect(legendEntries(preset, all).map((e) => e.role)).toEqual(preset.legend.order.map((o) => o.role))
      expect(legendEntries(preset, new Set())).toEqual([])
      if (preset.legend.footnote?.role) expect(preset.symbols[preset.legend.footnote.role]).toBeDefined()
    }
    // The legend uses the source's wording, not the symbol's own label.
    const orange = presetById('analysis-sheet-orange')
    const [first] = legendEntries(orange, new Set(['proposedBlock']))
    expect(first.symbol.label).toBe('Proposed Block')
  })

  it('keep every printed string inside what the PDF fonts can print', () => {
    for (const preset of VIA_STYLE_PRESETS) {
      const strings = [
        preset.name,
        ...preset.legend.order.map((o) => o.label),
        ...(preset.legend.footnote ? [preset.legend.footnote.text] : []),
        ...(preset.calc ? [preset.calc.title.text, ...preset.calc.lines] : []),
        ...(preset.titles?.lines.map((l) => l.text) ?? []),
        ...(preset.panelLabels?.labels ?? []),
        ...(preset.vsuBadge ? [...preset.vsuBadge.lines, ...preset.vsuBadge.keyLines] : []),
      ]
      for (const text of strings) expect(pdfTextUnfolded(text), text).toEqual([])
    }
  })

  it('name every role, and offer the road view only presets it can drape', () => {
    expect(Object.keys(ROLE_NAMES)).toHaveLength(18)
    expect(LIVE_PRESETS.length).toBeGreaterThan(5)
    for (const preset of LIVE_PRESETS) expect(LIVE_ROLES.some((role) => preset.symbols[role])).toBe(true)
    // The time-step ramps have nothing the road view can drape.
    expect(LIVE_PRESETS.some((p) => p.id === 'time-step-ramps')).toBe(false)
    expect(presetSymbols(presetById('analysis-sheet-magenta'))).toHaveLength(4)
  })
})
