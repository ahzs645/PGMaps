import { describe, expect, it } from 'vitest'
import { initialInterfaceId } from './interfacePreference'

const layouts = [{ id: 'ribbon' }, { id: 'guided' }, { id: 'workbench' }]

describe('initialInterfaceId', () => {
  it('opens the workbench when nothing was chosen', () => {
    expect(initialInterfaceId(layouts, '', null)).toBe('workbench')
  })

  it('reopens the interface this browser last used', () => {
    expect(initialInterfaceId(layouts, '?example=training', 'guided')).toBe('guided')
  })

  it('lets a shared link name the interface', () => {
    expect(initialInterfaceId(layouts, '?interface=ribbon&example=training', 'guided')).toBe('ribbon')
  })

  it('ignores interfaces the served layouts no longer list', () => {
    expect(initialInterfaceId(layouts, '?interface=retired', 'gone')).toBe('workbench')
    expect(initialInterfaceId([{ id: 'custom' }], '', 'gone')).toBe('custom')
  })
})
