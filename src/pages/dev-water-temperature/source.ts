import { fetchJson } from '@/lib/fetchJson'

export const UNBC = 'https://nhgwatertemp.unbc.ca'
export const WEATHER_EXPLORER_URL = `${UNBC}/?view=weather`
export const WATER_ARCHIVE_URL = 'https://zenodo.org/records/15053907'

const local = import.meta.env.DEV && import.meta.env.VITE_WATER_TEMP_LOCAL === 'true'
export const waterBase = local ? '/__dev_water_temp/' : `${UNBC}/data/`
export const waterSourceLabel = local ? 'UNBC local snapshot' : 'UNBC Northern Hydrometeorology Group'
export const waterJson = (file: string, signal?: AbortSignal) => fetchJson<unknown>(`${waterBase}${file}`, signal)

export function validFilename(value: unknown, extension: 'json' | 'csv'): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-][A-Za-z0-9_ .-]*$/.test(value) && value.endsWith(`.${extension}`)
}

export const dailyWaterFile = (filename: string) => `data/${encodeURIComponent(filename)}`

export function waterDownload(folder: 'csv' | 'airtemp', filename: string) {
  return `${UNBC}/data/${folder}/${encodeURIComponent(filename)}`
}

export function weatherFile(path: unknown): string | null {
  if (
    typeof path !== 'string' ||
    !/^\/data\/weather\/(?:[A-Za-z0-9_-]+\/)?[A-Za-z0-9_-]+\.(?:csv(?:\.gz)?|zip|xlsx)$/.test(path)
  )
    return null
  return UNBC + path
}
