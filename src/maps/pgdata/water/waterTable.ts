import { dateColumn, numberColumn, textColumn } from '@/components/map/tableColumns'
import { defineTableSource } from '@/components/map/useMapTable'
import { WATER_POINT_COLORS } from './constants'
import type { WaterFacility, WaterNoticeRow, WaterSampleRow } from './types'

export const WATER_FACILITIES_SOURCE = 'water-facilities'

interface FacilityLookup {
  byId: Map<string, WaterFacility>
  byName: Map<string, WaterFacility>
}

/** The same join the page uses for its counts, plus the point a notice with no facility was given. */
export function findRowFacility(row: WaterSampleRow | WaterNoticeRow, lookup: FacilityLookup): WaterFacility | null {
  return (
    (row.facilityId && lookup.byId.get(row.facilityId)) ||
    (row.facilityName && lookup.byName.get(row.facilityName.toLowerCase())) ||
    lookup.byId.get(`notice-point:${row.id}`) ||
    null
  )
}

function facilityCenter(facility: WaterFacility | null): [number, number] | null {
  return facility?.longitude != null && facility.latitude != null ? [facility.longitude, facility.latitude] : null
}

const FACILITY_COLUMNS = [
  textColumn<WaterFacility>('name', 'Facility', (facility) => facility.name, { width: 240 }),
  textColumn<WaterFacility>('community', 'Community', (facility) => facility.community),
  textColumn<WaterFacility>('type', 'Type', (facility) => facility.type),
  textColumn<WaterFacility>('hazard', 'Hazard rating', (facility) => facility.hazardRating, { width: 120 }),
  numberColumn<WaterFacility>(
    'bacteriological',
    'Bacteriological samples',
    (facility) => facility.bacteriologicalSamples,
  ),
  numberColumn<WaterFacility>('chemical', 'Chemical results', (facility) => facility.chemicalResults),
  numberColumn<WaterFacility>('notices', 'Active notices', (facility) => facility.activeNotices),
  dateColumn<WaterFacility>('lastSample', 'Last sample', (facility) => facility.lastSampleDate),
  textColumn<WaterFacility>('operator', 'Operator', (facility) => facility.operator, { defaultHidden: true }),
  textColumn<WaterFacility>('status', 'Status', (facility) => facility.status, { defaultHidden: true }),
]

// Sample rows can run far past the other tabs', so the search index skips date formatting.
const SAMPLE_COLUMNS = [
  textColumn<WaterSampleRow>('facility', 'Facility', (sample) => sample.facilityName, { width: 240 }),
  textColumn<WaterSampleRow>('kind', 'Kind', (sample) =>
    sample.kind === 'bacteriological' ? 'Bacteriological' : 'Chemical',
  ),
  dateColumn<WaterSampleRow>('date', 'Date', (sample) => sample.date, {
    getSearchValue: (sample) => sample.date?.toISOString().slice(0, 10) ?? '',
  }),
  textColumn<WaterSampleRow>('parameter', 'Parameter', (sample) => sample.parameter),
  textColumn<WaterSampleRow>('result', 'Result', (sample) => sample.result),
]

const NOTICE_COLUMNS = [
  textColumn<WaterNoticeRow>('facility', 'Facility', (notice) => notice.facilityName, { width: 240 }),
  textColumn<WaterNoticeRow>('type', 'Notice', (notice) => notice.type),
  textColumn<WaterNoticeRow>('status', 'Status', (notice) => notice.status, { width: 110 }),
  dateColumn<WaterNoticeRow>('date', 'Issued', (notice) => notice.date),
  textColumn<WaterNoticeRow>('location', 'Location', (notice) => notice.locationSummary, { width: 220 }),
  textColumn<WaterNoticeRow>('source', 'Source', (notice) => notice.primarySource),
]

/**
 * Facilities, samples and notices are three tables over one map of facilities, so
 * the hazard and type filters narrow all three. A row whose facility cannot be
 * found stays in, with nothing to fly to.
 */
export function buildWaterTableSources({
  facilities,
  samples,
  notices,
  lookup,
  loading,
}: {
  facilities: WaterFacility[]
  samples: WaterSampleRow[]
  notices: WaterNoticeRow[]
  lookup: FacilityLookup
  loading: boolean
}) {
  const shownIds = new Set(facilities.map((facility) => facility.id))
  const isShown = (row: WaterSampleRow | WaterNoticeRow) => {
    const facility = findRowFacility(row, lookup)
    return !facility || shownIds.has(facility.id)
  }
  const status = loading ? ('loading' as const) : ('ready' as const)

  return [
    defineTableSource<WaterFacility>({
      id: WATER_FACILITIES_SOURCE,
      label: 'Facilities',
      color: WATER_POINT_COLORS.facility,
      shape: 'point',
      rows: facilities,
      columns: FACILITY_COLUMNS,
      getRowId: (facility) => facility.id,
      getRowCenter: facilityCenter,
      status,
    }),
    defineTableSource<WaterSampleRow>({
      id: 'water-samples',
      label: 'Samples',
      color: WATER_POINT_COLORS.samples,
      shape: 'point',
      rows: () => samples.filter(isShown),
      columns: SAMPLE_COLUMNS,
      getRowId: (sample) => `${sample.kind}:${sample.facilityId}:${sample.id}`,
      getRowCenter: (sample) => facilityCenter(findRowFacility(sample, lookup)),
      status,
    }),
    defineTableSource<WaterNoticeRow>({
      id: 'water-notices',
      label: 'Notices',
      color: WATER_POINT_COLORS.notice,
      shape: 'point',
      rows: () => notices.filter(isShown),
      columns: NOTICE_COLUMNS,
      getRowId: (notice) => notice.id,
      getRowCenter: (notice) =>
        facilityCenter(findRowFacility(notice, lookup)) ??
        (notice.longitude != null && notice.latitude != null ? [notice.longitude, notice.latitude] : null),
      status,
    }),
  ]
}
