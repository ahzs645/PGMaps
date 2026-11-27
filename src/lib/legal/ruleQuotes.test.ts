import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parsePack, type Pack } from '../../../packages/legal-rules/src/contract'
import { citedSpan, findSection, quoteFound, type LawSource } from './lawText'
import { orderProvision, orderQuoteFound, parseOrderText, type OrderText } from './orderText'
import { orderRefs, parseProvision } from './provisions'
import { exceptionKey, MAX_RULE_QUOTE_CHARS, type RuleQuotesFile } from './ruleQuotes'

const root = new URL('../../../packages/legal-rules/', import.meta.url)
const read = (path: string) => JSON.parse(readFileSync(new URL(path, root), 'utf8'))
const catalogue = read('catalogue/sources.json').sources as { id: string; url: string; kind: string }[]
const byUrl = new Map<string, string>()
for (const s of catalogue) if (!byUrl.has(s.url)) byUrl.set(s.url, s.id)
const isOrder = (id: string) => ['regional_order', 'guidance'].includes(catalogue.find((s) => s.id === id)?.kind ?? '')
const statutes = new Map<string, LawSource>(
  readdirSync(new URL('catalogue/generated/', root))
    .filter((n) => n.endsWith('.sections.json'))
    .map((n) => [n.replace('.sections.json', ''), read('catalogue/generated/' + n)]),
)
const orders = new Map<string, OrderText>(
  readdirSync(new URL('catalogue/orders/', root))
    .filter((n) => n.endsWith('.json'))
    .map((n) => [n.replace('.json', ''), parseOrderText(read('catalogue/orders/' + n))]),
)
const packs: Pack[] = readdirSync(new URL('packs/', root))
  .filter((n) => n.endsWith('.json'))
  .map((n) => parsePack(read('packs/' + n)))
const quotes: RuleQuotesFile = read('catalogue/rule-quotes.json')

describe('rule quotes', () => {
  it('gives every shipped rule, and every exception a rule lists, at least one quote', () => {
    const missing = packs.flatMap((p) =>
      p.rules
        .flatMap((r) => [r.id, ...(r.exceptions ?? []).map((x) => exceptionKey(r.id, x.id))])
        .filter((key) => !quotes.rules[p.id]?.[key]?.length)
        .map((key) => `${p.id}:${key}`),
    )
    expect(missing).toEqual([])
  })

  it('prints every quote word for word in the stored law or the order', () => {
    const wrong: string[] = []
    for (const [pack, rules] of Object.entries(quotes.rules))
      for (const [rule, list] of Object.entries(rules))
        for (const q of list) {
          const at = `${pack}:${rule} ${q.source} ${q.provision}`
          if (q.quote.length > MAX_RULE_QUOTE_CHARS) wrong.push(`${at}: longer than ${MAX_RULE_QUOTE_CHARS}`)
          const law = statutes.get(q.source)
          const order = orders.get(q.source)
          if (law) {
            const section = findSection(law, q.provision)
            if (!section) wrong.push(`${at}: no such section`)
            else if (!quoteFound(section, q.quote)) wrong.push(`${at}: the stored text no longer prints "${q.quote}"`)
          } else if (order) {
            const p = orderProvision(order, q.provision)
            if (!p) wrong.push(`${at}: no such provision`)
            else if (!orderQuoteFound(p, q.quote)) wrong.push(`${at}: not among the transcribed quotes`)
          } else wrong.push(`${at}: PGMaps keeps no text for ${q.source}`)
        }
    expect(wrong).toEqual([])
  })
})

describe('citations', () => {
  /** Every provision a pack rule or a ground screen cites, with the catalogue id it is read against. */
  const citations: { at: string; source: string; provision: string }[] = []
  for (const p of packs)
    for (const r of p.rules) {
      const source = byUrl.get(p.sources.find((s) => s.id === r.source)!.url)
      if (source) citations.push({ at: `${p.id}@${p.version}:${r.id}`, source, provision: r.provision })
      for (const x of r.exceptions ?? []) {
        const from = byUrl.get(p.sources.find((s) => s.id === x.source)!.url)
        const at = `${p.id}@${p.version}:${exceptionKey(r.id, x.id)}`
        if (from) citations.push({ at, source: from, provision: x.provision })
      }
    }
  const ground = read('ground/instruments.json').instruments as unknown[]
  const walk = (o: unknown, at: string): void => {
    if (Array.isArray(o)) o.forEach((x) => walk(x, at))
    else if (o && typeof o === 'object') {
      const c = o as { source?: string; provision?: string; id?: string }
      if (typeof c.source === 'string' && typeof c.provision === 'string')
        citations.push({ at, source: c.source, provision: c.provision })
      for (const v of Object.values(o)) walk(v, at)
    }
  }
  for (const i of ground as { id: string }[]) walk(i, `ground:${i.id}`)

  it('resolves every cited section of a stored statute or regulation to one in force', () => {
    const wrong: string[] = []
    for (const c of citations) {
      if (isOrder(c.source)) continue
      for (const ref of parseProvision(c.provision, c.source)) {
        if (ref.kind !== 'section') continue
        const id = ref.source ?? c.source
        const law = statutes.get(id)
        if (!law) continue
        const section = findSection(law, ref.section)
        const where = `${c.at}: ${id} s. ${ref.section}${ref.sub} (cited as "${c.provision}")`
        if (!section) wrong.push(`${where} is not in the stored text`)
        else if (section.repealed) wrong.push(`${where} is repealed`)
        else if (ref.sub && !citedSpan(section, ref.sub)) wrong.push(`${where}: no such subsection or paragraph`)
      }
    }
    expect(wrong).toEqual([])
  })

  it('resolves every cited provision of a transcribed order', () => {
    const wrong: string[] = []
    for (const c of citations) {
      const order = orders.get(c.source)
      if (!order) continue
      // A provision cited by the order's own id needs no further reading.
      if (orderProvision(order, c.provision)) continue
      for (const ref of orderRefs(c.provision))
        if (!ref.other && !orderProvision(order, ref.provision))
          wrong.push(`${c.at}: ${c.source} ${ref.provision} (cited as "${c.provision}") is not transcribed`)
    }
    expect(wrong).toEqual([])
  })
})
