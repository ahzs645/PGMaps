import type { BcGeocoderResponse, DroppedLocation, GeocodeResult } from './types'

const BC_GEOCODER_URL = 'https://geocoder.api.gov.bc.ca/addresses.json'

function parseFaults(faults: unknown[] | undefined) {
  if (!faults) return []
  return faults.map((fault) => {
    if (typeof fault === 'string') return fault
    if (fault && typeof fault === 'object' && 'value' in fault) return String(fault.value)
    return String(fault)
  })
}

export async function geocodeAddress(address: string, signal?: AbortSignal): Promise<GeocodeResult> {
  const params = new URLSearchParams({
    addressString: address,
    maxResults: '1',
    interpolation: 'adaptive',
    echo: 'true',
    brief: 'false',
    autoComplete: 'false',
    setBack: '0',
    outputSRS: '4326',
  })

  const response = await fetch(`${BC_GEOCODER_URL}?${params.toString()}`, { signal })
  if (!response.ok) {
    throw new Error(`BC Address Geocoder returned ${response.status}`)
  }

  const data = await response.json() as BcGeocoderResponse
  const feature = data.features?.[0]
  const coordinates = feature?.geometry?.coordinates
  if (!feature || !coordinates || coordinates.length < 2) {
    throw new Error('No B.C. address match found')
  }

  return {
    fullAddress: feature.properties?.fullAddress ?? address,
    longitude: coordinates[0],
    latitude: coordinates[1],
    score: feature.properties?.score ?? 0,
    matchPrecision: feature.properties?.matchPrecision ?? 'Unknown',
    precisionPoints: feature.properties?.precisionPoints ?? 0,
    faults: parseFaults(feature.properties?.faults),
    baseDataDate: data.baseDataDate ?? '',
    searchTimestamp: data.searchTimestamp ?? '',
  }
}

export function locationFromCoordinates({ latitude, longitude, label }: DroppedLocation): GeocodeResult {
  return {
    fullAddress: label ?? `Dropped map point (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`,
    latitude,
    longitude,
    score: 0,
    matchPrecision: 'Map point',
    precisionPoints: 0,
    faults: [],
    baseDataDate: '',
    searchTimestamp: new Date().toISOString(),
  }
}
