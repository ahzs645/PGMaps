import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ICONS } from '@/lib/mapSheet/icons'
import type { SheetSymbol } from '@/lib/mapSheet/symbols'
import { gallerySymbolGroups } from './gallerySheets'
import { NCD_STREAM, STREAM } from './styles'
import { CATALOGUE_GROUPS, catalogueEntry, SYMBOL_CATALOGUE } from './symbolCatalogue'
import { mismatchSymbol, SYMBOL_MISMATCHES, usesMapValue } from './symbolMismatches'

/** The reference catalogue's features PGMaps can draw, by the id each is defined under. */
const SOURCE_FEATURES = [
  // Contours and spot heights
  'contour-index',
  'contour-intermediate',
  'contour-index-imagery',
  'contour-intermediate-imagery',
  'spot-height',
  // Blocks and management areas
  'block-of-interest',
  'block-of-interest-lidar',
  'other-blocks',
  'adjacent-licensee-block',
  'common-boundary',
  'operating-area',
  'reserve',
  'reserve-hatched',
  'non-productive',
  'previously-harvested',
  'satisfactorily-restocked',
  'free-growing',
  'opening',
  'cable-harvest-area',
  'road-permit-area',
  'ncbr',
  'archaeological-potential',
  'parks',
  'eco-rec-reserve',
  'recreation-site',
  'woodlot',
  'community-forest',
  'scenic-area',
  'rare-ecosystem',
  'uncommon-ecosystem',
  'ogma',
  'landscape-retention',
  'ancient-forest',
  'private-land',
  'native-reserve',
  'uwr-modified',
  'uwr-no-harvest',
  'caribou',
  'wildlife-habitat-area',
  'range-tenure',
  'migratory-bird',
  'alpine-zone',
  'alpine-forest',
  'riparian-zone-plan',
  'remnant-old',
  'vri-polygon',
  // Hydrology
  'stream',
  'ncd-stream',
  'lidar-stream',
  'lake',
  'wetland',
  'reach-break',
  'fish-observation',
  'fish-barrier',
  'point-of-diversion',
  'fisheries-sensitive-watershed',
  'riparian-management-zone',
  // Roads and linear features
  'road-paved',
  'road-gravel-main',
  'road-operational',
  'road-spur',
  'road-proposed',
  'road-temp-constructed',
  'road-temp-proposed',
  'road-other',
  'road-barge',
  'road-deactivation',
  'trail',
  'recreation-trail',
  'cultural-trail',
  'road-permit-line',
  'road-centerline-gps',
  'road-centerline-prework',
  'block-boundary-gps',
  'block-boundary-prework',
  'prework-possible-stream',
  'stream-gps',
  'reserve-gps-line',
  'np-gps-line',
  'sss-line',
  'skid-trail',
  'machine-free-zone-line',
  'timber-type-line',
  'fence',
  'rail',
  'seismic-line',
  'pipeline',
  'transmission-line',
  // Point features
  'bridge-existing',
  'bridge-proposed',
  'bridge-unknown',
  'culvert-existing',
  'culvert-proposed',
  'culvert-unknown',
  'pipe-arch-existing',
  'pipe-arch-proposed',
  'pipe-arch-unknown',
  'structure-nonfunctioning',
  'structure-removed',
  'gate',
  'cattle-guard',
  'access-control',
  'railway-crossing',
  'pipeline-crossing',
  'pipeline-crossing-multiple',
  'skid-crossing',
  'gravel-pit',
  'old-gravel-source',
  'rock-quarry',
  'sand-pit',
  'shale-pit',
  'growth-yield-plot',
  'culturally-modified-tree',
  'invasive-plants',
  'wellsite',
  'wellsite-area',
  'scenic-marker',
  // Final layout and design polygons
  'final-machine-free-zone',
  'final-crawler-adverse',
  'final-no-decking',
  'final-skid-distance',
  'final-slope-35-49',
  'final-slope-50',
  'final-block-hazard',
  'final-special-rmz',
  'design-special-harvest',
  'design-steep-slope',
]

const icons = (symbol: SheetSymbol): string[] =>
  symbol.kind === 'point'
    ? [symbol.icon]
    : symbol.kind === 'line'
      ? (symbol.markers ?? []).map((m) => m.icon)
      : symbol.kind === 'area' && symbol.markerFill
        ? [symbol.markerFill.icon]
        : []

describe('symbol catalogue', () => {
  it('defines every source feature once, with its source values and its data', () => {
    const ids = SYMBOL_CATALOGUE.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of SOURCE_FEATURES) expect(() => catalogueEntry(id), id).not.toThrow()
    for (const entry of SYMBOL_CATALOGUE) {
      expect(entry.spec.trim(), entry.id).not.toBe('')
      expect('source' in entry.data ? entry.data.source : entry.data.missing, entry.id).toMatch(/\w/)
      expect(
        CATALOGUE_GROUPS.some((group) => group.id === entry.group),
        entry.id,
      ).toBe(true)
      for (const icon of icons(entry.symbol)) expect(Object.keys(ICONS), entry.id).toContain(icon)
    }
  })

  it('shows every symbol in the gallery, in the source groups', () => {
    const shown = gallerySymbolGroups().flatMap((group) => group.entries.map((entry) => entry.id))
    expect(shown.sort()).toEqual(SYMBOL_CATALOGUE.map((entry) => entry.id).sort())
  })

  it('resolves every legend-versus-map difference to the map value', () => {
    expect(SYMBOL_MISMATCHES.length).toBeGreaterThanOrEqual(5)
    for (const mismatch of SYMBOL_MISMATCHES) {
      expect(mismatchSymbol(mismatch), mismatch.id).toEqual(mismatch.map)
      expect(usesMapValue(mismatch), mismatch.id).toBe(true)
      expect(mismatch.legend, mismatch.id).not.toEqual(mismatch.map)
    }
    // The drawing constants themselves carry the map widths.
    expect(STREAM.detail.layers[0].width).toBe(1)
    expect(NCD_STREAM.detail.layers[0].width).toBe(1)
    expect(STREAM.overview.layers[0].width).toBe(0.1)
  })

  it('carries no licensee, block or place names', () => {
    const folder = path.dirname(new URL(import.meta.url).pathname)
    for (const file of [
      'symbolCatalogue.ts',
      'symbolMismatches.ts',
      'gallerySheets.ts',
      'blockSheetFixtures.ts',
      '../../mapSheet/icons.ts',
    ]) {
      const text = readFileSync(path.join(folder, file), 'utf8')
      expect(text, file).not.toMatch(/canfor|bcts|\bdtt\b|tpy00|torpy|tfl ?30|U975582/i)
    }
  })
})
