import { fetchGzipText, fetchJson } from '@/lib/fetchJson'

export const REMEDIATION_CATALOGUE = 'https://catalogue.data.gov.bc.ca/dataset/environmental-remediation-sites'
export const REMEDIATION_ARCGIS = 'https://delivery.maps.gov.bc.ca/arcgis/rest/services/whse/bcgw_pub_whse_waste/MapServer/3'
export const REMEDIATION_R2_BASE = 'https://data.map.ahmad.sh/bc/environmental-remediation/v1/'

export type SiteProperties = {
  siteId: number
  name: string | null
  address: string | null
  description: string | null
  victoriaFile: string | null
  regionalFile: string | null
}
export type Site = GeoJSON.Feature<GeoJSON.Point, SiteProperties>
export type SiteCollection = GeoJSON.FeatureCollection<GeoJSON.Point, SiteProperties>
export interface RemediationManifest {
  schemaVersion: number
  downloadedAt: string
  featureCount: number
  resource: string
  bytes: number
  gzipBytes: number
  sha256: string
  license: string
}

export function filterSites(collection: SiteCollection, search: string): SiteCollection {
  const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return collection
  return {
    type: 'FeatureCollection',
    features: collection.features.filter(({ properties: p }) => {
      const text = [p.siteId, p.name, p.address, p.victoriaFile, p.regionalFile].join(' ').toLocaleLowerCase()
      return terms.every((term) => text.includes(term))
    }),
  }
}

export async function loadRemediation(signal: AbortSignal) {
  const base = REMEDIATION_R2_BASE
  let manifest: RemediationManifest
  try {
    manifest = await fetchJson<RemediationManifest>(`${base}map-manifest.json`, signal)
  } catch {
    throw new Error('Remediation snapshot unavailable from R2. Try again later.')
  }
  if (manifest.schemaVersion !== 1 || !/^sites-[a-f0-9]{64}\.geojson\.gz$/.test(manifest.resource)) {
    throw new Error('Unrecognized remediation snapshot manifest.')
  }
  const data = await fetchGzipText(base + manifest.resource, signal)
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))))
    .map((byte) => byte.toString(16).padStart(2, '0')).join('')
  if (digest !== manifest.sha256) throw new Error('Snapshot integrity check failed.')
  const collection = JSON.parse(data) as SiteCollection
  if (collection.type !== 'FeatureCollection' || collection.features.length !== manifest.featureCount) {
    throw new Error('Snapshot count does not match its manifest.')
  }
  return { manifest, collection }
}
