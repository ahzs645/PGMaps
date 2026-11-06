import { describe, expect, it } from 'vitest'
import { panelsEdited, presetHiddenPanels } from './RoadPaneLayout'
import { resolveLayout } from './LayoutPicker'

describe('road layout presets', () => {
  it('treats a preset as unedited in any order', () => {
    expect(panelsEdited('plan', ['detail', 'profile'])).toBe(false)
    expect(panelsEdited('linked', presetHiddenPanels('linked'))).toBe(false)
  })
  it('notices panels opened or closed in a preset', () => {
    expect(panelsEdited('plan', [])).toBe(true)
    expect(panelsEdited('linked', ['detail'])).toBe(true)
    expect(panelsEdited('split', ['profile'])).toBe(true)
  })
  it('counts the data panel only where the layout has one', () => {
    expect(panelsEdited('linked', ['data'])).toBe(false)
    expect(panelsEdited('engineering', ['data'])).toBe(true)
  })
  it('falls back to a real preset for a deleted saved layout', () => {
    expect(resolveLayout('saved:gone', [])).toEqual({ base: 'linked', storageId: 'linked', selection: 'linked' })
  })
})
