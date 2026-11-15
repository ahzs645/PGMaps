/**
 * The symbol catalogue as a library the style writers export whole: a QGIS style library, an
 * ArcGIS Pro `.stylx`, a GeoLibre style library and MapLibre sprites. Read from `SYMBOL_CATALOGUE`,
 * never copied. No DOM or network access.
 */
import type { SymbolLibrary } from '@/lib/styleExchange/model'
import { CATALOGUE_GROUPS, SYMBOL_CATALOGUE } from './symbolCatalogue'

export const CATALOGUE_LIBRARY_NAME = 'PGMaps forestry map symbols'

export function catalogueSymbolLibrary(): SymbolLibrary {
  const groups = new Map(CATALOGUE_GROUPS.map((group) => [group.id, group.title]))
  return {
    name: CATALOGUE_LIBRARY_NAME,
    symbols: SYMBOL_CATALOGUE.map((entry) => ({
      id: entry.id,
      name: entry.symbol.label,
      category: groups.get(entry.group) ?? entry.group,
      tags: ['pgmaps', entry.group, entry.symbol.kind],
      symbol: entry.symbol,
    })),
  }
}
