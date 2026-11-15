import { describe, expect, it, vi } from 'vitest'
import { reuseAnalyses } from './analysisReuse'

const road = (id: string) => ({ id })

describe('reuseAnalyses', () => {
  it('analyses only the road that changed when the shared inputs are the same objects', () => {
    const settings = {}
    const [a, b, c] = [road('a'), road('b'), road('c')]
    const analyse = vi.fn((r: { id: string }) => ({ of: r }))
    const first = reuseAnalyses(null, [settings], [a, b, c], analyse)
    expect(analyse).toHaveBeenCalledTimes(3)
    const edited = road('b')
    const second = reuseAnalyses(first.cache, [settings], [a, edited, c], analyse)
    expect(analyse).toHaveBeenCalledTimes(4)
    expect(analyse).toHaveBeenLastCalledWith(edited)
    expect(second.analyses.get('a')).toBe(first.analyses.get('a'))
    expect(second.analyses.get('c')).toBe(first.analyses.get('c'))
    expect(second.analyses.get('b')).not.toBe(first.analyses.get('b'))
  })

  it('analyses every road again when a shared input changes', () => {
    const [a, b] = [road('a'), road('b')]
    const analyse = vi.fn((r: { id: string }) => ({ of: r }))
    const first = reuseAnalyses(null, [{ grade: 12 }], [a, b], analyse)
    reuseAnalyses(first.cache, [{ grade: 12 }], [a, b], analyse)
    expect(analyse).toHaveBeenCalledTimes(4)
  })

  it('keeps the project order and drops removed roads', () => {
    const [a, b] = [road('a'), road('b')]
    const shared = [1]
    const first = reuseAnalyses(null, shared, [a, b], (r) => r.id)
    const second = reuseAnalyses(first.cache, shared, [b], (r) => r.id)
    expect([...second.analyses.keys()]).toEqual(['b'])
    expect([...second.cache.byId.keys()]).toEqual(['b'])
  })
})
