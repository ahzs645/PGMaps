import { describe, expect, it } from 'vitest'
import { dateColumn, numberColumn, textColumn } from './tableColumns'
import {
  buildSearchIndex,
  columnText,
  defaultHiddenColumns,
  searchRows,
  sortTableRows,
  tableColumnStats,
  tableCsvFileName,
  tableCsvText,
  tableGridLayout,
  type MapFeatureTableColumn,
} from './mapTableModel'

interface Row {
  name: string
  area: number | null
  date?: string
}

const name = textColumn<Row>('name', 'Name', (row) => row.name)
const area = numberColumn<Row>('area', 'Area', (row) => row.area, { format: (value) => `${value} ha` })
const rows: Row[] = [
  { name: 'Airport', area: 2118.1, date: '2026-06-17' },
  { name: 'Assman', area: null },
  { name: 'Austin East', area: 56.1, date: '2024-01-02' },
]

describe('tableGridLayout', () => {
  it('gives the table a definite width, so one long cell cannot widen every column', () => {
    const layout = tableGridLayout([name, area], true)
    expect(layout.template).toBe('56px minmax(170px, 170fr) minmax(120px, 120fr)')
    expect(layout.minWidth).toBe(56 + 170 + 120)
  })

  it('drops the row number track on phones', () => {
    const layout = tableGridLayout([name], false)
    expect(layout.template).toBe('minmax(170px, 170fr)')
    expect(layout.minWidth).toBe(170)
  })
})

describe('search', () => {
  it('matches every term anywhere in the row, using displayed text', () => {
    const index = buildSearchIndex(rows, [name, area])
    expect(searchRows(rows, index, 'austin').map((row) => row.name)).toEqual(['Austin East'])
    expect(searchRows(rows, index, 'east 56.1 ha').map((row) => row.name)).toEqual(['Austin East'])
    expect(searchRows(rows, index, 'AIRPORT').map((row) => row.name)).toEqual(['Airport'])
    expect(searchRows(rows, index, 'nowhere')).toEqual([])
  })

  it('returns the rows untouched for a blank query', () => {
    expect(searchRows(rows, [], '   ')).toBe(rows)
  })

  it('reads no text from React content without a search value', () => {
    const icon: MapFeatureTableColumn<Row> = { id: 'icon', header: 'Icon', getValue: () => ({ type: 'svg' }) as never }
    expect(columnText(icon, rows[0])).toBe('')
  })
})

describe('sortTableRows', () => {
  it('sorts by the raw value and keeps empty cells last in both directions', () => {
    expect(sortTableRows(rows, area, 'asc').map((row) => row.area)).toEqual([56.1, 2118.1, null])
    expect(sortTableRows(rows, area, 'desc').map((row) => row.area)).toEqual([2118.1, 56.1, null])
  })
})

describe('defaultHiddenColumns', () => {
  it('collects the columns that start hidden', () => {
    const id = textColumn<Row>('id', 'Object ID', (row) => row.name, { defaultHidden: true })
    expect([...defaultHiddenColumns([name, id])]).toEqual(['id'])
  })
})

describe('CSV', () => {
  it('writes raw numbers, not display text, and escapes quotes', () => {
    const csv = tableCsvText([{ name: 'The "Hart"', area: 2118.1 }], [name, area])
    expect(csv.replace('﻿', '')).toBe('"Name","Area"\r\n"The ""Hart""","2118.1"')
  })

  it('starts with a byte order mark so Excel reads accented names', () => {
    expect(tableCsvText(rows, [name]).charCodeAt(0)).toBe(0xfeff)
  })

  it('guards text that a spreadsheet would run as a formula', () => {
    expect(tableCsvText([{ name: '=HYPERLINK("x")', area: 1 }], [name])).toContain(`"'=HYPERLINK(""x"")"`)
  })

  it('writes dates as ISO days', () => {
    const date = dateColumn<Row>('date', 'Date', (row) => row.date)
    expect(tableCsvText(rows.slice(0, 2), [date]).replace('﻿', '')).toBe('"Date"\r\n"2026-06-17"\r\n""')
  })

  it('keeps a bare date on its own calendar day in every timezone', () => {
    const date = dateColumn<Row>('date', 'Date', (row) => row.date)
    const row = { name: 'A', area: 1, date: '2026-01-01' }
    expect(date.getValue(row)).toBe('Jan 1, 2026')
    expect(date.getExportValue?.(row)).toBe('2026-01-01')
  })

  it('names the file after the layer', () => {
    expect(tableCsvFileName('Snow removal routes')).toBe('snow-removal-routes.csv')
    expect(tableCsvFileName('Café & parks (2026)')).toBe('café-parks-2026.csv')
    expect(tableCsvFileName('***')).toBe('table.csv')
  })
})

describe('tableColumnStats', () => {
  it('summarizes any column through its own values', () => {
    const stats = tableColumnStats(rows, area)
    expect(stats).toMatchObject({ count: 2, missing: 1, min: 56.1, max: 2118.1 })
  })
})

describe('column helpers', () => {
  it('leaves a non-finite number empty', () => {
    const column = numberColumn<Row>('area', 'Area', () => Number.NaN)
    expect(column.getValue(rows[0])).toBe('')
    expect(column.getSortValue?.(rows[0])).toBeNull()
  })
})
