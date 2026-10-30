import { describe, expect, it } from 'vitest'
import { facilityWaitMetrics, searchFacility, type SpecialistFacility } from './specialistData'

function largeFacility(): SpecialistFacility {
  const specialists = Array.from({ length: 85 }, (_, index) => ({
    specialist_id: `doctor-${index}`,
    specialist_name: index === 84 ? 'Late specialist evidence' : `Surgeon ${index}`,
    row_count: 1,
    case_total_known: 2,
    procedure_count: 1,
    procedures: [
      {
        procedure_key: `procedure-${index}`,
        procedure_name: index === 84 ? 'Late procedure evidence' : `Procedure ${index}`,
        adult_flag: 'Y',
        cases_waiting_raw: '2',
        cases_waiting: 2,
        p50_weeks: 4,
        p90_weeks: 30,
      },
    ],
  }))
  return {
    id: 'large-facility',
    facility_name: 'Large facility',
    source_facility_name: 'Source facility',
    health_authority: 'Health authority',
    address: null,
    locality: null,
    province: 'BC',
    postal_code: null,
    latitude: 51.8,
    longitude: -124.4,
    verification_status: 'fixture',
    source_label: 'Fixture',
    source_url: null,
    notes: null,
    is_rollup_child: false,
    specialists,
    procedures: specialists.map((specialist) => ({
      procedure_key: specialist.procedures[0].procedure_key,
      name: specialist.procedures[0].procedure_name,
      adult_flag: 'Y',
      row_count: 1,
      case_total_known: 2,
    })),
    wait_time_row_count: specialists.length,
    case_total_known: specialists.length * 2,
    specialist_count: specialists.length,
    procedure_count: specialists.length,
  }
}

describe('complete specialist facility search', () => {
  it('finds a specialist after the former first-80 search limit, case insensitively', () => {
    expect(searchFacility(largeFacility(), '  LATE SPECIALIST EVIDENCE  ')).toBe(true)
  })

  it('finds a procedure after the former first-80 search limit', () => {
    expect(searchFacility(largeFacility(), 'Late procedure evidence')).toBe(true)
  })

  it('preserves search defaults, source data and full wait aggregation', () => {
    const facility = largeFacility()
    const before = structuredClone(facility)
    expect(searchFacility(facility, '')).toBe(true)
    expect(searchFacility(facility, 'Unrelated evidence')).toBe(false)
    expect(searchFacility(facility, 'Late specialist')).toBe(true)
    expect(facility).toEqual(before)
    expect(facilityWaitMetrics(facility)).toMatchObject({
      knownCases: 170,
      procedureRows: 85,
      p50MedianWeeks: 4,
      p90MedianWeeks: 30,
    })
  })
})
