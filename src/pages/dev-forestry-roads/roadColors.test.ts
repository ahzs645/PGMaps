import { describe, expect, it } from 'vitest'
import { distinctRoadColors } from './roadColors'

describe('distinctRoadColors', () => {
  it('separates roads saved with one colour and avoids the colours that mean something else', () => {
    const colors = distinctRoadColors([
      { id: 'a', color: '#d97706' },
      { id: 'b', color: '#2563eb' },
      { id: 'c', color: '#d97706' },
      { id: 'd', color: '#2563eb' },
    ])
    expect(colors.get('b')).toBe('#2563eb')
    expect(new Set(colors.values()).size).toBe(4)
    expect([...colors.values()]).not.toContain('#d97706')
  })
})
