/**
 * The route card's rows and presets, as data. A **row** is one line of a constraint checklist such
 * as BC Timber Sales' "Route Card Tool Assessment": its label, the layer it reads, the fields it
 * prints, and how far it looks. A **preset** arranges rows into a sheet's sections and names the
 * considerations its paragraphs are drafted for. Both live as JSON (`catalogue/rows.json`,
 * `catalogue/presets.json`, guide `docs/forestry-route-card.md`) and are read through the hand
 * parsers here, so a preset someone makes for their own district is checked the same way.
 *
 * Rules every row follows, measured against the route card tool's own output:
 * - **Y** when a feature lies within `yesWithinMeters` of the subject (0: it touches or overlaps);
 *   **Within** when it lies within `nearWithinMeters` (200 m by default); **N** otherwise.
 * - A row whose layer is not published is `notPublic`: it is never N. The person can enter it.
 *
 * No DOM or network access.
 */
import { bool, int, list, object, oneOf, optional, strictObject, text, type JsonObject } from '@/lib/jsonGuards'

import presetsJson from './catalogue/presets.json'
import rowsJson from './catalogue/rows.json'

export type WfsSource = {
  kind: 'wfs'
  /** A DataBC WFS type name, e.g. `WHSE_ADMIN_BOUNDARIES.ADM_NR_DISTRICTS_SPG`. */
  typeName: string
  /** The layer's geometry field: without it in `propertyName` DataBC returns features with no shapes. */
  geometryField: string
  fields: string[]
  /** An extra CQL condition, ANDed with the box. */
  filter?: string
}

export type ArcgisSource = {
  kind: 'arcgis'
  /** A MapServer's address, without the layer. */
  service: string
  layer: number
  fields: string[]
  /** An extra `where` clause. */
  where?: string
}

export type NotPublicSource = {
  kind: 'notPublic'
  /** Why no app can read it: who holds it and what is restricted. */
  reason: string
  /** Who holds the data, when known. */
  holder?: string
  /** How the reviewer fills it. */
  fill?: string
  /** Where to look it up. */
  link?: { label: string; url: string }
  /** The field an imported file of this data names this row by (the fisher layer's `Denning_warning`). */
  importField?: string
}

export type RouteCardSource = WfsSource | ArcgisSource | NotPublicSource

export type RouteCardSearch = {
  /** A feature this close or closer makes the row Y. 0: it touches or overlaps. */
  yesWithinMeters: number
  /** A feature this close or closer, but not Y, makes the row "Within"; null: the row has no such state. */
  nearWithinMeters: number | null
}

export const DEFAULT_SEARCH: RouteCardSearch = { yesWithinMeters: 0, nearWithinMeters: 200 }

/** The widest search a row may ask for, metres: a route card is about a block's surroundings. */
export const MAX_SEARCH_METERS = 10_000
/** Most features one layer's answer may hold. */
export const MAX_ROW_FEATURES = 5_000
export const DEFAULT_ROW_FEATURES = 2_000

export type RouteCardRow = {
  id: string
  label: string
  source: RouteCardSource
  /** The fields a feature is printed by, joined with ", " (an empty field prints "None", as the tool's sheet does). */
  print: string[]
  search: RouteCardSearch
  maxFeatures: number
  /** False: the layer was chosen by name and no test block ever overlapped it. */
  confirmed: boolean
  /**
   * The row prints PGMaps' estimate from each feature rather than a field (`birdRank.ts`): the source's own answer is
   * not published. An estimated row is marked so wherever it prints, and the reviewer can enter the real answer over it.
   */
  estimate?: RouteCardEstimate
  note?: string
}

export const ROUTE_CARD_ESTIMATES = ['migratory-bird-nest-rank'] as const
export type RouteCardEstimate = (typeof ROUTE_CARD_ESTIMATES)[number]

export type RouteCardSection = { title: string; rows: string[] }

export type ConsiderationId =
  | 'old-forest'
  | 'patch-size'
  | 'watershed'
  | 'tap-ogma'
  | 'visuals'
  | 'caribou-uwr'
  | 'arch'
  | 'migratory-birds'
  | 'fisher'

export const CONSIDERATION_IDS: readonly ConsiderationId[] = [
  'old-forest',
  'patch-size',
  'watershed',
  'tap-ogma',
  'visuals',
  'caribou-uwr',
  'arch',
  'migratory-birds',
  'fisher',
]

export type RouteCardPreset = {
  id: string
  name: string
  description: string
  /** Sheet names in the workbook. */
  sheet: { routeCard: string; considerations: string }
  sections: RouteCardSection[]
  /** The considerations drafted, in the order the sheet lists them. */
  considerations: ConsiderationId[]
  /** Rows read for the considerations but not printed on the route card (the BEC subzone). */
  reads: string[]
}

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/
const LAYER = /^[A-Z0-9_]+\.[A-Z0-9_]+$/
const FIELD = /^[A-Z0-9_]{1,64}$/

const fieldList = (value: unknown, label: string) =>
  list(value, label, 40, 1).map((field, i) => {
    const name = text(field, `${label}[${i}]`, 64)
    if (!FIELD.test(name)) throw new Error(`${label}[${i}]: “${name}” is not a field name.`)
    return name
  })

function parseSource(value: unknown, label: string): RouteCardSource {
  const source = object(value, label)
  const kind = oneOf(source.kind, `${label}.kind`, ['wfs', 'arcgis', 'notPublic'] as const)
  if (kind === 'notPublic') {
    const parsed = strictObject(source, label, ['kind', 'reason', 'holder', 'fill', 'link', 'importField'])
    const link = optional(parsed, 'link', (entry) => {
      const value = strictObject(entry, `${label}.link`, ['label', 'url'])
      const url = text(value.url, `${label}.link.url`, 300)
      if (!/^https:\/\//.test(url)) throw new Error(`${label}.link.url: an https address.`)
      return { label: text(value.label, `${label}.link.label`, 120), url }
    })
    return {
      kind,
      reason: text(parsed.reason, `${label}.reason`, 400),
      ...optionalText(parsed, 'holder', `${label}.holder`),
      ...optionalText(parsed, 'fill', `${label}.fill`, 400),
      ...(link ? { link } : {}),
      ...optionalText(parsed, 'importField', `${label}.importField`, 64),
    }
  }
  if (kind === 'wfs') {
    const parsed = strictObject(source, label, ['kind', 'typeName', 'geometryField', 'fields', 'filter'])
    const typeName = text(parsed.typeName, `${label}.typeName`, 120)
    if (!LAYER.test(typeName)) throw new Error(`${label}.typeName: “${typeName}” is not a DataBC layer name.`)
    const geometryField = text(parsed.geometryField, `${label}.geometryField`, 64)
    if (!FIELD.test(geometryField)) throw new Error(`${label}.geometryField: not a field name.`)
    return {
      kind,
      typeName,
      geometryField,
      fields: fieldList(parsed.fields, `${label}.fields`),
      ...optionalText(parsed, 'filter', `${label}.filter`, 400),
    }
  }
  const parsed = strictObject(source, label, ['kind', 'service', 'layer', 'fields', 'where'])
  const service = text(parsed.service, `${label}.service`, 300)
  if (!/^https:\/\/[^\s?#]+\/MapServer$/.test(service))
    throw new Error(`${label}.service: an https address ending in /MapServer.`)
  return {
    kind,
    service,
    layer: int(parsed.layer, `${label}.layer`, 0, 100_000),
    fields: fieldList(parsed.fields, `${label}.fields`),
    ...optionalText(parsed, 'where', `${label}.where`, 400),
  }
}

function optionalText<K extends string>(source: JsonObject, key: K, label: string, max = 200) {
  const value = optional(source, key, (entry) => text(entry, label, max))
  return (value === undefined ? {} : { [key]: value }) as Partial<Record<K, string>>
}

function metres(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_SEARCH_METERS)
    throw new Error(`${label}: metres from 0 to ${MAX_SEARCH_METERS}.`)
  return value
}

export function parseRouteCardRow(value: unknown, label = 'row'): RouteCardRow {
  const row = strictObject(value, label, [
    'id',
    'label',
    'source',
    'print',
    'search',
    'maxFeatures',
    'confirmed',
    'note',
    'estimate',
  ])
  const id = text(row.id, `${label}.id`, 64)
  if (!ID.test(id)) throw new Error(`${label}.id: lower-case letters, digits and hyphens.`)
  const source = parseSource(row.source, `${label}.source`)
  const print = source.kind === 'notPublic' ? [] : fieldList(row.print, `${label}.print`)
  if (source.kind !== 'notPublic') {
    const missing = print.filter((field) => !source.fields.includes(field))
    if (missing.length) throw new Error(`${label}.print: ${missing.join(', ')} not in source.fields.`)
  }
  const search = optional(row, 'search', (entry) => {
    const parsed = strictObject(entry, `${label}.search`, ['yesWithinMeters', 'nearWithinMeters'])
    const yes = metres(parsed.yesWithinMeters, `${label}.search.yesWithinMeters`)
    const near =
      parsed.nearWithinMeters === null ? null : metres(parsed.nearWithinMeters, `${label}.search.nearWithinMeters`)
    if (near !== null && near < yes) throw new Error(`${label}.search: nearWithinMeters is less than yesWithinMeters.`)
    return { yesWithinMeters: yes, nearWithinMeters: near }
  })
  return {
    id,
    label: text(row.label, `${label}.label`, 120),
    source,
    print,
    search: search ?? DEFAULT_SEARCH,
    maxFeatures:
      optional(row, 'maxFeatures', (entry) => int(entry, `${label}.maxFeatures`, 1, MAX_ROW_FEATURES)) ??
      DEFAULT_ROW_FEATURES,
    confirmed: optional(row, 'confirmed', (entry) => bool(entry, `${label}.confirmed`)) ?? true,
    ...(row.estimate === undefined ? {} : { estimate: oneOf(row.estimate, `${label}.estimate`, ROUTE_CARD_ESTIMATES) }),
    ...optionalText(row, 'note', `${label}.note`, 400),
  }
}

export function parseRouteCardRows(value: unknown): RouteCardRow[] {
  const file = strictObject(value, 'rows file', ['kind', 'version', 'rows'])
  if (file.kind !== 'route-card-rows') throw new Error('Not a route card rows file.')
  if (file.version !== 1) throw new Error('A rows file of a newer version than this PGMaps reads.')
  const rows = list(file.rows, 'rows', 500, 1).map((row, i) => parseRouteCardRow(row, `rows[${i}]`))
  const seen = new Set<string>()
  for (const row of rows) {
    if (seen.has(row.id)) throw new Error(`rows: ${row.id} is listed twice.`)
    seen.add(row.id)
  }
  return rows
}

export function parseRouteCardPreset(value: unknown, rows: readonly RouteCardRow[], label = 'preset'): RouteCardPreset {
  const preset = strictObject(value, label, [
    'kind',
    'version',
    'id',
    'name',
    'description',
    'sheet',
    'sections',
    'considerations',
    'reads',
  ])
  if (preset.kind !== 'route-card-preset') throw new Error(`${label}: not a route card preset.`)
  if (preset.version !== 1) throw new Error(`${label}: a preset of a newer version than this PGMaps reads.`)
  const id = text(preset.id, `${label}.id`, 64)
  if (!ID.test(id)) throw new Error(`${label}.id: lower-case letters, digits and hyphens.`)
  const known = new Set(rows.map((row) => row.id))
  const used = new Set<string>()
  const sections = list(preset.sections, `${label}.sections`, 40, 1).map((entry, i) => {
    const section = strictObject(entry, `${label}.sections[${i}]`, ['title', 'rows'])
    return {
      title: text(section.title, `${label}.sections[${i}].title`, 120),
      rows: list(section.rows, `${label}.sections[${i}].rows`, 200, 1).map((rowId, j) => {
        const where = `${label}.sections[${i}].rows[${j}]`
        const name = text(rowId, where, 64)
        if (!known.has(name)) throw new Error(`${where}: no row “${name}”.`)
        if (used.has(name)) throw new Error(`${where}: “${name}” is listed twice.`)
        used.add(name)
        return name
      }),
    }
  })
  const sheet = strictObject(preset.sheet, `${label}.sheet`, ['routeCard', 'considerations'])
  return {
    id,
    name: text(preset.name, `${label}.name`, 120),
    description: text(preset.description, `${label}.description`, 600),
    sheet: {
      routeCard: sheetName(sheet.routeCard, `${label}.sheet.routeCard`),
      considerations: sheetName(sheet.considerations, `${label}.sheet.considerations`),
    },
    sections,
    considerations: list(preset.considerations, `${label}.considerations`, CONSIDERATION_IDS.length).map((entry, i) =>
      oneOf(entry, `${label}.considerations[${i}]`, CONSIDERATION_IDS),
    ),
    reads: (optional(preset, 'reads', (entry) => list(entry, `${label}.reads`, 50)) ?? []).map((entry, i) => {
      const name = text(entry, `${label}.reads[${i}]`, 64)
      if (!known.has(name)) throw new Error(`${label}.reads[${i}]: no row “${name}”.`)
      if (used.has(name)) throw new Error(`${label}.reads[${i}]: “${name}” is already printed.`)
      return name
    }),
  }
}

/** Excel's sheet-name rules: at most 31 characters, none of : \ / ? * [ ]. */
function sheetName(value: unknown, label: string): string {
  const name = text(value, label, 31)
  if (/[:\\/?*[\]]/.test(name)) throw new Error(`${label}: Excel does not allow : \\ / ? * [ ] in a sheet name.`)
  return name
}

export function parseRouteCardPresets(value: unknown, rows: readonly RouteCardRow[]): RouteCardPreset[] {
  const file = strictObject(value, 'presets file', ['kind', 'version', 'presets'])
  if (file.kind !== 'route-card-presets') throw new Error('Not a route card presets file.')
  if (file.version !== 1) throw new Error('A presets file of a newer version than this PGMaps reads.')
  return list(file.presets, 'presets', 50, 1).map((preset, i) => parseRouteCardPreset(preset, rows, `presets[${i}]`))
}

/** The bundled rows and presets, checked once when first read. */
export const ROUTE_CARD_ROWS: readonly RouteCardRow[] = parseRouteCardRows(rowsJson)
export const ROUTE_CARD_PRESETS: readonly RouteCardPreset[] = parseRouteCardPresets(presetsJson, ROUTE_CARD_ROWS)
export const DEFAULT_ROUTE_CARD_PRESET = ROUTE_CARD_PRESETS[0]

export const routeCardRow = (id: string, rows: readonly RouteCardRow[] = ROUTE_CARD_ROWS) =>
  rows.find((row) => row.id === id) ?? null

/** The rows a preset prints, in its order. */
export const presetRows = (preset: RouteCardPreset, rows: readonly RouteCardRow[] = ROUTE_CARD_ROWS) =>
  preset.sections.flatMap((section) => section.rows.map((id) => routeCardRow(id, rows)!))

/** Every row a preset reads: the printed ones, then those read only for its considerations. */
export const presetReadRows = (preset: RouteCardPreset, rows: readonly RouteCardRow[] = ROUTE_CARD_ROWS) => [
  ...presetRows(preset, rows),
  ...preset.reads.map((id) => routeCardRow(id, rows)!),
]
