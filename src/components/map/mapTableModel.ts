import type { ReactNode } from 'react'
import { toCsv } from '@pgmaps/geo-toolkit/export'
import { columnStats, type ColumnStats } from '@/lib/featureAttributes'

export type MapFeatureTableColumnType = 'text' | 'numeric' | 'datetime'
export type MapFeatureTableSortDirection = 'asc' | 'desc'

export interface MapFeatureTableColumn<TRow> {
  id: string
  header: string
  /** Drives cell alignment and the header type glyph. Defaults to 'text'. */
  type?: MapFeatureTableColumnType
  /** Column width in px, before spare table width is shared out. Defaults to 150. */
  width?: number
  widthClassName?: string
  getValue: (row: TRow) => ReactNode
  getSearchValue?: (row: TRow) => string
  /** Comparable value for `sortable` tables; null sorts last. Defaults to the search value. */
  getSortValue?: (row: TRow) => number | string | null
  /** Value written to a CSV download. Defaults to the search value, so return the raw number here. */
  getExportValue?: (row: TRow) => unknown
  /** Starts hidden; people can turn it on from the table's options menu. */
  defaultHidden?: boolean
  /** Formats this column's min, max and other numeric statistics. */
  formatStat?: (value: number) => string
}

export const INDEX_COLUMN_WIDTH = 56
export const DEFAULT_COLUMN_WIDTH = 150

/** Plain text of a cell. Non-text React content has none: give that column a `getSearchValue`. */
export function columnText<TRow>(column: MapFeatureTableColumn<TRow>, row: TRow): string {
  const explicit = column.getSearchValue?.(row)
  if (explicit != null) return explicit
  const value = column.getValue(row)
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : ''
}

/**
 * Lower-cased text of every row, built once per rows/columns pair. Formatting
 * cells on each keystroke took seconds at 40,000 rows; matching this index takes
 * about a millisecond.
 */
export function buildSearchIndex<TRow>(
  rows: readonly TRow[],
  columns: ReadonlyArray<MapFeatureTableColumn<TRow>>,
): string[] {
  return rows.map((row) =>
    columns
      .map((column) => columnText(column, row))
      .join(' ')
      .toLowerCase(),
  )
}

/** Every whitespace-separated term must appear somewhere in the row. */
export function searchRows<TRow>(rows: TRow[], index: readonly string[], query: string): TRow[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return rows
  return rows.filter((_, position) => {
    const text = index[position]
    return terms.every((term) => text.includes(term))
  })
}

export function compareSortValues(a: number | string | null, b: number | string | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true })
}

/** Stable sort; empty cells stay at the bottom in both directions. */
export function sortTableRows<TRow>(
  rows: readonly TRow[],
  column: MapFeatureTableColumn<TRow>,
  direction: MapFeatureTableSortDirection,
): TRow[] {
  const valueOf = column.getSortValue ?? ((row: TRow) => columnText(column, row))
  const keyed = rows.map((row, index) => ({ row, index, value: valueOf(row) }))
  keyed.sort((a, b) => {
    if (a.value === null || b.value === null) return compareSortValues(a.value, b.value) || a.index - b.index
    const order = compareSortValues(a.value, b.value)
    return (direction === 'asc' ? order : -order) || a.index - b.index
  })
  return keyed.map((entry) => entry.row)
}

/** Columns hidden until someone turns them on. */
export function defaultHiddenColumns<TRow>(columns: ReadonlyArray<MapFeatureTableColumn<TRow>>): Set<string> {
  return new Set(columns.filter((column) => column.defaultHidden).map((column) => column.id))
}

/**
 * Column tracks plus the width the table must take up. The table gets a definite
 * width on purpose: sized to its content, `1fr` tracks all grow to the longest
 * cell in any column, so one GUID made every column 340px wide.
 */
export function tableGridLayout<TRow>(
  columns: ReadonlyArray<MapFeatureTableColumn<TRow>>,
  showIndex: boolean,
): { template: string; minWidth: number } {
  const widths = columns.map((column) => column.width ?? DEFAULT_COLUMN_WIDTH)
  // Spare width follows each column's size, so numbers do not grow as wide as text.
  const tracks = widths.map((width) => `minmax(${width}px, ${width}fr)`)
  return {
    template: [...(showIndex ? [`${INDEX_COLUMN_WIDTH}px`] : []), ...tracks].join(' '),
    minWidth: widths.reduce((total, width) => total + width, showIndex ? INDEX_COLUMN_WIDTH : 0),
  }
}

/** CSV of the rows and columns as shown. The byte order mark lets Excel read accented names. */
export function tableCsvText<TRow>(rows: readonly TRow[], columns: ReadonlyArray<MapFeatureTableColumn<TRow>>): string {
  return toCsv(
    columns.map((column) => ({
      header: column.header,
      value: (row: TRow) => (column.getExportValue ? column.getExportValue(row) : columnText(column, row)),
    })),
    rows,
    { bom: true },
  )
}

/** "Civic facilities" → "civic-facilities.csv". */
export function tableCsvFileName(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'table'}.csv`
}

/** Column statistics read through the column's own values, so any table can show them. */
export function tableColumnStats<TRow>(rows: readonly TRow[], column: MapFeatureTableColumn<TRow>): ColumnStats {
  const valueOf = column.getSortValue ?? ((row: TRow) => columnText(column, row))
  return columnStats(
    rows.map((row) => ({ properties: { [column.id]: valueOf(row) } })),
    {
      key: column.id,
      type: column.type ?? 'text',
    },
  )
}
