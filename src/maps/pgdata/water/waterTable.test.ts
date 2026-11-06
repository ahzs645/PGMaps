import { describe, expect, it } from 'vitest'
import { buildWaterTableSources, findRowFacility } from './waterTable'
import type { WaterFacility, WaterNoticeRow, WaterSampleRow } from './types'

function facility(overrides: Partial<WaterFacility>): WaterFacility {
  return {
    id: 'f',
    name: 'Facility',
    operator: '',
    type: '',
    status: '',
    hazardRating: 'Low',
    address: '',
    community: '',
    latitude: 54,
    longitude: -122,
    bacteriologicalSamples: 0,
    chemicalResults: 0,
    activeNotices: 0,
    lastSampleDate: null,
    source: {},
    ...overrides,
  }
}

function sample(overrides: Partial<WaterSampleRow>): WaterSampleRow {
  return {
    id: 's',
    facilityId: '',
    facilityName: '',
    kind: 'chemical',
    date: null,
    parameter: '',
    result: '',
    source: {},
    ...overrides,
  }
}

function notice(overrides: Partial<WaterNoticeRow>): WaterNoticeRow {
  return {
    id: 'n',
    facilityId: '',
    facilityName: '',
    type: '',
    status: '',
    date: null,
    latitude: null,
    longitude: null,
    locationSummary: '',
    primarySource: '',
    mergeBucket: '',
    sourceCount: 1,
    source: {},
    ...overrides,
  }
}

const shown = facility({ id: 'shown', name: 'Shown Water' })
const filteredOut = facility({ id: 'hidden', name: 'Hidden Water' })
const unmapped = facility({ id: 'unmapped', name: 'Unmapped', latitude: null, longitude: null })
const noticePoint = facility({ id: 'notice-point:n9', name: 'Notice 9', noticeOnly: true })
const lookup = {
  byId: new Map([shown, filteredOut, unmapped, noticePoint].map((item) => [item.id, item])),
  byName: new Map([shown, filteredOut, unmapped, noticePoint].map((item) => [item.name.toLowerCase(), item])),
}

function rowsOf(source: ReturnType<typeof buildWaterTableSources>[number]) {
  return typeof source.rows === 'function' ? source.rows() : source.rows
}

describe('findRowFacility', () => {
  it('joins on the facility id, then the name, then the point a notice was given', () => {
    expect(findRowFacility(sample({ facilityId: 'shown', facilityName: 'Hidden Water' }), lookup)).toBe(shown)
    expect(findRowFacility(sample({ facilityName: 'HIDDEN WATER' }), lookup)).toBe(filteredOut)
    expect(findRowFacility(notice({ id: 'n9' }), lookup)).toBe(noticePoint)
    expect(findRowFacility(sample({ facilityId: 'gone' }), lookup)).toBeNull()
  })
})

describe('buildWaterTableSources', () => {
  const [facilities, samples, notices] = buildWaterTableSources({
    facilities: [shown, unmapped],
    samples: [
      sample({ id: 'a', facilityId: 'shown' }),
      sample({ id: 'b', facilityId: 'hidden' }),
      sample({ id: 'c', facilityId: 'unmapped' }),
      sample({ id: 'd', facilityId: 'gone' }),
    ],
    notices: [
      notice({ id: 'n1', facilityId: 'hidden' }),
      notice({ id: 'n2', latitude: 50, longitude: -120 }),
      notice({ id: 'n3', facilityId: 'shown', latitude: 50, longitude: -120 }),
    ],
    lookup,
    loading: false,
  })

  it('drops rows of facilities the filters hid, and keeps rows with no facility to join', () => {
    expect(rowsOf(facilities)).toHaveLength(2)
    expect((rowsOf(samples) as WaterSampleRow[]).map((row) => row.id)).toEqual(['a', 'c', 'd'])
    expect((rowsOf(notices) as WaterNoticeRow[]).map((row) => row.id)).toEqual(['n2', 'n3'])
  })

  it('flies a row to its facility, its own point, or nowhere', () => {
    expect(samples.getRowCenter?.(sample({ facilityId: 'shown' }))).toEqual([-122, 54])
    expect(samples.getRowCenter?.(sample({ facilityId: 'unmapped' }))).toBeNull()
    expect(samples.getRowCenter?.(sample({ facilityId: 'gone' }))).toBeNull()
    expect(facilities.getRowCenter?.(unmapped)).toBeNull()
    expect(notices.getRowCenter?.(notice({ id: 'n2', latitude: 50, longitude: -120 }))).toEqual([-120, 50])
  })

  it('keeps sample ids apart across kinds and facilities', () => {
    const ids = [
      sample({ id: 'x', facilityId: 'a', kind: 'chemical' }),
      sample({ id: 'x', facilityId: 'b', kind: 'chemical' }),
      sample({ id: 'x', facilityId: 'a', kind: 'bacteriological' }),
    ].map((row) => samples.getRowId(row))
    expect(new Set(ids).size).toBe(3)
  })
})
