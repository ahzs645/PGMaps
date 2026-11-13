import { useSyncExternalStore } from 'react'
import { hsl, interpolateRgb } from 'd3'
import { normalizeHexColor } from '@/components/ui/color-field'
import { paletteContrast } from '@/lib/paletteScale'

export const themeModes = ['light', 'dark'] as const
export type ThemeMode = (typeof themeModes)[number]
export const themeRoles = [
  ['primary', 'Primary'],
  ['accent', 'Highlight'],
  ['background', 'Page'],
  ['card', 'Card'],
  ['popover', 'Popover'],
  ['secondary', 'Secondary'],
  ['muted', 'Muted'],
  ['border', 'Border'],
] as const
export type ThemeRole = (typeof themeRoles)[number][0]
type Palette = Partial<Record<ThemeRole, string>>
export type InterfaceTheme = Record<ThemeMode, Palette> & { radius: number | null }

const storageKey = 'pgmaps-interface-colours-v1'
export const radiusLimits = { min: 4, max: 24 } as const
export const defaultInterfaceTheme: InterfaceTheme = { light: {}, dark: {}, radius: null }
export const themePresets: Record<string, InterfaceTheme> = {
  'PGMaps default': defaultInterfaceTheme,
  Forest: {
    light: {
      primary: '#216447',
      accent: '#dcece1',
      background: '#f4f7f2',
      card: '#ffffff',
      secondary: '#e4ede6',
      muted: '#ebf1ec',
      border: '#d2dfd5',
    },
    dark: {
      primary: '#91d2a8',
      accent: '#264b39',
      background: '#101d18',
      card: '#182822',
      secondary: '#22382d',
      muted: '#1d2f27',
      border: '#385146',
    },
    radius: 14,
  },
  Coast: {
    light: {
      primary: '#185c91',
      accent: '#daeaf8',
      background: '#f2f7fb',
      card: '#ffffff',
      secondary: '#e2ecf5',
      muted: '#e9f0f6',
      border: '#ccdce8',
    },
    dark: {
      primary: '#90c7f5',
      accent: '#233c56',
      background: '#101c2a',
      card: '#18283a',
      secondary: '#20334a',
      muted: '#1c2c3d',
      border: '#334d65',
    },
    radius: 10,
  },
  Violet: {
    light: {
      primary: '#6542a6',
      accent: '#eae0f9',
      background: '#f8f5fc',
      card: '#ffffff',
      secondary: '#ebe4f5',
      muted: '#f0ebf7',
      border: '#e0d5ed',
    },
    dark: {
      primary: '#c9adff',
      accent: '#41315e',
      background: '#1a1525',
      card: '#251d34',
      secondary: '#31264a',
      muted: '#2a2139',
      border: '#4b3b64',
    },
    radius: 18,
  },
}

export function readInterfaceTheme(): InterfaceTheme {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? 'null')
    if (!saved || typeof saved !== 'object') return defaultInterfaceTheme
    const { light, dark, radius } = saved as Record<string, unknown>
    const theme: InterfaceTheme = { light: {}, dark: {}, radius: null }
    for (const [mode, palette] of [
      ['light', light],
      ['dark', dark],
    ] as const) {
      if (!palette || typeof palette !== 'object') continue
      for (const [role] of themeRoles) {
        const colour = (palette as Record<string, unknown>)[role]
        const hex = typeof colour === 'string' ? normalizeHexColor(colour) : null
        if (hex) theme[mode][role] = hex
      }
    }
    if (
      typeof radius === 'number' &&
      Number.isInteger(radius) &&
      radius >= radiusLimits.min &&
      radius <= radiusLimits.max
    )
      theme.radius = radius
    return theme
  } catch {
    return defaultInterfaceTheme
  }
}

const triplet = (h: number, s: number, l: number) =>
  `${Number((h || 0).toFixed(4))} ${Number(((s || 0) * 100).toFixed(4))}% ${Number((l * 100).toFixed(4))}%`

function paletteVariables(palette: Palette, mode: ThemeMode) {
  const variables: Record<string, string> = {}
  for (const [role] of themeRoles) {
    const colour = palette[role]
    if (!colour) continue
    const { h, s, l } = hsl(colour)
    variables[role] = triplet(h, s, l)
    // `muted-foreground` is the hint-text grey, not text on a muted fill: deriving it as black or
    // white from the muted colour turned every hint and caption full strength. It keeps its default.
    if (role !== 'border' && role !== 'muted') {
      const foreground = paletteContrast('#000000', colour) >= paletteContrast('#ffffff', colour) ? 0 : 100
      variables[role === 'background' ? 'foreground' : `${role}-foreground`] = `0 0% ${foreground}%`
    }
  }
  // A dialog takes the popover colour (or the card's). Its boxes and the tracks on them step away
  // from it in the surface's own hue: lighter on a dark surface, a faint well on a light one.
  const surface = palette.popover ?? palette.card
  if (surface) {
    const { h, s, l } = hsl(surface)
    const step = l < 0.5 ? 0.04 : -0.02
    variables.raised = triplet(h, s, l + step)
    variables['raised-muted'] = triplet(h, s, l + step * 2)
  }
  if (variables.primary) variables.ring = variables.primary
  if (variables.border) variables.input = variables.border
  Object.assign(variables, stateVariables(palette, mode))
  return variables
}

/**
 * The toolkit's UI-state tokens (a selected result row, text links, the band round a map), which
 * default to fixed sky and slate. A selected row takes the theme's highlight, solid in both modes,
 * with an edge part-way to its primary; links and the focus ring take the primary; the map surround
 * is a step below the page. A role the theme leaves unset keeps the toolkit default.
 */
function stateVariables(palette: Palette, mode: ThemeMode) {
  const variables: Record<string, string> = {}
  const channels = (colour: string, lightnessStep = 0) => {
    const { h, s, l } = hsl(colour)
    return triplet(h, s, Math.min(1, Math.max(0, l + lightnessStep)))
  }
  const { primary, accent, background, card } = palette
  // Without a highlight colour, a faint wash of the primary over the card stands in for one.
  const surface = card ?? background ?? (mode === 'light' ? '#ffffff' : '#171717')
  const fill = accent ?? (primary ? interpolateRgb(surface, primary)(mode === 'light' ? 0.1 : 0.2) : undefined)
  if (fill) {
    variables.selected = channels(fill)
    variables['selected-alpha'] = '1'
    variables['selected-border'] = primary
      ? channels(interpolateRgb(fill, primary)(0.45))
      : channels(fill, mode === 'light' ? -0.15 : 0.15)
  }
  if (primary) {
    variables['selected-focus'] = channels(primary)
    variables.link = channels(primary)
    variables['link-hover'] = channels(primary, mode === 'light' ? -0.08 : 0.08)
  }
  if (background) variables['map-surround'] = channels(background, mode === 'light' ? -0.04 : -0.015)
  return variables
}

export function interfaceThemeVariables(theme: InterfaceTheme) {
  const variables: Record<string, string> = {}
  if (theme.radius !== null) variables['--interface-radius'] = `${theme.radius / 16}rem`
  for (const mode of themeModes) {
    for (const [role, value] of Object.entries(paletteVariables(theme[mode], mode))) {
      variables[`--interface-${mode}-${role}`] = value
    }
  }
  return variables
}

export function exportThemeCss(theme: InterfaceTheme, defaultRadius: number) {
  const rules = themeModes.map((mode) => {
    const declarations = Object.entries(paletteVariables(theme[mode], mode)).map(([role, value]) =>
      // An alpha is a bare number, not a colour.
      role.endsWith('-alpha') ? `  --${role}: ${value};` : `  --${role}: hsl(${value});`,
    )
    if (mode === 'light') declarations.push(`  --radius: ${(theme.radius ?? defaultRadius) / 16}rem;`)
    return `${mode === 'light' ? ':root' : '.dark'} {\n${declarations.join('\n')}\n}`
  })
  return rules.join('\n\n') + '\n'
}

function applyInterfaceTheme(theme: InterfaceTheme) {
  const style = document.documentElement.style
  // Remove old values first so resetting one role restores its CSS fallback.
  for (const property of Array.from(style)) {
    if (property.startsWith('--interface-')) style.removeProperty(property)
  }
  for (const [property, value] of Object.entries(interfaceThemeVariables(theme))) style.setProperty(property, value)
  // Opts into the theme-only surface rules in index.css (fields on a card take the card colour,
  // a selected card takes the highlight). The built-in theme leaves them off and looks as before.
  document.documentElement.toggleAttribute('data-interface-theme', isCustomTheme(theme))
  for (const listener of themeListeners) listener()
}

const themeListeners = new Set<() => void>()

/**
 * Whether an Appearance theme with colours is applied. For a part that keeps a fixed palette in
 * the built-in theme but should take the theme's colours under one, such as a `ResultRow` with its
 * own `accent`: pass `accent={themed ? 'theme' : 'teal'}`.
 */
export function useInterfaceThemeApplied() {
  return useSyncExternalStore(
    (listener) => {
      themeListeners.add(listener)
      return () => themeListeners.delete(listener)
    },
    () => document.documentElement.hasAttribute('data-interface-theme'),
    () => false,
  )
}

/** Whether a theme sets any colour; a radius alone changes no surface. */
export const isCustomTheme = (theme: InterfaceTheme) => themeModes.some((mode) => Object.keys(theme[mode]).length > 0)

export function saveInterfaceTheme(theme: InterfaceTheme) {
  window.localStorage.setItem(storageKey, JSON.stringify(theme))
  applyInterfaceTheme(theme)
}

export function initializeInterfaceTheme() {
  applyInterfaceTheme(readInterfaceTheme())
  window.addEventListener('storage', (event) => {
    if (event.key === storageKey || event.key === null) applyInterfaceTheme(readInterfaceTheme())
  })
}
