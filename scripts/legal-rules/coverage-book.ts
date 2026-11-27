/**
 * Compiles the law coverage book (`docs/legal-coverage-book.md`) from the section-by-section review
 * and the shipped packs. `npm run legal:coverage-book` writes it; `-- --check` fails when it is out
 * of date, as `src/lib/legal/coverageBook.test.ts` does.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parsePack } from '../../packages/legal-rules/src/contract'
import {
  citationIndex,
  type AdminAreasFile,
  type CoverageReview,
  type LawTopicsFile,
  type OrderLinks,
} from '../../src/lib/legal/coverage'
import { coverageBook } from '../../src/lib/legal/coverageBook'

const root = new URL('../../packages/legal-rules/', import.meta.url)
export const BOOK = new URL('../../docs/legal-coverage-book.md', import.meta.url)
const read = (path: string) => JSON.parse(readFileSync(new URL(path, root), 'utf8'))
const PRIORITY = [
  'bc.fppr',
  'bc.frpa',
  'bc.gar',
  'bc.forest-act',
  'bc.land-act',
  'bc.range-act',
  'bc.rppr',
  'bc.ipma',
  'bc.pgtsa.2004',
  'bc.pgtsa.policy.2005',
  'bc.pgtsa.loe.2022',
  'bc.omineca.ada-sra.2006',
]

export function bookFromDisk() {
  const catalogue = read('catalogue/sources.json').sources as (OrderLinks & { url: string; kind: string })[]
  const byUrl = new Map<string, string>()
  for (const s of catalogue) if (!byUrl.has(s.url)) byUrl.set(s.url, s.id)
  const isOrder = (id: string) =>
    ['regional_order', 'guidance'].includes(catalogue.find((s) => s.id === id)?.kind ?? '')
  const packs = readdirSync(new URL('packs/', root))
    .filter((n) => n.endsWith('.json'))
    .sort()
    .map((n) => parsePack(read('packs/' + n)))
  const reviews: CoverageReview[] = readdirSync(new URL('catalogue/section-review/', root))
    .filter((n) => n.endsWith('.json'))
    .sort()
    .map((n) => read('catalogue/section-review/' + n))
  const index = citationIndex(packs, read('ground/instruments.json').instruments, (u) => byUrl.get(u), isOrder)
  return coverageBook({
    reviews,
    index,
    packs,
    priority: PRIORITY,
    topics: (read('catalogue/topics.json') as LawTopicsFile).topics,
    orders: catalogue.filter((s) => s.areas),
    areas: read('catalogue/admin-areas.json') as AdminAreasFile,
    sources: catalogue.map((s) => ({ id: s.id, title: s.title, url: s.url, order: isOrder(s.id) })),
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const book = bookFromDisk()
  if (process.argv.includes('--check')) {
    if (readFileSync(BOOK, 'utf8') !== book) {
      console.error('docs/legal-coverage-book.md is out of date: run npm run legal:coverage-book')
      process.exit(1)
    }
  } else writeFileSync(BOOK, book)
}
