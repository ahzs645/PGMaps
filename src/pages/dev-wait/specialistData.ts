export interface SpecialistProcedure {
  procedure_key: string
  procedure_name: string
  adult_flag: string | null
  cases_waiting_raw: string | null
  cases_waiting: number | null
  p50_weeks: number | null
  p90_weeks: number | null
}

export interface FacilitySpecialist {
  specialist_id: string
  specialist_name: string
  row_count: number
  case_total_known: number
  procedure_count: number
  procedures: SpecialistProcedure[]
}

export interface FacilityProcedureSummary {
  procedure_key: string
  name: string
  adult_flag: string | null
  row_count: number
  case_total_known: number
}

export interface SpecialistFacility {
  id: string
  facility_name: string
  source_facility_name: string
  health_authority: string
  address: string | null
  locality: string | null
  province: string | null
  postal_code: string | null
  latitude: number
  longitude: number
  verification_status: string | null
  source_label: string | null
  source_url: string | null
  notes: string | null
  is_rollup_child: boolean
  specialists: FacilitySpecialist[]
  procedures: FacilityProcedureSummary[]
  wait_time_row_count: number
  case_total_known: number
  specialist_count: number
  procedure_count: number
}

export interface SpecialistMapData {
  metadata: {
    latest_run_id: number
    facility_count: number
    mapped_source_facility_count: number
    rollup_child_count: number
    specialist_count: number
    procedure_count: number
  }
  facilities: SpecialistFacility[]
}

export interface FacilityWaitMetrics {
  knownCases: number
  suppressedCaseRows: number
  p50MedianWeeks: number | null
  p90MedianWeeks: number | null
  procedureRows: number
}

export const SPECIALIST_WAIT_DATA_URL = '/data/bc-wait-specialists.json'
export const SPECIALIST_WAIT_MAP_CENTER: [number, number] = [-124.4, 51.8]
export const SPECIALIST_WAIT_MAP_ZOOM = 4.7

export function formatCases(value: number | null | undefined): string {
  if (value == null) return '--'
  return value.toLocaleString()
}

export function formatWeeks(value: number | null | undefined): string {
  if (value == null) return '--'
  return `${value.toFixed(1)}w`
}

export function facilityWaitMetrics(facility: SpecialistFacility): FacilityWaitMetrics {
  const p50Values: number[] = []
  const p90Values: number[] = []
  let suppressedCaseRows = 0
  let procedureRows = 0

  facility.specialists.forEach((specialist) => {
    specialist.procedures.forEach((procedure) => {
      procedureRows += 1
      if (procedure.p50_weeks != null) p50Values.push(procedure.p50_weeks)
      if (procedure.p90_weeks != null) p90Values.push(procedure.p90_weeks)
      if (procedure.cases_waiting == null && procedure.cases_waiting_raw?.toLowerCase().includes('less than')) {
        suppressedCaseRows += 1
      }
    })
  })

  return {
    knownCases: facility.case_total_known,
    suppressedCaseRows,
    p50MedianWeeks: median(p50Values),
    p90MedianWeeks: median(p90Values),
    procedureRows,
  }
}

export function waitBand(p90Weeks: number | null | undefined): 'short' | 'medium' | 'long' | 'unknown' {
  if (p90Weeks == null) return 'unknown'
  if (p90Weeks < 12) return 'short'
  if (p90Weeks < 26) return 'medium'
  return 'long'
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2) return sorted[mid]
  return (sorted[mid - 1] + sorted[mid]) / 2
}

export function searchFacility(facility: SpecialistFacility, term: string): boolean {
  const normalized = term.trim().toLowerCase()
  if (!normalized) return true
  return [
    facility.facility_name,
    facility.source_facility_name,
    facility.health_authority,
    facility.locality,
    facility.address,
    ...facility.specialists.slice(0, 80).map((specialist) => specialist.specialist_name),
    ...facility.procedures.slice(0, 80).map((procedure) => procedure.name),
  ]
    .filter(Boolean)
    .some((value) => value?.toLowerCase().includes(normalized))
}
