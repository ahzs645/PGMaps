export interface AirMonitor {
  id: string
  name: string
  network: string
  latitude: number
  longitude: number
  city?: string | null
  province?: string | null
  status?: string | null
  parameters: string[]
  source?: string | null
  dateObserved?: string | null
}
