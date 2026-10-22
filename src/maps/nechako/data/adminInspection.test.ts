import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AdminDataTable } from '../PortalAdminResource'
import {
  adminCell,
  adminId,
  adminRows,
  adminSubmissions,
  calendarDays,
  filterAdminRows,
  localCalendarDate,
  scheduleDate,
  scheduleMarkers,
  scheduleNotifications,
  SUBMISSION_COLUMNS,
} from './adminInspection'

describe('native administration read contracts', () => {
  it('keeps source catalogue IDs, draft state and empty names separate from unrelated search/research IDs', () => {
    const rows = [
      { sub_id: 20, sub_title: 'Unsearched draft', sub_name: '', sub_state: 'DRAFT' },
      { sub_id: 2, sub_title: 'Published record', sub_name: 'Named record', sub_state: 'SUBMITTED' },
    ]
    expect(adminSubmissions({ status: 'success', attributes: rows })).toEqual(rows)
    expect(filterAdminRows(rows, 'draft', 'sub_state')).toEqual([rows[0]])
    expect(filterAdminRows(rows, '20', 'sub_title')).toEqual([])
    expect(adminCell(rows[0].sub_name)).toBe('Empty value')
    expect(() => adminSubmissions([{ submission_id: 20 }])).toThrow('invalid')
    expect(() => adminSubmissions([{ sub_id: 20 }, { sub_id: '20' }])).toThrow('duplicate')
    for (const value of [0, -1, true, '02', '2.5', '2147483648', undefined]) expect(adminId(value)).toBeUndefined()
  })

  it('does not turn an access denial or malformed list into an empty collection', () => {
    expect(adminRows([])).toEqual([])
    expect(() => adminRows({ status: 'failure', error: 'Permission denied', attributes: [] })).toThrow()
    expect(() => adminRows({ rows: [] })).toThrow()
    expect(() => adminRows([null])).toThrow()
    expect(() => adminRows(Array.from({ length: 10001 }, () => ({})))).toThrow('10,000')
  })

  it('preserves missing/null/zero/false and uses native Postgres booleans without granting unknown flags', () => {
    expect(adminCell(undefined, true)).toBe('Not supplied')
    expect(adminCell(null, true)).toBe('Null')
    expect(adminCell(0)).toBe('0')
    expect(adminCell(false, true)).toBe('No')
    expect(adminCell('f', true)).toBe('No')
    expect(adminCell('t', true)).toBe('Yes')
    expect(adminCell('unrecognized', true)).toBe('unrecognized')
  })

  it('renders source text as text, retains all matching rows for paging, and does not execute source HTML', () => {
    const rows = Array.from({ length: 26 }, (_, index) => ({
      sub_id: index + 1,
      sub_title: index ? `Record ${index + 1}` : '<script>attack()</script>',
      sub_state: 'DRAFT',
      sub_name: '',
    }))
    const rendered = renderToStaticMarkup(
      createElement(AdminDataTable, { title: 'Test catalogue', rows, columns: SUBMISSION_COLUMNS }),
    )
    expect(rendered).toContain('26 matching of 26 loaded records')
    expect(rendered).toContain('25 rows on this page')
    expect(rendered).toContain('&lt;script&gt;attack()&lt;/script&gt;')
    expect(rendered).not.toContain('<script>')
    expect(rendered).toContain('Test catalogue pages')
    expect(rendered).toContain('Next')
  })
})

describe('source calendar and notification semantics', () => {
  it('round trips local calendar days and creates the complete leap-month grid without UTC day drift', () => {
    const iso = scheduleDate('2024-02-29')
    expect(localCalendarDate(new Date(iso))).toBe('2024-02-29')
    for (const bad of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-10-00', '2026-10-21T00:00:00Z'])
      expect(() => scheduleDate(bad)).toThrow('valid calendar date')
    const days = calendarDays('2024-02')
    expect(days.slice(0, 4)).toEqual([null, null, null, null])
    expect(days.filter(Boolean)).toHaveLength(29)
    expect(days.filter(Boolean).at(-1)).toBe('2024-02-29')
    expect(days.length % 7).toBe(0)
    expect(() => calendarDays('2024-13')).toThrow()
  })

  it('retains multiple source markers without treating their number as task counts or accepting CSS values', () => {
    const markers = scheduleMarkers([
      { day: '2026-10-21', colour: '1a2b3c' },
      { day: '2026-10-21', colour: 'red; background: url(https://example.invalid)' },
    ])
    expect(markers.get('2026-10-21')).toEqual(['#1a2b3c', ''])
    expect(() => scheduleMarkers([{ day: '2026-02-30', colour: '000000' }])).toThrow()
  })

  it('preserves separate new-task/deadline categories and refuses an incomplete notification reply', () => {
    const task = { task_id: 5, name: 'Review', submission_id: 20, task_start: '2026-10-21', task_end: '2026-10-22' }
    expect(scheduleNotifications({ newTasks: [task], nearDeadline: [task] })).toEqual({
      newTasks: [task],
      nearDeadline: [task],
    })
    expect(scheduleNotifications({ newTasks: [], nearDeadline: [] })).toEqual({ newTasks: [], nearDeadline: [] })
    expect(() => scheduleNotifications({ newTasks: [task] })).toThrow()
    expect(() => scheduleNotifications([])).toThrow()
  })
})
