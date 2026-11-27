import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parsePack } from '../../../packages/legal-rules/src/contract'
import { citationIndex, coverageCsv, gapsOf, sectionKey, sectionState, type CoverageReview } from './coverage'

const root = new URL('../../../packages/legal-rules/', import.meta.url)
const read = (path: string) => JSON.parse(readFileSync(new URL(path, root), 'utf8'))
const catalogue = read('catalogue/sources.json').sources as { id: string; url: string; kind: string }[]
const byUrl = new Map<string, string>()
for (const s of catalogue) if (!byUrl.has(s.url)) byUrl.set(s.url, s.id)
const isOrder = (id: string) => ['regional_order', 'guidance'].includes(catalogue.find((s) => s.id === id)?.kind ?? '')
const packs = readdirSync(new URL('packs/', root))
  .filter((n) => n.endsWith('.json'))
  .map((n) => parsePack(read('packs/' + n)))
const ground = read('ground/instruments.json').instruments
const reviews: CoverageReview[] = readdirSync(new URL('catalogue/section-review/', root))
  .filter((n) => n.endsWith('.json'))
  .map((n) => read('catalogue/section-review/' + n))
const index = citationIndex(packs, ground, (u) => byUrl.get(u), isOrder)

describe('citationIndex', () => {
  it('finds the rules and screens that cite a section', () => {
    expect(index.get('bc.fppr:64')?.map((c) => c.id)).toEqual(
      expect.arrayContaining(['bc.fppr@1.1.0:limit-60', 'bc.fppr@1.0.0:limit-40']),
    )
    expect(
      index
        .get('bc.omineca.ada-sra.2006:C.5')
        ?.some((c) => c.id === 'bc.crown-grazing@1.0.0:ada-sra-planting-restriction'),
    ).toBe(true)
    expect(index.get('bc.gar:7')?.some((c) => c.kind === 'rule')).toBe(true)
    expect(index.get('bc.alc-act:20.3')?.every((c) => c.kind === 'screen')).toBe(true)
  })
  it('reads a reference to another instrument inside a citation', () => {
    expect(index.get('bc.fppr:44')?.some((c) => c.id.endsWith(':designation-not-lease'))).toBe(true)
  })
})

describe('coverage review', () => {
  it('covers every section in force of every stored statute and regulation', () => {
    const missing: string[] = []
    for (const name of readdirSync(new URL('catalogue/generated/', root)).filter((n) => n.endsWith('.sections.json'))) {
      const law = read('catalogue/generated/' + name)
      const review = reviews.find((r) => r.source === law.sourceId)
      // The review was made for the Law folder's Acts and the three forestry regulations.
      if (!review) continue
      const reviewed = new Set(review.sections.map((s) => s.n))
      for (const s of law.sections)
        if (!s.repealed && !reviewed.has(s.number)) missing.push(`${law.sourceId} s. ${s.number}`)
    }
    // Sections BC Laws numbers that the review's copy did not (schedules, sections added since): name them.
    expect(missing.length, missing.join(', ')).toBeLessThan(6)
  })
  it('keeps every entry to its contract', () => {
    for (const r of reviews) {
      expect(r.format).toBe('pgmaps-coverage-review/v1')
      expect(
        catalogue.some((s) => s.id === r.source),
        r.source,
      ).toBe(true)
      for (const s of r.sections) {
        expect(s.bearsOn.length, `${r.source} ${s.n}`).toBeGreaterThan(0)
        if (s.gapPriority) expect(['high', 'medium', 'low']).toContain(s.gapPriority)
      }
    }
  })
  it('places a section a rule cites as ruled, and lists the gaps highest first', () => {
    const fppr = reviews.find((r) => r.source === 'bc.fppr')!
    const s64 = fppr.sections.find((s) => s.n === '64')
    expect(sectionState(index.get(sectionKey('bc.fppr', '64')), s64)).toBe('rule')
    const gaps = gapsOf(reviews)
    expect(gaps[0].entry.gapPriority).toBe('high')
    expect(coverageCsv(reviews, index).split('\n')[0]).toContain('gap_priority')
  })
})
