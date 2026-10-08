import { describe, expect, it, vi } from 'vitest'
import { createMobileCardStack } from './mobile-card-store.js'

describe('workspace card isolation', () => {
  it('allows the same feature/table identities independently across embedded maps', () => {
    const first = createMobileCardStack()
    const second = createMobileCardStack()
    const secondChanged = vi.fn()
    second.subscribe(secondChanged)
    second.push('feature')
    second.setHeight('feature', 200)
    secondChanged.mockClear()
    first.push('feature')
    first.push('table')
    first.setHeight('table', 400)
    first.push('feature')
    first.remove('feature')
    expect(first.getSnapshot()).toEqual([{ id: 'table', visibleHeight: 400 }])
    expect(second.getSnapshot()).toEqual([{ id: 'feature', visibleHeight: 200 }])
    expect(secondChanged).not.toHaveBeenCalled()
    first.reset()
    expect(second.getSnapshot()).toHaveLength(1)
  })
  it('preserves a promoted card height and releases subscriptions on unmount', () => {
    const store = createMobileCardStack()
    const changed = vi.fn()
    const unsubscribe = store.subscribe(changed)
    store.push('feature')
    store.setHeight('feature', 280)
    store.push('table')
    store.push('feature')
    expect(store.getSnapshot()).toEqual([
      { id: 'table', visibleHeight: 0 },
      { id: 'feature', visibleHeight: 280 },
    ])
    unsubscribe()
    changed.mockClear()
    store.remove('feature')
    expect(changed).not.toHaveBeenCalled()
  })
})
