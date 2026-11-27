/**
 * A land use order as PGMaps keeps it (`packages/legal-rules/catalogue/orders/<source>.json`): the
 * order's own provisions, each with its page in the signed PDF and short quotes transcribed word
 * for word. Orders are published as PDFs, often scanned, so there is no official text to import;
 * the quotes are what a rule and a provision preview can show, and the PDF is always one click
 * away. DOM-free.
 */
import { fold } from './lawText'

/** A quote keeps under 125 characters, as the wildlife measures do. */
export const MAX_ORDER_QUOTE_CHARS = 124

export interface OrderProvision {
  /** "C.5", "D.5(a)", "Part II", "Objective 3", "Strategy 3.02", "Table 7". */
  id: string
  heading: string
  /** Page of the signed PDF, counted from 1. */
  page: number
  quotes: string[]
}
export interface OrderText {
  format: 'pgmaps-order-text/v1'
  source: string
  title: string
  url: string
  /** The power the order was made under: "Land Act s. 93.4", "Forest Practices Code Act s. 4". */
  madeUnder: string
  made: string
  /** How it was read: "signed PDF, text layer" or "signed PDF, scanned; read from the page images". */
  transcribedFrom: string
  transcribedOn: string
  /** What else governs it: amendments, an order it prevails over, the route by which it still binds. */
  notes?: string[]
  provisions: OrderProvision[]
}

export function parseOrderText(raw: unknown): OrderText {
  const o = raw as OrderText
  const at = `Order text ${o?.source ?? '?'}`
  if (o?.format !== 'pgmaps-order-text/v1') throw Error(`${at}: unknown format.`)
  for (const key of ['source', 'title', 'url', 'madeUnder', 'made', 'transcribedFrom', 'transcribedOn'] as const)
    if (typeof o[key] !== 'string' || !o[key].trim()) throw Error(`${at}: ${key} is missing.`)
  if (!/^https:\/\//.test(o.url)) throw Error(`${at}: the url must be the published PDF.`)
  const ids = new Set<string>()
  for (const p of o.provisions ?? []) {
    if (ids.has(p.id)) throw Error(`${at}: provision ${p.id} appears twice.`)
    ids.add(p.id)
    if (!Number.isInteger(p.page) || p.page < 1) throw Error(`${at} ${p.id}: page must be a page number.`)
    if (!p.quotes?.length) throw Error(`${at} ${p.id}: give at least one quote.`)
    for (const q of p.quotes)
      if (q.length > MAX_ORDER_QUOTE_CHARS)
        throw Error(`${at} ${p.id}: a quote is ${q.length} characters; keep it under 125.`)
  }
  if (!ids.size) throw Error(`${at}: no provisions.`)
  return o
}

/** The provision a citation names, by id: "C.5" also finds "Part C.5". */
export function orderProvision(order: OrderText, id: string) {
  const bare = (x: string) => x.replace(/^(?:Part|Objective|Order)\s+(?=[A-E](?:\.|\(|$)|[IVX]+$)/, '')
  const want = bare(id)
  return (
    order.provisions.find((p) => p.id === id || bare(p.id) === want) ??
    // "Part D" names a part whose only provision is D.1.
    order.provisions.find((p) => bare(p.id).startsWith(want + '.'))
  )
}

/** Whether a quote is one of the provision's transcribed quotes, or a part of one. */
export function orderQuoteFound(provision: OrderProvision, quote: string) {
  return provision.quotes.some((q) => fold(q).includes(fold(quote)))
}

/** The page link a PDF viewer opens at: `#page=n`. */
export const orderPageUrl = (order: OrderText, page: number) => `${order.url.replace(/#.*$/, '')}#page=${page}`
