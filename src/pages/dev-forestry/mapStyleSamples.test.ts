import { describe, expect, it } from 'vitest'

import { styleSampleSvg } from '@/lib/mapSheet/styleSample'

import { reportMapStyleChoices, visualsSheetStyleChoices } from './mapStyleSamples'
import { REPORT_MAP_SYMBOLS } from './reportMaps'
import { figureMapStyle, reportMapStyles, SHEET_SYMBOLS_STYLE, visualsSheetStyles } from './visualsBlockSheet'

describe('the map styles offered with a sample', () => {
  it('lists the VIA report’s styles as the plain list does, each with a block and an opening to draw', () => {
    const choices = reportMapStyleChoices()
    expect(choices.map(({ value, label }) => ({ value, label }))).toEqual(reportMapStyles())
    for (const choice of choices) {
      expect(choice.sample?.block?.kind).toBe('area')
      expect(choice.sample?.opening?.kind).toBe('area')
      // The report's maps restyle only those two.
      expect(Object.keys(choice.sample ?? {}).sort()).toEqual(['block', 'opening'])
    }
  })

  it('draws the report’s own symbols for its own style, and a figure style’s where it has them', () => {
    const choices = reportMapStyleChoices()
    const own = choices.find((choice) => choice.value === SHEET_SYMBOLS_STYLE)!
    expect(own.sample).toEqual({ block: REPORT_MAP_SYMBOLS.block, opening: REPORT_MAP_SYMBOLS.opening })
    for (const choice of choices.filter((entry) => entry.value !== SHEET_SYMBOLS_STYLE)) {
      const style = figureMapStyle(choice.value)!
      expect(choice.sample?.block).toEqual(style.block ?? REPORT_MAP_SYMBOLS.block)
      expect(choice.sample?.opening).toEqual(style.opening ?? REPORT_MAP_SYMBOLS.opening)
      // A figure style is offered because it changes a map: its sample is not the report's own.
      expect(styleSampleSvg(choice.sample!)).not.toBe(styleSampleSvg(own.sample!))
    }
  })

  it('gives every block sheet style all five areas of the scene', () => {
    const choices = visualsSheetStyleChoices()
    expect(choices.map(({ value, label }) => ({ value, label }))).toEqual(visualsSheetStyles())
    for (const choice of choices)
      expect(Object.keys(choice.sample ?? {}).sort()).toEqual(['block', 'landform', 'opening', 'privateLand', 'rock'])
  })

  it('builds each list once', () => {
    expect(reportMapStyleChoices()).toBe(reportMapStyleChoices())
    expect(visualsSheetStyleChoices()).toBe(visualsSheetStyleChoices())
  })
})
