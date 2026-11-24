import { describe, expect, it } from 'vitest'
import { sampleLayers } from './blockSheetFixtures'
import {
  parseHiddenLayers,
  SHEET_LAYER_GROUPS,
  SHEET_LAYER_IDS,
  sheetLayerCounts,
  withoutHiddenLayers,
} from './layerChoice'

describe('block sheet layer choice', () => {
  it('lists every layer once across its groups', () => {
    expect(SHEET_LAYER_GROUPS.flatMap((group) => group.layers).sort()).toEqual([...SHEET_LAYER_IDS].sort())
  })

  it('leaves the hidden vector layers out and keeps the block of interest', () => {
    const kept = withoutHiddenLayers(sampleLayers, ['streams', 'otherBlocks', 'contours'])
    expect(kept.streams).toBeUndefined()
    expect(kept.otherBlocks).toBeUndefined()
    expect(kept.block).toBe(sampleLayers.block)
    expect(kept.roads).toBe(sampleLayers.roads)
    expect(withoutHiddenLayers(sampleLayers, [])).toBe(sampleLayers)
    expect(sampleLayers.streams).toBeDefined()
  })

  it('reads stored choices defensively, in the setup’s order', () => {
    expect(parseHiddenLayers(['notes', 'bogus', 'contours', 'notes'])).toEqual(['contours', 'notes'])
    expect(parseHiddenLayers('contours')).toEqual([])
  })

  it('counts what each layer holds', () => {
    const counts = sheetLayerCounts(sampleLayers)
    expect(counts.roads).toBe(sampleLayers.roads?.length ?? 0)
    expect(sheetLayerCounts({}).streams).toBe(0)
  })
})
