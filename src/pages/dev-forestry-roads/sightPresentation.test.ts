import { describe, expect, it, vi } from 'vitest'
import { stationRowProps } from './sightPresentation'

describe('sight table rows', () => {
  it('are reachable with Tab and select their station with Enter or Space, as with a click', () => {
    const select = vi.fn()
    const row = stationRowProps(select)
    expect(row.tabIndex).toBe(0)
    const key = (k: string) => {
      const preventDefault = vi.fn()
      row.onKeyDown({ key: k, preventDefault })
      return preventDefault
    }
    expect(key('Enter')).toHaveBeenCalled()
    expect(key(' ')).toHaveBeenCalled()
    // Other keys, such as the arrows that scroll the table, are left alone.
    expect(key('ArrowDown')).not.toHaveBeenCalled()
    row.onClick()
    expect(select).toHaveBeenCalledTimes(3)
  })
})
