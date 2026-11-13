import { describe, expect, it } from 'vitest'

import {
  defaultInterfaceTheme,
  exportThemeCss,
  interfaceThemeVariables,
  isCustomTheme,
  themePresets,
} from './interfaceTheme'

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

  it('leaves the toolkit selection, link and map surround colours alone without a theme', () => {
    const names = Object.keys(interfaceThemeVariables(defaultInterfaceTheme))
    expect(names.filter((name) => /selected|link|map-surround/.test(name))).toEqual([])
  })

  it('derives selection, links and the map surround from every preset in both modes', () => {
    for (const [name, theme] of Object.entries(themePresets)) {
      if (!isCustomTheme(theme)) continue
      const variables = interfaceThemeVariables(theme)
      for (const mode of ['light', 'dark'] as const) {
        for (const role of ['selected', 'selected-border', 'selected-focus', 'link', 'link-hover', 'map-surround']) {
          expect(variables[`--interface-${mode}-${role}`], `${name} ${mode} ${role}`).toMatch(
            /^[\d.]+ [\d.]+% [\d.]+%$/,
          )
        }
        // A theme's selected fill is solid, where the default dark tint is sky at 30%.
        expect(variables[`--interface-${mode}-selected-alpha`]).toBe('1')
        expect(variables[`--interface-${mode}-link`]).toBe(variables[`--interface-${mode}-primary`])
      }
    }
  })

  it('stands in a wash of the primary for a theme with no highlight colour', () => {
    const variables = interfaceThemeVariables({ light: { primary: '#216447' }, dark: {}, radius: null })
    expect(variables['--interface-light-selected']).toBeDefined()
    expect(variables['--interface-dark-selected']).toBeUndefined()
  })

  it('writes an alpha as a bare number in exported CSS', () => {
    const css = exportThemeCss(themePresets.Forest, 8)
    expect(css).toContain('  --selected-alpha: 1;')
    expect(css).not.toMatch(/hsl\(1\)/)
  })
})
