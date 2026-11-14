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

export const paletteShades = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const
/** Tailwind's sky and slate, the references a recoloured shade keeps the luminance of. */
export const paletteReference = {
  tint: [
    '#f0f9ff',
    '#e0f2fe',
    '#bae6fd',
    '#7dd3fc',
    '#38bdf8',
    '#0ea5e9',
    '#0284c7',
    '#0369a1',
    '#075985',
    '#0c4a6e',
    '#082f49',
  ],
  neutral: [
    '#f8fafc',
    '#f1f5f9',
    '#e2e8f0',
    '#cbd5e1',
    '#94a3b8',
    '#64748b',
    '#475569',
    '#334155',
    '#1e293b',
    '#0f172a',
    '#020617',
  ],
} as const

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(colour: string) {
  const { r, g, b } = hsl(colour).rgb()
  return [r, g, b]
    .map((channel) => {
      const v = Math.min(255, Math.max(0, channel)) / 255
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    })
    .reduce((sum, v, index) => sum + v * [0.2126, 0.7152, 0.0722][index], 0)
}

/** The colour of this hue and saturation that is as light as `reference`, as `r g b` channels. */
function shadeLike(reference: string, hue: number, saturation: number) {
  const target = relativeLuminance(reference)
  let low = 0
  let high = 1
  // Luminance rises with lightness at a fixed hue and saturation, so halving the range finds it.
  for (let step = 0; step < 24; step += 1) {
    const middle = (low + high) / 2
    if (relativeLuminance(hsl(hue, saturation, middle).formatHex()) < target) low = middle
    else high = middle
  }
  const { r, g, b } = hsl(hue, saturation, (low + high) / 2).rgb()
  return [r, g, b].map((channel) => Math.round(Math.min(255, Math.max(0, channel)))).join(' ')
}

/**
 * The two ramps behind the fixed Tailwind palette classes pages write their accents and greys in
 * (`text-sky-700`, `focus:ring-cyan-500`, `dark:hover:bg-slate-800/60`; tailwind-theme.mjs in the
 * toolkit). `tint-*` recolours sky, blue, cyan, teal and indigo with the theme's primary, and its
 * fill shades (the pale end in light mode, the deep end in dark) with the highlight; `neutral-*`
 * recolours slate, gray, zinc, neutral and stone in the hue of the theme's surfaces, never more
 * saturated than slate. Every shade keeps its reference's luminance, so text that was readable on
 * a fill stays readable whatever the theme's colours are. A ramp the theme gives no colour for
 * is left out, and those classes keep Tailwind's values.
 */
function paletteRamps(palette: Palette, mode: ThemeMode) {
  const variables: Record<string, string> = {}
  const hueOf = (colour: string) => {
    const { h, s } = hsl(colour)
    return { h: h || 0, s: s || 0 }
  }
  const stroke = palette.primary ?? palette.accent
  if (stroke) {
    const fill = hueOf(palette.accent ?? stroke)
    const line = hueOf(stroke)
    const fillShades: readonly number[] = mode === 'light' ? [50, 100, 200] : [800, 900, 950]
    paletteShades.forEach((shade, index) => {
      const { h, s } = fillShades.includes(shade) ? fill : line
      variables[`tint-${shade}`] = shadeLike(paletteReference.tint[index], h, s)
    })
  }
  const surface = palette.border ?? palette.muted ?? palette.secondary ?? palette.background ?? palette.card
  if (surface) {
    const { h, s } = hueOf(surface)
    // Slate-300, the border grey, is 27% saturated: a theme at least that colourful keeps slate's
    // own saturation at each shade, and a greyer one scales it down, to pure grey at 0.
    const strength = Math.min(1, s / hsl(paletteReference.neutral[3]).s)
    paletteShades.forEach((shade, index) => {
      const reference = paletteReference.neutral[index]
      variables[`neutral-${shade}`] = shadeLike(reference, h, (hsl(reference).s || 0) * strength)
    })
  }
  return variables
}

export function interfaceThemeVariables(theme: InterfaceTheme) {
  const variables: Record<string, string> = {}
  if (theme.radius !== null) variables['--interface-radius'] = `${theme.radius / 16}rem`
  for (const mode of themeModes) {
    const values = { ...paletteVariables(theme[mode], mode), ...paletteRamps(theme[mode], mode) }
    for (const [role, value] of Object.entries(values)) {
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
 * Whether an Appearance theme with colours is applied. For a part that should take the theme's
 * own selection tokens under one, such as a `ResultRow` with its own `accent`: pass
 * `accent={themed ? 'theme' : 'teal'}`. A blue-family accent follows a theme without it, through
 * the palette ramps (`paletteRamps`).
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
