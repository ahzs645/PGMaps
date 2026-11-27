import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parsePack } from '../../../packages/legal-rules/src/contract'
import {
  citationIndex,
  coverageCsv,
  gapsOf,
  ordersInDistrict,
  ordersUnder,
  sectionKey,
  sectionsWithTopic,
  sectionState,
  topicCounts,
  type AdminAreasFile,
  type CoverageReview,
  type LawTopicsFile,
  type OrderLinks,
} from './coverage'

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
const topics: LawTopicsFile = read('catalogue/topics.json')

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

describe('orders', () => {
  const sources = read('catalogue/sources.json').sources as (OrderLinks & { kind: string })[]
  const areas: AdminAreasFile = read('catalogue/admin-areas.json')
  const orders = sources.filter((s) => ['regional_order', 'guidance'].includes(s.kind) || s.areas)
  it('places every order in the natural resource districts it covers, saying how', () => {
    const wrong: string[] = []
    for (const o of orders) {
      if (!o.areas) wrong.push(`${o.id} has no areas`)
      else if (!o.areas.basis) wrong.push(`${o.id} does not say how its areas were found`)
      else if (o.areas.scope === 'districts') {
        if (!o.areas.districts?.length) wrong.push(`${o.id} covers no district`)
        for (const d of o.areas.districts ?? [])
          if (!areas.districts.some((x) => x.code === d)) wrong.push(`${o.id}: ${d} is not a district`)
        for (const r of o.areas.regions ?? [])
          if (!areas.regions.some((x) => x.code === r)) wrong.push(`${o.id}: ${r} is not a region`)
      }
    }
    expect(wrong).toEqual([])
  })
  it('cites the sections an order is made under, each one stored and in force', () => {
    const wrong: string[] = []
    for (const o of orders) {
      if (!o.enabling) wrong.push(`${o.id} records nothing it is made under`)
      for (const e of o.enabling ?? []) {
        if (!e.source) {
          if (!e.text) wrong.push(`${o.id}: an empty enabling entry`)
          continue
        }
        const law = read(`catalogue/generated/${e.source}.sections.json`)
        const section = law.sections.find((s: { number: string }) => s.number === e.provision)
        if (!section) wrong.push(`${o.id}: ${e.source} s. ${e.provision} is not stored`)
        else if (section.repealed) wrong.push(`${o.id}: ${e.source} s. ${e.provision} is repealed`)
      }
    }
    expect(wrong).toEqual([])
  })
  it('lists the orders under the section they are made under, and by district', () => {
    expect(
      ordersUnder(orders)
        .get('bc.land-act:93.4')
        ?.map((o) => o.id),
    ).toContain('bc.omineca.ada-sra.2006')
    expect(
      ordersUnder(orders)
        .get('bc.gar:7')
        ?.map((o) => o.id),
    ).toContain('bc.fsj.vqo.2005')
    expect(ordersInDistrict(orders, 'DVA').map((o) => o.id)).toEqual(
      expect.arrayContaining(['bc.fsj.vqo.2005', 'bc.lwbc.grazing-policy.2004']),
    )
    expect(ordersInDistrict(orders, 'DVA').map((o) => o.id)).not.toContain('bc.pg.vqo.2005')
  })
})

describe('coverage review', () => {
  it('covers every section in force of every stored statute and regulation', () => {
    const missing: string[] = []
    for (const name of readdirSync(new URL('catalogue/generated/', root)).filter((n) => n.endsWith('.sections.json'))) {
      const law = read('catalogue/generated/' + name)
      const review = reviews.find((r) => r.source === law.sourceId)
      if (!review) {
        missing.push(`${law.sourceId}, every section`)
        continue
      }
      const reviewed = new Set(review.sections.map((s) => s.n))
      for (const s of law.sections) if (!reviewed.has(s.number)) missing.push(`${law.sourceId} s. ${s.number}`)
    }
    expect(missing).toEqual([])
  })
  it('labels every section in force with topics from the shared vocabulary, and nothing repealed', () => {
    const vocabulary = topics.topics.map((t) => t.id)
    expect(new Set(vocabulary).size).toBe(vocabulary.length)
    const wrong: string[] = []
    for (const r of reviews)
      for (const s of r.sections) {
        const at = `${r.source} ${s.n}`
        if (s.relevance === 'repealed') {
          if (s.topics?.length) wrong.push(`${at} is repealed but labelled`)
          continue
        }
        if (!s.topics?.length) wrong.push(`${at} has no topic`)
        if ((s.topics?.length ?? 0) > 4) wrong.push(`${at} has more than four topics`)
        for (const t of s.topics ?? []) if (!vocabulary.includes(t)) wrong.push(`${at}: ${t} is not in topics.json`)
      }
    expect(wrong).toEqual([])
  })
  it('gathers one topic from several sources', () => {
    const crossings = sectionsWithTopic(reviews, 'stream-crossings-and-culverts')
    expect(crossings.some((x) => x.source === 'bc.fppr' && x.entry.n === '55')).toBe(true)
    expect(new Set(crossings.map((x) => x.source)).size).toBeGreaterThan(2)
    expect(topicCounts(reviews).get('riparian')).toBeGreaterThan(10)
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
