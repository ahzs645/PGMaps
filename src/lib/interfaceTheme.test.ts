import { describe, expect, it } from 'vitest'

import { defaultInterfaceTheme, interfaceThemeVariables, isCustomTheme, themePresets } from './interfaceTheme'

describe('interface theme', () => {
  it('counts a theme as custom only when it sets a colour', () => {
    expect(isCustomTheme(defaultInterfaceTheme)).toBe(false)
    expect(isCustomTheme({ ...defaultInterfaceTheme, radius: 12 })).toBe(false)
    expect(isCustomTheme({ light: { card: '#ffffff' }, dark: {}, radius: null })).toBe(true)
    expect(isCustomTheme({ light: {}, dark: { primary: '#90c7f5' }, radius: null })).toBe(true)
  })

  it('keeps the hint-text grey when a theme sets a muted colour', () => {
    const variables = interfaceThemeVariables({ light: { muted: '#e9f0f6' }, dark: {}, radius: null })
    expect(variables['--interface-light-muted']).toBeDefined()
    expect(variables['--interface-light-muted-foreground']).toBeUndefined()
  })

  it('gives every preset muted and secondary colours in both modes', () => {
    for (const [name, theme] of Object.entries(themePresets)) {
      if (!isCustomTheme(theme)) continue
      for (const mode of ['light', 'dark'] as const) {
        expect(theme[mode].muted, `${name} ${mode} muted`).toMatch(/^#[0-9a-f]{6}$/)
        expect(theme[mode].secondary, `${name} ${mode} secondary`).toMatch(/^#[0-9a-f]{6}$/)
      }
    }
  })
})
