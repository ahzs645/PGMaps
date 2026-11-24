import { describe, expect, it } from 'vitest'
import raw from '../../../packages/legal-rules/ground/wildlife-measures.json'
import sources from '../../../packages/legal-rules/catalogue/sources.json'
import { ACTIVITIES } from './groundInstruments'
import { MAX_QUOTE_CHARS, parseWildlifeMeasures, WILDLIFE_MEASURES } from './wildlifeMeasures'

const sourceIds = new Set(sources.sources.map((s) => s.id))
const copy = () => structuredClone(raw) as typeof raw & { orders: Record<string, unknown>[] }

describe('the wildlife measures read from the orders', () => {
  it('parses, with the Prince George and Fort St. James orders read', () => {
    const ids = WILDLIFE_MEASURES.orders.flatMap((o) => o.covers)
    for (const key of ['u-7-002', 'u-7-003', 'u-7-010', 'u-7-013', 'u-7-015', 'u-7-018', 'u-7-019', 'u-7-022', '7-003'])
      expect(ids, key).toContain(key)
    expect(WILDLIFE_MEASURES.orders.reduce((n, o) => n + o.measures.length, 0)).toBeGreaterThanOrEqual(70)
  })

  it('names every order in the source catalogue, with its own published address', () => {
    for (const o of WILDLIFE_MEASURES.orders) {
      expect(sourceIds.has(o.source), o.source).toBe(true)
      const entry = sources.sources.find((s) => s.id === o.source)!
      expect(entry.url).toBe(o.url)
      expect(entry.kind).toBe('regional_order')
    }
  })

  it('keeps every quote under 125 characters, and a paraphrase beside it', () => {
    for (const o of WILDLIFE_MEASURES.orders)
      for (const m of [...o.measures, ...o.exemptions]) {
        expect(m.quote.length, `${o.id} ${m.ref}`).toBeLessThanOrEqual(MAX_QUOTE_CHARS)
        expect(m.says.length, `${o.id} ${m.ref}`).toBeGreaterThan(10)
      }
    const long = copy()
    ;(long.orders[0].measures as { quote: string }[])[0].quote = 'x'.repeat(130)
    expect(() => parseWildlifeMeasures(long)).toThrow(/under 125/)
  })

  it('ties every measure to zones the order lists, and to an activity the planner shows', () => {
    for (const o of WILDLIFE_MEASURES.orders)
      for (const m of o.measures) {
        expect(m.zones.every((z) => o.zones.some((x) => x.id === z))).toBe(true)
        expect(Object.keys(m.bears).every((a) => (ACTIVITIES as readonly string[]).includes(a))).toBe(true)
      }
    const bad = copy()
    ;(bad.orders[0].measures as { zones: string[] }[])[0].zones = ['nowhere']
    expect(() => parseWildlifeMeasures(bad)).toThrow(/does not list/)
    const activity = copy()
    ;(activity.orders[0].measures as { bears: Record<string, string> }[])[0].bears = { mining: 'governs' }
    expect(() => parseWildlifeMeasures(activity)).toThrow(/activity/)
  })

  it('never calls a Code order’s continued objectives general wildlife measures', () => {
    for (const o of WILDLIFE_MEASURES.orders.filter((x) => x.made === 'code'))
      expect(o.measures.every((m) => m.kind === 'objective')).toBe(true)
    const bad = copy()
    const code = bad.orders.find((o) => o.made === 'code')! as { measures: { kind: string }[] }
    code.measures[0].kind = 'gwm'
    expect(() => parseWildlifeMeasures(bad)).toThrow(/continued objectives/)
  })

  it('lists a range or area once, whether read, unread or withheld', () => {
    const twice = copy()
    ;(twice.unread as { covers: string[] }[])[0].covers.push('u-7-003')
    expect(() => parseWildlifeMeasures(twice)).toThrow(/listed by both/)
  })

  it('needs one way of naming a zone: units, harvest codes or the whole order', () => {
    const bad = copy()
    const zone = (bad.orders[1].zones as Record<string, unknown>[])[0]
    zone.all = true
    expect(() => parseWildlifeMeasures(bad)).toThrow(/exactly one/)
  })
})
