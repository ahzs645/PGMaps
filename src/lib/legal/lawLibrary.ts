/**
 * Loads the stored text of the law on demand: one statute or regulation per chunk
 * (`catalogue/generated/<source>.sections.json`) and one transcribed order per chunk
 * (`catalogue/orders/<source>.json`). Nothing here loads with a page; a provision preview asks
 * for the one source it shows.
 */
import catalogue from '../../../packages/legal-rules/catalogue/sources.json'
import type { Enabling, OrderAreas } from './coverage'
import type { LawSource } from './lawText'
import type { OrderText } from './orderText'

const statutes = import.meta.glob<LawSource>('../../../packages/legal-rules/catalogue/generated/*.sections.json', {
  import: 'default',
})
const orders = import.meta.glob<OrderText>('../../../packages/legal-rules/catalogue/orders/*.json', {
  import: 'default',
})
const keyOf = (path: string) => path.replace(/^.*\//, '').replace(/\.sections\.json$|\.json$/, '')
const statuteLoaders = new Map(Object.entries(statutes).map(([path, load]) => [keyOf(path), load]))
const orderLoaders = new Map(Object.entries(orders).map(([path, load]) => [keyOf(path), load]))

export interface CatalogueSource {
  id: string
  title: string
  kind: string
  url: string
  /** For an order or policy: the natural resource regions and districts it covers. */
  areas?: OrderAreas
  /** For an order: the sections it is made under. */
  enabling?: Enabling[]
}
export const catalogueSources = catalogue.sources as CatalogueSource[]
const byId = new Map(catalogueSources.map((s) => [s.id, s]))
// Two entries can share a document (the 2004 order and its 2005 policy are one PDF): the first wins.
const byUrl = new Map<string, string>()
for (const s of catalogueSources) if (!byUrl.has(s.url)) byUrl.set(s.url, s.id)

export const catalogueSource = (id: string) => byId.get(id)
/** The catalogue id of a pack's source, matched by its document address. */
export const catalogueIdForUrl = (url: string) => byUrl.get(url.replace(/#.*$/, ''))

export const hasStatuteText = (id: string) => statuteLoaders.has(id)
export const hasOrderText = (id: string) => orderLoaders.has(id)

export function loadStatute(id: string): Promise<LawSource | null> {
  const load = statuteLoaders.get(id)
  return load ? load() : Promise.resolve(null)
}
export function loadOrder(id: string): Promise<OrderText | null> {
  const load = orderLoaders.get(id)
  return load ? load() : Promise.resolve(null)
}
