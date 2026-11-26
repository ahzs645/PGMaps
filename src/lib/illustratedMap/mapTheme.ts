/**
 * A map theme: the illustrated map's look as one file to keep, share and import. It holds the
 * hatch (a saved `OrganicHatchRecipe`), the map's settings (coverage, labels, channel gap, lakes,
 * the smallest islands and lakes, hidden road stretches, compass lettering) and the fonts it is
 * lettered in, with the font files themselves.
 *
 * On disk a theme is a ZIP: `theme.json`, its fonts under `fonts/`, and a `README.txt` with each
 * font's licence note. Reading one checks every path, size, checksum and font signature before a
 * font is parsed; nothing in it is run. No DOM or network access.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { z } from 'zod'
import { organicHatchRecipe, parseOrganicHatchRecipe, type OrganicHatchRecipe } from '@pgmaps/geo-toolkit/patterns'
import type { GeographicMapOptions } from './geographic'
import type { HatchOptions, PatchHatchStyleOptions } from './hatching'
import type { LetteringFont } from './lettering'
import { fontFormat, letteringFontFromBytes } from './letteringFont'

export const MAP_THEME_TYPE = 'pgmaps-map-theme'
export const MAP_THEME_VERSION = 1
export const MAP_THEME_LIMITS = Object.freeze({
  zipBytes: 40 * 1024 * 1024,
  expandedBytes: 60 * 1024 * 1024,
  fontBytes: 12 * 1024 * 1024,
  fonts: 12,
})

const fontSchema = z.strictObject({
  /** How the theme's lettering names this font. */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,47}$/),
  file: z.string().regex(/^fonts\/[A-Za-z0-9._-]{1,120}\.(?:ttf|otf|woff)$/),
  /** The font's family name, as text set in it is styled (`body`) and as people know it. */
  family: z.string().min(1).max(120),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** Its lowercase are capital-shaped alternates (Great Forest Simplified). */
  capitalAlternates: z.boolean().optional(),
  /** Copyright and licence, as the font's owner states them. */
  licence: z.string().max(4000).optional(),
})

const mapSchema = z.strictObject({
  coverage: z.enum(['coastal', 'northern', 'province', 'page8']).optional(),
  labelSet: z.enum(['all', 'page8']).optional(),
  channelGap: z.number().min(0).max(3).optional(),
  lakes: z.boolean().optional(),
  minIslandKm2: z.number().min(0).max(1000).optional(),
  minLakeKm2: z.number().min(0).max(1000).optional(),
  hiddenRoads: z
    .array(z.strictObject({ road: z.string().min(1).max(40), landmassOf: z.string().min(1).max(80) }))
    .max(20)
    .optional(),
  compassLettering: z.enum(['badge', 'smallcaps']).optional(),
  vectorMasks: z.boolean().optional(),
})

const themeSchema = z.strictObject({
  type: z.literal(MAP_THEME_TYPE),
  version: z.literal(MAP_THEME_VERSION),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional(),
  hatch: z.unknown(),
  map: mapSchema,
  fonts: z.array(fontSchema).max(MAP_THEME_LIMITS.fonts),
  /** Which font letters what, by font id; absent roles use the built-in Great Forest (or Arial). */
  lettering: z.strictObject({
    places: z.string().optional(),
    regions: z.string().optional(),
    body: z.string().optional(),
  }),
})

export type MapThemeFont = z.infer<typeof fontSchema>
export type MapThemeMap = z.infer<typeof mapSchema>
export type MapTheme = Omit<z.infer<typeof themeSchema>, 'hatch'> & { hatch: OrganicHatchRecipe }
export type MapThemeRole = keyof MapTheme['lettering']

/** A theme's JSON, checked: its shape, its hatch recipe, unique fonts, and lettering that names them. */
export function parseMapTheme(value: unknown): MapTheme {
  const result = themeSchema.safeParse(value)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw new Error(`The map theme is not valid at ${issue.path.join('.') || 'its top level'}: ${issue.message}`)
  }
  const theme = result.data
  const hatch = parseOrganicHatchRecipe(theme.hatch, 'The theme’s hatch')
  const ids = new Set<string>()
  const files = new Set<string>()
  for (const font of theme.fonts) {
    if (ids.has(font.id)) throw new Error(`The theme lists the font ${font.id} twice.`)
    if (files.has(font.file.toLowerCase())) throw new Error(`The theme lists ${font.file} twice.`)
    ids.add(font.id)
    files.add(font.file.toLowerCase())
  }
  for (const [role, id] of Object.entries(theme.lettering))
    if (id !== undefined && !ids.has(id))
      throw new Error(`The theme letters ${role} in ${id}, which it does not include.`)
  return { ...theme, hatch }
}

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((n) => n.toString(16).padStart(2, '0')).join('')
export const sha256 = async (bytes: Uint8Array) =>
  hex(await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer))

/** A font file's problem as a theme font, or null: its kind and size, and whether it reads. */
export function themeFontProblem(bytes: Uint8Array, file: string): string | null {
  if (bytes.byteLength > MAP_THEME_LIMITS.fontBytes) return `${file} is larger than 12 MB.`
  const format = fontFormat(bytes)
  if (!format) return `${file} is not a TrueType, OpenType or WOFF font.`
  if (format === 'woff2') return `${file} is WOFF2, which the map cannot read; include the TTF, OTF or WOFF.`
  const extension = file.toLowerCase().split('.').pop()
  const expected = { truetype: 'ttf', opentype: 'otf', woff: 'woff' }[format]
  if (extension !== expected) return `${file} is a ${format} font; name it .${expected}.`
  try {
    letteringFontFromBytes(bytes)
  } catch (error) {
    return `${file} could not be read as a font: ${(error as Error).message}`
  }
  return null
}

/** A theme as files: its JSON, and its fonts' bytes by font id. */
export interface MapThemeFiles {
  theme: MapTheme
  fonts: Map<string, Uint8Array>
}

const readme = (theme: MapTheme) =>
  [
    `${theme.name}: a PGMaps map theme.`,
    '',
    theme.description ?? '',
    '',
    'theme.json holds the hatch, the map settings and which font letters what. fonts/ holds the font files.',
    "Each font keeps its owner's copyright and licence; they are noted below as the theme was saved.",
    '',
    ...theme.fonts.flatMap((font) => [`${font.file} (${font.family})`, `  ${font.licence ?? 'No licence note.'}`, '']),
  ].join('\n')

/**
 * Write a theme as a ZIP. Each font's checksum is worked out from its bytes, so the JSON cannot
 * name a file other than the one beside it.
 */
export async function writeMapTheme(
  theme: Omit<MapTheme, 'fonts'> & { fonts: (Omit<MapThemeFont, 'sha256'> & { bytes: Uint8Array })[] },
): Promise<Uint8Array> {
  const fonts: MapThemeFont[] = []
  const members: Record<string, Uint8Array> = {}
  for (const { bytes, ...font } of theme.fonts) {
    const problem = themeFontProblem(bytes, font.file)
    if (problem) throw new Error(problem)
    fonts.push({ ...font, sha256: await sha256(bytes) })
    members[font.file] = bytes
  }
  const checked = parseMapTheme({ ...theme, fonts })
  members['theme.json'] = strToU8(JSON.stringify(checked, null, 2) + '\n')
  members['README.txt'] = strToU8(readme(checked))
  // Fonts are already compressed (or close to it); store them, deflate the text.
  return zipSync(
    Object.fromEntries(
      Object.entries(members).map(([path, data]) => [path, [data, { level: path.startsWith('fonts/') ? 0 : 6 }]]),
    ),
  )
}

/** Read a theme ZIP: only `theme.json`, `README.txt` and `fonts/…` are read, within the size limits. */
export async function readMapTheme(bytes: Uint8Array): Promise<MapThemeFiles> {
  if (bytes.byteLength > MAP_THEME_LIMITS.zipBytes) throw new Error('Choose a map theme smaller than 40 MB.')
  let expanded = 0
  let members: Record<string, Uint8Array>
  try {
    members = unzipSync(bytes, {
      filter: (file) => {
        if (file.name.endsWith('/')) return false
        if (file.name.includes('..') || file.name.startsWith('/') || file.name.includes('\\'))
          throw new Error(`The theme has an unsafe path: ${file.name}`)
        const wanted = file.name === 'theme.json' || file.name === 'README.txt' || file.name.startsWith('fonts/')
        if (!wanted) return false
        expanded += file.originalSize
        if (file.originalSize > MAP_THEME_LIMITS.fontBytes || expanded > MAP_THEME_LIMITS.expandedBytes)
          throw new Error('The theme expands beyond the map theme limits.')
        return true
      },
    })
  } catch (error) {
    const message = (error as Error).message
    throw new Error(message.startsWith('The theme') ? message : `This is not a map theme ZIP (${message}).`)
  }
  const json = members['theme.json']
  if (!json) throw new Error('The ZIP has no theme.json, so it is not a map theme.')
  let value: unknown
  try {
    value = JSON.parse(strFromU8(json))
  } catch {
    throw new Error('The theme’s theme.json is not JSON.')
  }
  const theme = parseMapTheme(value)
  const fonts = new Map<string, Uint8Array>()
  for (const font of theme.fonts) {
    const data = members[font.file]
    if (!data) throw new Error(`The theme lists ${font.file}, but the ZIP does not have it.`)
    if ((await sha256(data)) !== font.sha256) throw new Error(`${font.file} is not the file the theme was saved with.`)
    const problem = themeFontProblem(data, font.file)
    if (problem) throw new Error(problem)
    fonts.set(font.id, data)
  }
  return { theme, fonts }
}

const MIME = { truetype: 'font/ttf', opentype: 'font/otf', woff: 'font/woff' } as const
const base64 = (bytes: Uint8Array) => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** The workshop's hatch settings as a saved recipe, and back. */
export function hatchRecipeFromSettings(
  style: 'contour' | 'patch',
  hatch: HatchOptions,
  patchHatch: PatchHatchStyleOptions,
  color: string,
): OrganicHatchRecipe {
  if (style === 'patch') {
    const { patchSize, lean, leanBias, seam, ...rest } = patchHatch
    return organicHatchRecipe({ style: 'patch', ...rest, patch: { patchSize, lean, leanBias, seam }, color })
  }
  return organicHatchRecipe({ ...hatch, color })
}

export function hatchSettingsFromRecipe(recipe: OrganicHatchRecipe): {
  hatchStyle: 'contour' | 'patch'
  hatch?: HatchOptions
  patchHatch?: PatchHatchStyleOptions
} {
  const { seed, spacing, bandHeight, strokeWidth, curvature } = recipe
  const field = { seed, spacing, bandHeight, strokeWidth, curvature }
  return recipe.style === 'patch' && recipe.patch
    ? { hatchStyle: 'patch', patchHatch: { ...field, ...recipe.patch } }
    : { hatchStyle: 'contour', hatch: field }
}

/**
 * What a theme sets on the geographic map, with its fonts read: the map settings, the hatch, and
 * the lettering fonts (outlined) and body font (embedded).
 */
export function mapThemeOptions(
  { theme, fonts }: MapThemeFiles,
  read: (id: string) => LetteringFont = (id) => {
    const font = theme.fonts.find((candidate) => candidate.id === id)!
    return letteringFontFromBytes(fonts.get(id)!, { name: font.family, capitalAlternates: font.capitalAlternates })
  },
): GeographicMapOptions {
  const { places, regions, body } = theme.lettering
  const bodyFont = body ? theme.fonts.find((font) => font.id === body) : undefined
  const bodyBytes = body ? fonts.get(body) : undefined
  const bodyFormat = bodyBytes ? fontFormat(bodyBytes) : null
  const hatch = hatchSettingsFromRecipe(theme.hatch)
  return {
    ...theme.map,
    ...hatch,
    lettering: {
      ...(places ? { places: read(places) } : {}),
      ...(regions ? { regions: read(regions) } : {}),
      ...(bodyFont && bodyBytes && bodyFormat && bodyFormat !== 'woff2'
        ? { body: { family: bodyFont.family, src: `data:${MIME[bodyFormat]};base64,${base64(bodyBytes)}` } }
        : {}),
    },
  }
}
