export type WaitStatus = 'quick' | 'moderate' | 'packed' | 'unknown' | 'closed'
export type WaitSource = 'official' | 'crowd' | 'predicted' | 'none'

export interface ErstatHospital {
  id: string
  name: string
  address: string | null
  city: string | null
  province: string | null
  postal_code: string | null
  lat: number
  lng: number
  has_er: number | boolean
  phone: string | null
  website: string | null
  official_status: string | null
  official_status_message: string | null
  er_wait_minutes: number | null
  er_wait_lower_minutes: number | null
  er_wait_upper_minutes: number | null
  er_wait_avg_minutes: number | null
  er_elos_minutes: number | null
  predicted_wait_minutes: number | null
  predicted_wait_lower: number | null
  predicted_wait_upper: number | null
  predicted_confidence: string | null
  predicted_at: string | null
  data_source: string | null
  data_updated_at: string | null
  official_updated_at: string | null
  advisory_status: string | null
  advisory_message: string | null
  wait_status: string | null
  wait_display: string | null
  service_level: string | null
}

export interface WaitHospital extends ErstatHospital {
  waitMinutes: number | null
  waitLabel: string
  status: WaitStatus
  source: WaitSource
}

export const WAIT_DATA_URL = '/data/erstat-hospitals.json'
export const WAIT_MAP_CENTER: [number, number] = [-96, 56]
export const WAIT_MAP_ZOOM = 3.1

export const PROVINCE_NAMES: Record<string, string> = {
  AB: 'Alberta',
  BC: 'British Columbia',
  MB: 'Manitoba',
  NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador',
  NS: 'Nova Scotia',
  NT: 'Northwest Territories',
  NU: 'Nunavut',
  ON: 'Ontario',
  PE: 'Prince Edward Island',
  QC: 'Quebec',
  SK: 'Saskatchewan',
  YT: 'Yukon',
}

export function formatWait(minutes: number | null): string {
  if (minutes == null) return '--'
  const rounded = Math.max(0, Math.round(minutes))
  const hours = Math.floor(rounded / 60)
  const mins = rounded % 60
  if (hours === 0) return `${mins}m`
  if (mins === 0) return `${hours}h`
  return `${hours}h ${mins}m`
}

export function waitStatus(minutes: number | null): WaitStatus {
  if (minutes == null) return 'unknown'
  if (minutes < 120) return 'quick'
  if (minutes < 300) return 'moderate'
  return 'packed'
}

export function normalizeHospital(hospital: ErstatHospital): WaitHospital {
  const officialWait = hospital.er_elos_minutes ?? hospital.er_wait_minutes ?? hospital.er_wait_avg_minutes
  const isClosed = hospital.official_status === 'closed'
  const hasPredicted = officialWait == null && hospital.predicted_wait_minutes != null && hospital.predicted_confidence !== 'low'
  const waitMinutes = officialWait ?? (hasPredicted ? hospital.predicted_wait_minutes : null)
  const source: WaitSource = officialWait != null
    ? hospital.er_wait_minutes != null || hospital.er_elos_minutes != null ? 'official' : 'crowd'
    : hasPredicted ? 'predicted' : 'none'

  return {
    ...hospital,
    waitMinutes,
    waitLabel: isClosed
      ? 'Closed'
      : source === 'predicted'
        ? `~${formatWait(hospital.predicted_wait_upper ?? waitMinutes)}`
        : formatWait(waitMinutes),
    status: isClosed ? 'closed' : waitStatus(waitMinutes),
    source,
  }
}

export function newestTimestamp(hospitals: WaitHospital[]): string | null {
  const latest = hospitals
    .map((hospital) => hospital.data_updated_at ?? hospital.official_updated_at ?? hospital.predicted_at)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value.endsWith('Z') || value.includes('+') ? value : `${value}Z`).getTime())
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a)[0]

  return latest ? new Date(latest).toLocaleString() : null
}
