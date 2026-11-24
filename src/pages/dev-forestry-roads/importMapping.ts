import type { HarvestEvidence } from '@/lib/forestry/bcHarvest'
import { HARVEST_YEAR_MAX, HARVEST_YEAR_MIN } from '@/lib/forestry/bcHarvest'
import { list, object, optional, text as textField, type JsonObject } from '@/lib/jsonGuards'
import type { SpatialFile } from './spatialImport'

/**
 * How a GIS layer's attributes become what the road designer keeps, chosen in the import's mapping
 * step (guide `exports-and-project-files.md`, **Mapping a layer's fields**). It reads attributes
 * only, never geometry, and keeps every source attribute as read. A target the project has no place
 * for is not offered: a proposed road keeps a name and nothing else, a planned block also its
 * opening ID and, for rows the file calls harvested, its status and year.
 */
export interface ImportMapping {
  /** Fields tried in order for a feature's name: the first that is not blank names it. */
  nameFields: string[]
  /** Where every name field is blank, the feature is numbered within this field's value ("Saxton 3"). */
  groupField: string | null
  /** Only rows whose value of `field` is listed are imported ('' for blank). Absent keeps every row. */
  keep?: { field: string; values: string[] }
  /** Planned blocks: rows whose value of `field` is listed are past harvests; the rest are proposed. */
  status?: { field: string; harvested: string[] }
  /** Planned blocks: the year a row marked harvested was harvested. */
  yearField?: string | null
  /** Planned blocks: the RESULTS opening ID. */
  openingIdField?: string | null
}

export type MappingRole = 'reference' | 'proposed-road' | 'planned-block'

/** Attributes that name a feature, in order (DBF names cut to ten characters included). */
const NAME_FIELD =
  /^(name|feature_na(me)?|label|title|gnis_name|road_id|road_name|block_?id|block_?no|block_?name|blk_?(id|no)|cut_?block(_?(id|no|i))?_?|opening_?id|cp_?block|licence_?block)$/i
/** Names that group features into a place or unit: operating area, cutting permit, licence, landscape unit. */
const GROUP_NAMES = [
  'operating_area',
  'op_area',
  'oper_area',
  'area_name',
  'cutting_permit',
  'cp',
  'cp_id',
  'licence',
  'license',
  'licence_id',
  'license_id',
  'tenure',
  'landscape_unit',
  'lu_name',
  'supply_block',
  'sub_unit',
  'unit_name',
]
const STATUS_NAMES = ['status', 'block_status', 'blk_status', 'stat', 'state', 'harvest_status', 'cut_status']
const YEAR_NAMES = [
  'harvest_year',
  'harv_year',
  'harv_yr',
  'year_harvested',
  'harvest_end_year',
  'harvest_date',
  'harv_date',
  'disturbance_end_date',
  'denudation_end_date',
  'year',
  'yr',
]
const OPENING_NAMES = ['opening_id', 'openingid', 'opening_number', 'op_id']
/** A status value meaning the block was cut. "Uncut" and "not harvested" are not. */
const HARVESTED_VALUE =
  /^(?!.*\b(un|not|non)[ -]?(cut|harv|logged))(.*\b(harvested|logged|cut|complete[d]?|done)\b|h|hv)$/i

const fold = (key: string) => key.toLowerCase().replace(/[\s-]+/g, '_')
/**
 * A source field matches a target's name when equal after folding case, spaces and hyphens, or
 * when it is a DBF name cut to ten characters that starts that name (`Operating_` for
 * `operating_area`).
 */
export function fieldMatches(field: string, names: readonly string[]) {
  const key = fold(field)
  return names.some((name) => key === name || (field.length === 10 && name.startsWith(key.replace(/_+$/, ''))))
}

const valueText = (value: unknown) =>
  typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : ''

/** The attributes of a feature as the file carried them (not the import's own `name`). */
export function sourceFields(feature: GeoJSON.Feature): Record<string, unknown> {
  const properties = (feature.properties ?? {}) as Record<string, unknown>
  const source = properties.sourceAttributes
  return source && typeof source === 'object' ? (source as Record<string, unknown>) : properties
}

/** Every attribute key the file's features carry, in first-seen order. */
export function fieldNames(file: SpatialFile): string[] {
  const keys = new Set<string>()
  for (const feature of file.collection.features)
    for (const key of Object.keys(sourceFields(feature))) if (key !== 'sourceAttributes') keys.add(key)
  // The reader copies a feature's name into `name` (`spatialFeatureName`); that copy is not a field.
  const copied = file.collection.features.every((feature) => {
    const fields = sourceFields(feature)
    const name = valueText(fields.name)
    return !name || Object.keys(fields).some((key) => key !== 'name' && valueText(fields[key]) === name)
  })
  return [...keys].filter((key) => key !== 'name' || !copied)
}

/** A field's values: how many rows fill it, and each distinct value with its count, commonest first. */
export function fieldValues(file: SpatialFile, field: string) {
  const counts = new Map<string, number>()
  for (const feature of file.collection.features) {
    const value = valueText(sourceFields(feature)[field])
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  const values = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const filled = file.collection.features.length - (counts.get('') ?? 0)
  return { filled, values, distinct: values.filter(([value]) => value).length }
}

/** A year read from an attribute: a whole number, a "2019-07-01"-style date or a DBF "20190701". */
export function yearOf(value: unknown): number | null {
  const raw = valueText(value)
  const match = /^(\d{4})(?:$|[-/.]\d{1,2}[-/.]\d{1,2}|\d{4}$|[-/.T ])/.exec(raw)
  const year = match ? Number(match[1]) : NaN
  return Number.isInteger(year) && year >= HARVEST_YEAR_MIN && year <= HARVEST_YEAR_MAX ? year : null
}

/**
 * The first guess for a file under `role`: the name-like fields it has (even partly filled, in the
 * order tried), a repeated group field, and for blocks a status field with its harvested values, a
 * year field whose values read as years, and an opening ID. Nothing is guessed from geometry.
 */
export function guessImportMapping(file: SpatialFile, role: MappingRole): ImportMapping {
  const fields = fieldNames(file)
  const filled = (key: string) => fieldValues(file, key).filled > 0
  // Failing a name-like field, the field the reader already named features by (a lone text attribute).
  const readName = file.collection.features.some((feature) => valueText(feature.properties?.name))
    ? fields.find(
        (key) =>
          filled(key) &&
          file.collection.features.every((feature) => {
            const name = valueText(feature.properties?.name)
            return !name || valueText(sourceFields(feature)[key]) === name
          }),
      )
    : undefined
  const named = fields.filter((key) => NAME_FIELD.test(key) && filled(key))
  // A second name-like field only where the first leaves rows blank.
  const total = file.collection.features.length
  const nameFields = named.length
    ? fieldValues(file, named[0]).filled < total && named[1]
      ? named.slice(0, 2)
      : named.slice(0, 1)
    : readName
      ? [readName]
      : []
  const groupField =
    fields.find((key) => {
      if (nameFields.includes(key) || !fieldMatches(key, GROUP_NAMES)) return false
      const { filled, distinct } = fieldValues(file, key)
      return filled > 0 && distinct < filled
    }) ?? null
  const mapping: ImportMapping = { nameFields, groupField }
  if (role !== 'planned-block') return mapping
  const statusField = fields.find((key) => {
    if (!fieldMatches(key, STATUS_NAMES)) return false
    const { distinct } = fieldValues(file, key)
    return distinct > 0 && distinct <= 20
  })
  if (statusField) {
    const harvested = fieldValues(file, statusField)
      .values.map(([value]) => value)
      .filter((value) => value && HARVESTED_VALUE.test(value))
    mapping.status = { field: statusField, harvested }
  }
  const yearField = fields.find(
    (key) =>
      fieldMatches(key, YEAR_NAMES) &&
      file.collection.features.some((feature) => yearOf(sourceFields(feature)[key]) !== null),
  )
  if (yearField) mapping.yearField = yearField
  const openingIdField = fields.find((key) => fieldMatches(key, OPENING_NAMES) && filled(key))
  if (openingIdField) mapping.openingIdField = openingIdField
  return mapping
}

/** What one row becomes under a mapping, before the import builds the project's features. */
export interface MappedRow {
  index: number
  name: string
  /** The group value the row was numbered within, when it was. */
  group?: string
  harvested?: boolean
  year?: number
  openingId?: string
}

const isKept = (fields: Record<string, unknown>, mapping: ImportMapping) =>
  !mapping.keep || mapping.keep.values.includes(valueText(fields[mapping.keep.field]))

/**
 * Each kept row's name and block facts, in file order. Group numbers count only the rows the group
 * names, so "Saxton 1" is the first Saxton block without a name of its own; rows named by neither
 * take the file's name, numbered.
 */
export function mapRows(file: SpatialFile, mapping: ImportMapping, role: MappingRole): MappedRow[] {
  const stem =
    file.fileName
      .split('/')
      .at(-1)!
      .replace(/\.[^.]+$/, '')
      .slice(0, 150) || 'Imported feature'
  const counts = new Map<string, number>()
  const kept = file.collection.features.flatMap((feature, index) =>
    isKept(sourceFields(feature), mapping) ? [{ feature, index }] : [],
  )
  let unnamed = 0
  return kept.map(({ feature, index }) => {
    const fields = sourceFields(feature)
    const row: MappedRow = { index, name: '' }
    const own = mapping.nameFields.map((key) => valueText(fields[key])).find(Boolean)
    const group = mapping.groupField ? valueText(fields[mapping.groupField]) : ''
    if (own) row.name = own.slice(0, 200)
    else if (group) {
      const n = (counts.get(group) ?? 0) + 1
      counts.set(group, n)
      row.name = `${group} ${n}`.slice(0, 200)
      row.group = group
    } else {
      unnamed += 1
      row.name = kept.length === 1 ? stem : `${stem} ${unnamed}`
    }
    if (role === 'planned-block') {
      if (mapping.status?.harvested.includes(valueText(fields[mapping.status.field]))) {
        row.harvested = true
        const year = mapping.yearField ? yearOf(fields[mapping.yearField]) : null
        if (year !== null) row.year = year
      }
      const openingId = mapping.openingIdField ? valueText(fields[mapping.openingIdField]) : ''
      if (openingId) row.openingId = openingId.slice(0, 1000)
    }
    return row
  })
}

/** The figures the mapping step shows beside its choices: what the import will make. */
export function mappingSummary(rows: readonly MappedRow[], total: number) {
  const names = rows.map((row) => row.name)
  const distinct = [...new Set(names)]
  const groups = new Map<string, number>()
  for (const row of rows) if (row.group) groups.set(row.group, (groups.get(row.group) ?? 0) + 1)
  return {
    kept: rows.length,
    leftOut: total - rows.length,
    // Five names spread through the file, so each kind of name the choice gives shows.
    sample:
      distinct.length <= 5
        ? distinct
        : [0, 1, 2, 3, 4].map((i) => distinct[Math.round((i * (distinct.length - 1)) / 4)]),
    distinctNames: distinct.length,
    repeated: names.length - distinct.length,
    numbered: [...groups].sort((a, b) => b[1] - a[1]),
    harvested: rows.filter((row) => row.harvested).length,
    harvestedWithoutYear: rows.filter((row) => row.harvested && row.year === undefined).length,
  }
}

/**
 * The file as the import should read it under `mapping`: rows left out are dropped, each kept
 * feature's `name` is set and, for planned blocks, its harvest evidence (proposed, or harvested with
 * the year the file gives). The source attributes stay as read.
 */
export function applyImportMapping(file: SpatialFile, mapping: ImportMapping, role: MappingRole): SpatialFile {
  const rows = mapRows(file, mapping, role)
  const keepName = fieldNames(file).includes('name')
  return {
    ...file,
    collection: {
      ...file.collection,
      features: rows.map((row) => {
        const feature = file.collection.features[row.index]
        const properties = (feature.properties ?? {}) as Record<string, unknown>
        const evidence: HarvestEvidence | undefined =
          role !== 'planned-block'
            ? undefined
            : row.harvested
              ? {
                  source: 'user',
                  status: 'harvested',
                  ...(row.year !== undefined
                    ? { endYear: row.year, yearMethod: 'reported-year' as const }
                    : { yearMethod: 'unknown' as const }),
                  ...(row.openingId ? { openingId: row.openingId } : {}),
                }
              : {
                  source: 'user',
                  status: 'proposed',
                  yearMethod: 'unknown',
                  ...(row.openingId ? { openingId: row.openingId } : {}),
                }
        return {
          ...feature,
          properties: {
            ...properties,
            sourceAttributes:
              properties.sourceAttributes ??
              Object.fromEntries(Object.entries(properties).filter(([key]) => key !== 'name' || keepName)),
            name: row.name,
            ...(evidence ? { harvestEvidence: evidence } : {}),
          },
        }
      }),
    },
  }
}

// --- Saved mappings ---------------------------------------------------------------------------------

/** How many saved mappings this browser keeps; the least recently used goes first. */
export const MAX_SAVED_MAPPINGS = 50

export interface SavedMapping {
  /** Role, shape and the file's field names (`mappingKey`). */
  key: string
  /** The file it was saved from, for the person to recognise. */
  fileName: string
  mapping: ImportMapping
  savedAt: string
  usedAt: string
}

/**
 * The key a saved mapping is found by: the role, the file's shapes and its field names folded and
 * sorted. The next file of the same shape and fields (next year's plan) takes it.
 */
export function mappingKey(file: SpatialFile, role: MappingRole) {
  const shapes = [
    ...new Set(file.collection.features.map((f) => f.geometry.type.replace(/^Multi/, '').toLowerCase())),
  ].sort()
  const fields = fieldNames(file)
    .map((key) => key.toLowerCase())
    .sort()
  return `${role}|${shapes.join('+')}|${fields.join(',')}`
}

/** What a saved mapping carries: never the rows kept, which are this file's own choice. */
export function savableMapping(mapping: ImportMapping): ImportMapping {
  return {
    nameFields: mapping.nameFields,
    groupField: mapping.groupField,
    ...(mapping.status ? { status: mapping.status } : {}),
    ...(mapping.yearField !== undefined ? { yearField: mapping.yearField } : {}),
    ...(mapping.openingIdField !== undefined ? { openingIdField: mapping.openingIdField } : {}),
  }
}

/** Whether two mappings give the same import (the rows kept included). */
export function sameMapping(a: ImportMapping, b: ImportMapping) {
  return JSON.stringify(normalise(a)) === JSON.stringify(normalise(b))
}
const normalise = (m: ImportMapping) => ({
  nameFields: m.nameFields,
  groupField: m.groupField,
  keep: m.keep ? { field: m.keep.field, values: [...m.keep.values].sort() } : null,
  status: m.status ? { field: m.status.field, harvested: [...m.status.harvested].sort() } : null,
  yearField: m.yearField ?? null,
  openingIdField: m.openingIdField ?? null,
})

const fieldName = (value: unknown, label: string) => textField(value, label, 200)
const nullableField = (value: unknown, label: string) => (value === null ? null : fieldName(value, label))

export function parseImportMapping(raw: unknown): ImportMapping {
  const r = object(raw, 'Import mapping')
  const mapping: ImportMapping = {
    nameFields: list(r.nameFields, 'Name fields', 5).map((value) => fieldName(value, 'Name field')),
    groupField: r.groupField == null ? null : fieldName(r.groupField, 'Group field'),
  }
  const status = optional(r, 'status', (value) => {
    const s = object(value, 'Status mapping')
    return {
      field: fieldName(s.field, 'Status field'),
      harvested: list(s.harvested, 'Harvested values', 200).map((v) => (typeof v === 'string' ? v : '')),
    }
  })
  if (status) mapping.status = status
  const yearField = optional(r, 'yearField', (value) => nullableField(value, 'Year field'))
  if (yearField !== undefined) mapping.yearField = yearField
  const openingIdField = optional(r, 'openingIdField', (value) => nullableField(value, 'Opening ID field'))
  if (openingIdField !== undefined) mapping.openingIdField = openingIdField
  return mapping
}

/** Saved mappings as this browser stores them; an entry that does not read is left out, never repaired. */
export function parseSavedMappings(raw: unknown): SavedMapping[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry) => {
    try {
      const e = object(entry, 'Saved mapping') as JsonObject
      return [
        {
          key: textField(e.key, 'Mapping key', 20_000),
          fileName: textField(e.fileName, 'File name', 500),
          mapping: parseImportMapping(e.mapping),
          savedAt: textField(e.savedAt, 'Saved at', 40),
          usedAt: textField(e.usedAt, 'Used at', 40),
        },
      ]
    } catch {
      return []
    }
  })
}

/**
 * The saved list after importing `file` with `mapping`: an entry is saved when it differs from the
 * guess (or one was already saved for the key, which is then updated and marked used). A mapping
 * equal to the guess with nothing saved stores nothing. The list keeps the most recently used.
 */
export function rememberMapping(
  saved: readonly SavedMapping[],
  entry: { key: string; fileName: string; mapping: ImportMapping; guess: ImportMapping },
  now: string,
): SavedMapping[] {
  const existing = saved.find((item) => item.key === entry.key)
  const mapping = savableMapping(entry.mapping)
  if (!existing && sameMapping(mapping, savableMapping(entry.guess))) return [...saved]
  const next: SavedMapping = {
    key: entry.key,
    fileName: entry.fileName,
    mapping,
    savedAt: existing && sameMapping(existing.mapping, mapping) ? existing.savedAt : now,
    usedAt: now,
  }
  return [next, ...saved.filter((item) => item.key !== entry.key)]
    .sort((a, b) => b.usedAt.localeCompare(a.usedAt))
    .slice(0, MAX_SAVED_MAPPINGS)
}
