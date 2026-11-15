/**
 * Map styles kept in this browser for the road tool's styled exports: symbols read from QGIS,
 * ArcGIS Pro, SLD, MapLibre or GeoLibre files, and which exported feature each one draws. A saved
 * style never reaches the project file, the catalogue or another browser; the exports and their
 * preview are the only places it is used, and every file that used one says so in its README.
 * No DOM or network access; `StyleLibraryPanel.tsx` reads and writes browser storage.
 */
import { checkedSheetSymbol } from '@/lib/styleExchange/checkedSymbol'
import type { ExchangeFormat } from '@/lib/styleExchange/model'
import type { SheetSymbol } from '@/lib/mapSheet/symbols'
import { CULVERT_COLOR, deactivatedRoadSymbol, STATION_COLOR } from './exportStyles'
import { PLAN_SHEET_SYMBOLS, type PlanSheetKey } from './planSheetSymbols'

export const ROAD_STYLE_LIBRARY_SCHEMA = 'pgmaps-road-style-library-v1'
export const MAX_SAVED_STYLES = 200

/** An exported feature an imported symbol can draw. */
export type StyleRole = PlanSheetKey | 'culvert' | 'station'

export const STYLE_ROLES: readonly { role: StyleRole; label: string; kind: SheetSymbol['kind'] }[] = [
  { role: 'stream', label: 'Streams', kind: 'line' },
  { role: 'ncd', label: 'NCD streams', kind: 'line' },
  { role: 'fsr', label: 'Forest service roads', kind: 'line' },
  { role: 'existingRoad', label: 'Existing roads', kind: 'line' },
  { role: 'deactivated', label: 'Deactivated roads', kind: 'line' },
  { role: 'constraint', label: 'Constraint areas', kind: 'area' },
  { role: 'otherBlock', label: 'Other blocks', kind: 'area' },
  { role: 'riparianReserve', label: 'Riparian reserve zones', kind: 'area' },
  { role: 'riparianManagement', label: 'Riparian management zones', kind: 'area' },
  { role: 'culvert', label: 'Culverts', kind: 'line' },
  { role: 'station', label: 'Stations', kind: 'point' },
]
const ROLE_IDS = new Set<string>(STYLE_ROLES.map((entry) => entry.role))

export interface SavedStyle {
  id: string
  name: string
  /** The file it was read from, and its format. */
  fileName: string
  format: ExchangeFormat
  /** ISO date it was saved. */
  savedOn: string
  symbol: SheetSymbol
  /** What the reader approximated when it read this symbol. */
  notes: string[]
}

export interface RoadStyleLibrary {
  schema: typeof ROAD_STYLE_LIBRARY_SCHEMA
  styles: SavedStyle[]
  /** Saved style id each role draws with; a role not listed keeps PGMaps' own symbol. */
  roles: Partial<Record<StyleRole, string>>
}

export const emptyRoadStyleLibrary = (): RoadStyleLibrary => ({
  schema: ROAD_STYLE_LIBRARY_SCHEMA,
  styles: [],
  roles: {},
})

const text = (value: unknown, max: number, what: string) => {
  if (typeof value !== 'string' || value.length > max) throw Error(`${what} must be text of at most ${max} characters.`)
  return value
}

/** Reads a stored library, dropping any style or role that no longer checks, rather than all of it. */
export function parseRoadStyleLibrary(raw: unknown): RoadStyleLibrary {
  if (!raw || typeof raw !== 'object' || (raw as Record<string, unknown>).schema !== ROAD_STYLE_LIBRARY_SCHEMA)
    throw Error(`Use a ${ROAD_STYLE_LIBRARY_SCHEMA} style library.`)
  const value = raw as Record<string, unknown>
  const styles: SavedStyle[] = []
  for (const entry of Array.isArray(value.styles) ? value.styles.slice(0, MAX_SAVED_STYLES) : []) {
    try {
      const style = entry as Record<string, unknown>
      styles.push({
        id: text(style.id, 100, 'An id'),
        name: text(style.name, 200, 'A name'),
        fileName: text(style.fileName, 300, 'A file name'),
        format: text(style.format, 20, 'A format') as ExchangeFormat,
        savedOn: text(style.savedOn, 40, 'A date'),
        symbol: checkedSheetSymbol(style.symbol),
        notes: Array.isArray(style.notes)
          ? style.notes.filter((n): n is string => typeof n === 'string').slice(0, 50)
          : [],
      })
    } catch {
      // A damaged entry is skipped; the rest of the library still loads.
    }
  }
  const ids = new Set(styles.map((style) => style.id))
  const roles: RoadStyleLibrary['roles'] = {}
  const rawRoles = value.roles && typeof value.roles === 'object' ? (value.roles as Record<string, unknown>) : {}
  for (const [role, id] of Object.entries(rawRoles))
    if (ROLE_IDS.has(role) && typeof id === 'string' && ids.has(id)) {
      const style = styles.find((s) => s.id === id)!
      if (roleKind(role as StyleRole) === style.symbol.kind) roles[role as StyleRole] = id
    }
  return { schema: ROAD_STYLE_LIBRARY_SCHEMA, styles, roles }
}

export const roleKind = (role: StyleRole) => STYLE_ROLES.find((entry) => entry.role === role)!.kind
const roleLabel = (role: StyleRole) => STYLE_ROLES.find((entry) => entry.role === role)!.label
const anA = (word: string) => `${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word}`

/** PGMaps' own symbol for a role. */
export function defaultRoleSymbol(role: StyleRole): SheetSymbol {
  if (role === 'culvert')
    return { kind: 'line', label: 'Culvert', layers: [{ color: CULVERT_COLOR, width: 3, cap: 'butt' }] }
  if (role === 'station') return { kind: 'point', label: 'Station', icon: 'dot', size: 2.5, color: STATION_COLOR }
  if (role === 'deactivated') return deactivatedRoadSymbol()
  return PLAN_SHEET_SYMBOLS[role]
}

/** Adds styles, numbering a repeated name, up to the library's limit. */
export function addStyles(library: RoadStyleLibrary, styles: readonly Omit<SavedStyle, 'id'>[]): RoadStyleLibrary {
  if (library.styles.length + styles.length > MAX_SAVED_STYLES)
    throw Error(`A library holds at most ${MAX_SAVED_STYLES} styles. Delete some before adding more.`)
  const names = new Set(library.styles.map((style) => style.name.toLowerCase()))
  const used = new Set(library.styles.map((style) => style.id))
  const added = styles.map((style) => {
    let name = style.name
    for (let n = 2; names.has(name.toLowerCase()); n++) name = `${style.name} (${n})`
    names.add(name.toLowerCase())
    let id = `style-${Date.parse(style.savedOn) || 0}-${used.size}`
    for (let n = 1; used.has(id); n++) id = `${id}-${n}`
    used.add(id)
    return { ...style, name, id, symbol: checkedSheetSymbol(style.symbol) }
  })
  return { ...library, styles: [...library.styles, ...added] }
}

/** Removes a style and every role it drew. */
export function removeStyle(library: RoadStyleLibrary, id: string): RoadStyleLibrary {
  const roles = Object.fromEntries(Object.entries(library.roles).filter(([, styleId]) => styleId !== id))
  return { ...library, styles: library.styles.filter((style) => style.id !== id), roles }
}

/** Draws a role with a saved style, or with PGMaps' own symbol when `id` is null. */
export function assignRole(library: RoadStyleLibrary, role: StyleRole, id: string | null): RoadStyleLibrary {
  const roles = { ...library.roles }
  if (id === null) delete roles[role]
  else {
    const style = library.styles.find((s) => s.id === id)
    if (!style) throw Error('That style is no longer in the library.')
    if (style.symbol.kind !== roleKind(role))
      throw Error(
        `${style.name} is ${anA(style.symbol.kind)} symbol; ${roleLabel(role)} need ${anA(roleKind(role))} symbol.`,
      )
    roles[role] = id
  }
  return { ...library, roles }
}

/** The symbol each role draws with where the library replaces PGMaps' own, with the style's name. */
export function roleOverrides(library: RoadStyleLibrary | null | undefined): Partial<Record<StyleRole, SheetSymbol>> {
  const overrides: Partial<Record<StyleRole, SheetSymbol>> = {}
  for (const [role, id] of Object.entries(library?.roles ?? {})) {
    const style = library!.styles.find((s) => s.id === id)
    if (style) overrides[role as StyleRole] = { ...style.symbol, label: style.name }
  }
  return overrides
}
