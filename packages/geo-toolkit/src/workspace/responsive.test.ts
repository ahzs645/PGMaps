import { describe, expect, it } from 'vitest'
import { resolveWorkspacePresentation } from './responsive.js'

describe('workspace presentation from measured width', () => {
  it('switches a narrow embed at its configured boundary regardless of device type', () => {
    expect(resolveWorkspacePresentation(420).isMobile).toBe(true)
    expect(resolveWorkspacePresentation(799, 'container', 800).isMobile).toBe(true)
    expect(resolveWorkspacePresentation(800, 'container', 800).isMobile).toBe(false)
    expect(resolveWorkspacePresentation(1200).responsiveAttributes['data-workspace-desktop']).toBe('true')
  })
  it('makes embedded dialogs follow sheets while preserving host viewport sm behavior', () => {
    const embedded = resolveWorkspacePresentation(700, 'container')
    expect(embedded.responsiveAttributes['data-workspace-max-sm']).toBe('true')
    expect(embedded.responsiveAttributes['data-workspace-sm']).toBeUndefined()
    const host = resolveWorkspacePresentation(700, 'viewport')
    expect(host.isMobile).toBe(true)
    expect(host.responsiveAttributes['data-workspace-sm']).toBe('true')
  })
  it('rejects unusable breakpoints rather than creating an inconsistent layout', () => {
    expect(() => resolveWorkspacePresentation(400, 'container', 0)).toThrow(RangeError)
    expect(() => resolveWorkspacePresentation(400, 'container', NaN)).toThrow(RangeError)
  })
})
