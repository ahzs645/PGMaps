import { dateColumn, numberColumn, textColumn } from '@/components/map/tableColumns'
import { getCrimeCategory } from '../constants'
import type { CrimeIncident } from '../types'

export function formatCrimeTime(time: string): string {
  if (!time || time === '00:00:00') return ''
  const parts = time.split(':')
  if (parts.length < 2) return time
  const h = parseInt(parts[0], 10)
  const m = parts[1]
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${m} ${ampm}`
}

export const CRIME_TABLE_COLUMNS = [
  dateColumn<CrimeIncident>('date', 'Date', (incident) => incident.date),
  textColumn<CrimeIncident>('time', 'Time', (incident) => formatCrimeTime(incident.time), { width: 100 }),
  textColumn<CrimeIncident>('crimeType', 'Crime type', (incident) => incident.crimeType, { width: 220 }),
  textColumn<CrimeIncident>('category', 'Category', (incident) => getCrimeCategory(incident.crimeType)),
  textColumn<CrimeIncident>('address', 'Address', (incident) => incident.address, { width: 220 }),
  textColumn<CrimeIncident>('community', 'Community', (incident) => incident.community),
  textColumn<CrimeIncident>('fileNumber', 'File number', (incident) => incident.fileNumber),
  numberColumn<CrimeIncident>('objectId', 'Source ID', (incident) => incident.id, {
    format: String,
    width: 100,
    defaultHidden: true,
  }),
]
