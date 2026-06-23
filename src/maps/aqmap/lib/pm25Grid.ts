// Shared helpers for the ECCC GeoMet RAQDPS PM2.5 snapshots. Raster mode uses
// WMS-rendered PNG snapshot tiles copied from bcdatamapper; deck.gl and vector
// modes use the paired classified polygon snapshot derived from the native
// RAQDPS GRIB2 grid.

export const PM25_NATIVE_VECTOR_URL = '/data/aqmap/modelled-pm25-native-vector.geojson.gz'

export const PM25_VECTOR_COLORS = [
  { value: 0, color: '#21c5f4' },
  { value: 10, color: '#1899c9' },
  { value: 20, color: '#0d6796' },
  { value: 30, color: '#fefc37' },
  { value: 40, color: '#fecb2e' },
  { value: 50, color: '#fd993f' },
  { value: 60, color: '#fc6769' },
  { value: 70, color: '#fe3b3b' },
  { value: 80, color: '#fe0101' },
  { value: 90, color: '#ca0713' },
  { value: 100, color: '#650205' },
] as const

export function pm25Color(value: number): string {
  return [...PM25_VECTOR_COLORS].reverse().find((stop) => value >= stop.value)?.color ?? PM25_VECTOR_COLORS[0].color
}

/** Fetch a (optionally gzipped) JSON document, transparently inflating gzip. */
export async function fetchGzipJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, signal ? { signal } : undefined)
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`)
  const buffer = await response.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b

  if (isGzip && typeof DecompressionStream !== 'undefined') {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
    const text = await new Response(stream).text()
    return JSON.parse(text) as T
  }

  return JSON.parse(new TextDecoder().decode(bytes)) as T
}
