import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { catalogueEntry } from '@/lib/forestry/blockSheet/symbolCatalogue'
import { findPreset, VQO_ZONE_ROLES } from '@/lib/forestry/viaFigure/presets'

import {
  PHOTO_LAYER_GROUPS,
  PHOTO_LAYERS,
  customLayerKey,
  customLayerVisibility,
  isPhotoLayerId,
  photoLayerLegend,
  photoLayerSymbol,
  photoLayerVisibility,
  photoStrokes,
  photoSymbolScale,
  roleSymbol,
} from './photoLayers'

describe('photo layers', () => {
  it('turns on the skyline, proposed blocks, recent cutblocks and openings, and lakes, and nothing else', () => {
    expect(PHOTO_LAYERS.filter((layer) => layer.defaultOn).map((layer) => layer.id)).toEqual([
      'skyline',
      'proposedBlocks',
      'openings',
      'lakes',
    ])
    expect(photoLayerVisibility()).toMatchObject({ skyline: true, streams: false, horizon: false })
  })

  it('keeps sub-landforms and lines of force as drawn-only candidates', () => {
    const candidates = PHOTO_LAYERS.filter((layer) => layer.candidate)
    expect(candidates.map((layer) => layer.id)).toEqual(['subLandforms', 'linesOfForce'])
    for (const layer of candidates) {
      expect(layer.pickable).toBe(false)
      expect(layer.group).toBe('candidates')
    }
  })

  it('gives every layer a group the popover lists and a symbol to draw with', () => {
    const groups = new Set(PHOTO_LAYER_GROUPS.map((group) => group.id))
    for (const layer of PHOTO_LAYERS) {
      expect(groups.has(layer.group)).toBe(true)
      expect(photoLayerSymbol(layer.id)).toBeTruthy()
      expect(photoLayerLegend(layer.id).length).toBeGreaterThan(0)
    }
    expect(new Set(PHOTO_LAYERS.map((layer) => layer.id)).size).toBe(PHOTO_LAYERS.length)
  })

  it("takes the scene's roles from the reviewer's figure style, else the first style that draws them", () => {
    const perspective = findPreset('perspective-overlay')!
    expect(photoLayerSymbol('proposedBlocks', {}, 'perspective-overlay')).toBe(
      perspective.symbols.proposedBlock!.symbol,
    )
    // That style draws no landform: another style's is used.
    expect(photoLayerSymbol('landform', {}, 'perspective-overlay')).toBe(roleSymbol('landform'))
    expect(photoLayerSymbol('landform', {}, 'no-such-style')).toBe(roleSymbol('landform'))
    for (const [role, code] of VQO_ZONE_ROLES)
      expect(photoLayerSymbol('evqo', { code }, 'perspective-overlay')).toBe(perspective.symbols[role]!.symbol)
    expect(photoLayerSymbol('linesOfForce', { kind: 'concave' })).toBe(roleSymbol('forceConcave'))
  })

  it('takes mapped features from the block-sheet catalogue', () => {
    expect(photoLayerSymbol('lakes', { kind: 'lake' })).toBe(catalogueEntry('lake').symbol)
    expect(photoLayerSymbol('lakes', { kind: 'wetland' })).toBe(catalogueEntry('wetland').symbol)
    expect(photoLayerSymbol('streams')).toBe(catalogueEntry('stream').symbol)
    expect(photoLayerSymbol('roads', { forestServiceRoad: true })).toBe(catalogueEntry('road-gravel-main').symbol)
    expect(photoLayerSymbol('roads', { FILE_TYPE_DESCRIPTION: 'Road Permit' })).toBe(catalogueEntry('road-spur').symbol)
  })

  it('takes the skyline and the reading aids from the catalogue’s photo entries', () => {
    expect(photoLayerSymbol('skyline')).toBe(catalogueEntry('photo-skyline').symbol)
    expect(photoLayerSymbol('horizon')).toBe(catalogueEntry('photo-level-line').symbol)
    expect(photoLayerSymbol('bearingTicks')).toBe(catalogueEntry('photo-bearing-tick').symbol)
    expect(photoLayerSymbol('distanceContours')).toBe(catalogueEntry('photo-distance-contour').symbol)
  })

  it('types no colour of its own', () => {
    const source = readFileSync(fileURLToPath(new URL('./photoLayers.ts', import.meta.url)), 'utf8')
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(source).not.toMatch(/rgba?\(/i)
  })

  it('keeps saved choices for layers that exist and ignores the rest', () => {
    const visibility = photoLayerVisibility({ streams: true, skyline: false, gone: true, lakes: 'yes' })
    expect(visibility.streams).toBe(true)
    expect(visibility.skyline).toBe(false)
    expect(visibility.lakes).toBe(true)
    expect('gone' in visibility).toBe(false)
  })
})

describe('layers a caller adds', () => {
  const added = [{ id: 'haul' }, { id: 'reserves', defaultOn: false }]

  it('keys them apart from every built-in layer', () => {
    expect(customLayerKey('skyline')).not.toBe('skyline')
    expect(isPhotoLayerId(customLayerKey('skyline'))).toBe(false)
  })

  it('starts each as it says, on unless told otherwise, and keeps a saved choice', () => {
    expect(customLayerVisibility(added)).toEqual({ 'custom:haul': true, 'custom:reserves': false })
    expect(customLayerVisibility(added, { 'custom:haul': false, 'custom:reserves': true })).toEqual({
      'custom:haul': false,
      'custom:reserves': true,
    })
  })

  it('drops a saved choice for a layer no longer added, and anything that is not a choice', () => {
    expect(customLayerVisibility([{ id: 'haul' }], { 'custom:gone': false, 'custom:haul': 'yes' })).toEqual({
      'custom:haul': true,
    })
    expect(customLayerVisibility(added, null)).toEqual({ 'custom:haul': true, 'custom:reserves': false })
  })
})

describe('photoStrokes', () => {
  it('scales an outline to the photo and dots a hidden run in the same colour', () => {
    const k = photoSymbolScale(1800)
    expect(k).toBe(2)
    const symbol = roleSymbol('proposedBlock', 'analysis-sheet-magenta')
    if (symbol.kind !== 'area') throw Error('expected an area')
    const [shown] = photoStrokes(symbol, k)
    expect(shown.color).toBe(symbol.outline[0].color)
    expect(shown.width).toBeCloseTo(symbol.outline[0].width * 2, 9)
    const [hidden] = photoStrokes(symbol, k, true)
    expect(hidden.color).toBe(shown.color)
    expect(hidden.dash).toEqual([0, shown.width * 2])
    expect(hidden.cap).toBe('round')
  })

  it('strokes a fill-only style in its fill colour', () => {
    const symbol = roleSymbol('proposedBlock', 'perspective-overlay')
    if (symbol.kind !== 'area' || !symbol.fill) throw Error('expected a filled area')
    expect(photoStrokes(symbol, 1)[0].color).toBe(symbol.fill)
  })
})
