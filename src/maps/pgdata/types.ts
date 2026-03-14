export interface CrimeIncident {
  id: number
  fileNumber: string
  date: Date
  crimeType: string
  time: string
  address: string
  community: string
  latitude: number
  longitude: number
}

export type CrimeCategory =
  | 'Break & Enter'
  | 'Bike Theft'
  | 'Other Theft'
  | 'Mischief'
  | 'Theft of Vehicle'
  | 'Theft from Vehicle'
