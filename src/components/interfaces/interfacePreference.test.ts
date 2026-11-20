import { describe, expect, it } from 'vitest'
import { initialInterfaceId } from './interfacePreference'

const layouts = [{ id: 'ribbon' }, { id: 'guided' }, { id: 'workbench' }]

describe('initialInterfaceId', () => {
  it("opens the tool's default when nothing was chosen", () => {
    expect(initialInterfaceId(layouts, '', null, 'ribbon')).toBe('ribbon')
    expect(initialInterfaceId(layouts, '', null, 'guided')).toBe('guided')
  })

  it('reopens the interface this browser last used', () => {
    expect(initialInterfaceId(layouts, '?example=training', 'guided', 'ribbon')).toBe('guided')
  })

  it('lets a shared link name the interface', () => {
    expect(initialInterfaceId(layouts, '?interface=ribbon&example=training', 'guided', 'ribbon')).toBe('ribbon')
  })

  it('ignores interfaces the served layouts no longer list', () => {
    expect(initialInterfaceId(layouts, '?interface=retired', 'gone', 'ribbon')).toBe('ribbon')
    expect(initialInterfaceId([{ id: 'custom' }], '', 'gone', 'ribbon')).toBe('custom')
  })
})
