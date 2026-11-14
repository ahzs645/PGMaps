import { describe, expect, it } from 'vitest'

import colors from 'tailwindcss/colors'
import {
  defaultInterfaceTheme,
  exportThemeCss,
  interfaceThemeVariables,
  isCustomTheme,
  paletteReference,
  paletteShades,
  relativeLuminance,
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

  describe('palette ramps', () => {
    const hexOf = (channels: string) =>
      '#' +
      channels
        .split(' ')
        .map((channel) => Number(channel).toString(16).padStart(2, '0'))
        .join('')
    const contrast = (a: string, b: string) => {
      const [high, low] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
      return (high + 0.05) / (low + 0.05)
    }

    it("measures against Tailwind's sky and slate", () => {
      paletteShades.forEach((shade, index) => {
        expect(paletteReference.tint[index]).toBe(colors.sky[shade])
        expect(paletteReference.neutral[index]).toBe(colors.slate[shade])
      })
    })

    it("leaves the palette classes on Tailwind's colours without a theme", () => {
      const names = Object.keys(interfaceThemeVariables({ ...defaultInterfaceTheme, radius: 12 }))
      expect(names.filter((name) => /tint|neutral/.test(name))).toEqual([])
    })

    it('recolours only the ramp a theme gives a colour for', () => {
      const accentOnly = Object.keys(interfaceThemeVariables({ light: { primary: '#216447' }, dark: {}, radius: null }))
      expect(accentOnly.filter((name) => name.startsWith('--interface-light-tint-'))).toHaveLength(11)
      expect(accentOnly.filter((name) => /neutral|dark-tint/.test(name))).toEqual([])
      const surfaceOnly = Object.keys(interfaceThemeVariables({ light: {}, dark: { border: '#385146' }, radius: null }))
      expect(surfaceOnly.filter((name) => name.startsWith('--interface-dark-neutral-'))).toHaveLength(11)
      expect(surfaceOnly.filter((name) => /tint|light-neutral/.test(name))).toEqual([])
    })

    it('keeps each shade as light as the shade it replaces, in every preset', () => {
      for (const [name, theme] of Object.entries(themePresets)) {
        if (!isCustomTheme(theme)) continue
        const variables = interfaceThemeVariables(theme)
        for (const mode of ['light', 'dark'] as const) {
          for (const ramp of ['tint', 'neutral'] as const) {
            paletteShades.forEach((shade, index) => {
              const value = variables[`--interface-${mode}-${ramp}-${shade}`]
              expect(value, `${name} ${mode} ${ramp}-${shade}`).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/)
              const reference = paletteReference[ramp][index]
              // Text that read on a fill before still reads: the pair's contrast moves under 3%.
              expect(contrast(hexOf(value), reference), `${name} ${mode} ${ramp}-${shade}`).toBeLessThan(1.03)
            })
          }
        }
      }
    })

    it("takes the primary's hue for the tint and the surfaces' hue for the greys", () => {
      const hue = (channels: string) => {
        const [r, g, b] = channels.split(' ').map(Number)
        return [r, g, b].indexOf(Math.max(r, g, b))
      }
      const variables = interfaceThemeVariables(themePresets.Forest)
      // Forest is green: green leads in a link shade, a selected fill and a dark hover grey.
      expect(hue(variables['--interface-light-tint-700'])).toBe(1)
      expect(hue(variables['--interface-light-tint-50'])).toBe(1)
      expect(hue(variables['--interface-dark-tint-300'])).toBe(1)
      expect(hue(variables['--interface-dark-neutral-800'])).toBe(1)
    })

    it('turns the greys neutral for a theme whose surfaces are grey', () => {
      const variables = interfaceThemeVariables({ light: { border: '#dddddd' }, dark: {}, radius: null })
      const [r, g, b] = variables['--interface-light-neutral-500'].split(' ').map(Number)
      expect(r).toBe(g)
      expect(g).toBe(b)
    })

    it('keeps the ramps out of the exported shadcn variables', () => {
      expect(exportThemeCss(themePresets.Coast, 8)).not.toMatch(/tint|neutral/)
    })
  })
})
