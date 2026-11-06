import {
  attributeSortValue,
  formatAttribute,
  formatAttributeNumber,
  type AttributeSchema,
} from '@/lib/featureAttributes'
import { formatDate, formatNumber } from '@/lib/format'
import type { MapFeatureTableColumn } from './mapTableModel'

/** Starting widths by kind of value; spare table width is shared out on top. */
export const TABLE_COLUMN_WIDTHS = { text: 170, numeric: 120, datetime: 130 } as const

type ColumnOptions<TRow> = Partial<Omit<MapFeatureTableColumn<TRow>, 'id' | 'header' | 'type'>>

export function textColumn<TRow>(
  id: string,
  header: string,
  read: (row: TRow) => string | null | undefined,
  options: ColumnOptions<TRow> = {},
): MapFeatureTableColumn<TRow> {
  return {
    id,
    header,
    type: 'text',
    width: TABLE_COLUMN_WIDTHS.text,
    getValue: (row) => read(row) ?? '',
    getSortValue: (row) => read(row) || null,
    getExportValue: (row) => read(row) ?? '',
    ...options,
  }
}

/** Numbers sort and export raw; `format` only changes what is displayed. */
export function numberColumn<TRow>(
  id: string,
  header: string,
  read: (row: TRow) => number | null | undefined,
  {
    format = (value) => formatNumber(value, { maximumFractionDigits: 2 }),
    ...options
  }: ColumnOptions<TRow> & { format?: (value: number) => string } = {},
): MapFeatureTableColumn<TRow> {
  const value = (row: TRow) => {
    const number = read(row)
    return number == null || !Number.isFinite(number) ? null : number
  }
  return {
    id,
    header,
    type: 'numeric',
    width: TABLE_COLUMN_WIDTHS.numeric,
    getValue: (row) => {
      const number = value(row)
      return number == null ? '' : format(number)
    },
    getSortValue: value,
    getExportValue: value,
    formatStat: format,
    ...options,
  }
}

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/

/** The calendar day a reader sees in the table, not the UTC day. */
function isoDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function dateColumn<TRow>(
  id: string,
  header: string,
  read: (row: TRow) => string | number | Date | null | undefined,
  options: ColumnOptions<TRow> = {},
): MapFeatureTableColumn<TRow> {
  const epoch = (row: TRow) => {
    const value = read(row)
    if (value == null || value === '') return null
    // A bare date parses as UTC midnight, which is the previous day west of Greenwich.
    const date =
      value instanceof Date
        ? value
        : new Date(typeof value === 'string' && BARE_DATE.test(value) ? `${value}T12:00` : value)
    const time = date.getTime()
    return Number.isNaN(time) ? null : time
  }
  return {
    id,
    header,
    type: 'datetime',
    width: TABLE_COLUMN_WIDTHS.datetime,
    getValue: (row) => {
      const time = epoch(row)
      return time == null ? '' : formatDate(time)
    },
    getSortValue: epoch,
    getExportValue: (row) => {
      const time = epoch(row)
      return time == null ? '' : isoDay(new Date(time))
    },
    ...options,
  }
}

/**
 * Columns from an inferred schema (`inferAttributes`). Source ids such as OBJECTID
 * and GlobalID start hidden, and a CSV gets source values, not display text.
 */
export function attributeTableColumns<TRow>(
  attributes: readonly AttributeSchema[],
  readAttribute: (row: TRow, key: string) => unknown,
): Array<MapFeatureTableColumn<TRow>> {
  return attributes.map((attribute) => ({
    id: attribute.key,
    header: attribute.label,
    type: attribute.type,
    width: TABLE_COLUMN_WIDTHS[attribute.type],
    // Source ids mean nothing to a reader; a source's area or length still does.
    defaultHidden: attribute.system && attribute.format?.kind !== 'area' && attribute.format?.kind !== 'length',
    getValue: (row) => formatAttribute(readAttribute(row, attribute.key), attribute),
    getSortValue: (row) => attributeSortValue(readAttribute(row, attribute.key), attribute),
    getExportValue: (row) => {
      const value = readAttribute(row, attribute.key)
      return attribute.type === 'datetime' ? formatAttribute(value, attribute) : value
    },
    formatStat:
      attribute.type === 'datetime'
        ? (value) => formatAttribute(value, attribute)
        : (value) => formatAttributeNumber(value, attribute.format),
  }))
}
