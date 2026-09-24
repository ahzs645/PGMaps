import type { FeatureCollection } from 'geojson'
export const WAVE_PERIODS: Record<number, string> = { 2: '2004–2007', 3: '2007–2009', 4: '2009–2011', 5: '2011–2013', 6: '2013–2016', 7: '2016–2019', 8: '2019–2022', 9: '2022–2026' }
export interface Calculation { status: 'matches' | 'differs' | 'unavailable'; value?: number; numerator?: number; denominator?: number; reason?: string; differencePp?: number }
export interface Observation { wave: number; measure: string; value: number | null; status: string; raw?: string; calculation?: Calculation }
export interface Region { detailWave?: number; detailWaveSelection?: string; disabledWaves?: number[]; id: string; name: string; observations: Observation[]; meaningfulChange?: Record<string, string>; subscaleChange?: Record<string, string>; demographics?: string; participation?: string }
export interface Family { regions: Region[] }
export interface BlobRef { path: string; sha256: string }
export interface Measure { id: string; label: string; unit: 'percent' | 'count' | 'standardized_score' }
export interface MapJoin { policy: 'captured_wave' | 'inferred_by_region_id'; boundaryRelease: string; basis?: string; families?: Record<string, { eligible: boolean; overlappingValues: number; disagreements: number }> }
export interface Dataset { id: string; label: string; source: string; waves: number[]; measures: Measure[]; families: Record<string, BlobRef>; notes: string; mapJoin?: MapJoin; capture?: { complete: boolean; completed?: number; inventoryRegions?: number; failures?: unknown[] } }
// Schema 1 wrote one asset per wave map ('dashboard_only'); schema 2 shares one polygon library per family and lists each wave's regionIds ('edi_wave').
export interface Boundary extends BlobRef { regionNames?: Record<string, string>; regionIds?: string[]; reportedWaves?: number[]; id: string; family: string; label: string; edition: string | null; retrievedAt: string | null; source: string; features: number; joinPolicy: 'dashboard_only' | 'edi_wave' | 'reference_only'; coverage?: Record<string, { missingGeometry: string[]; geometryWithoutResults: string[] }> }
export interface CrosswalkSummary { reference: string; referenceSha256: string; publisherSha256: string; counts: Record<string, number> }
export interface Manifest { releaseId: string; schemaVersion?: number; families: Record<string, string>; datasets: Dataset[]; boundaries: Boundary[]; gaps: string[]; crosswalk?: BlobRef & { thresholds: { sameAreaIoU: number }; families: Record<string, CrosswalkSummary> }; boundaryStorage?: { snapshots: number; uniqueGeometryAssets: number; compressedBytes?: Record<string, number> } }
export interface Overlap { id: string; shareOfThis: number; shareOfOther: number }
export interface CrosswalkEntry { status: 'same_area' | 'changed' | 'not_in_reference'; iou?: number; overlaps?: Overlap[] }
export interface CrosswalkFamily { regions: Record<string, CrosswalkEntry>; referenceOnly: Record<string, { overlaps: Overlap[] }> }
export interface Crosswalk { families: Record<string, CrosswalkFamily> }
/** How a boundary may show a dataset's values: on the publisher's own polygons, on current polygons the crosswalk finds unchanged, or not at all. */
export type Join = { kind: 'none' } | { kind: 'publisher' | 'crosswalk'; inferred: boolean; regionIds?: string[] }
export function boundaryWithNames(geometry: FeatureCollection, names?: Record<string, string>, regionIds?: string[]): FeatureCollection {
  const members = regionIds && new Set(regionIds)
  const features = members ? geometry.features.filter(f => members.has(String(f.properties?.regionId))) : geometry.features
  if (!names) return members ? { ...geometry, features } : geometry // Older immutable releases keep names in the blob.
  return { ...geometry, features: features.map(f => ({ ...f, properties: { ...f.properties, regionName: names[String(f.properties?.regionId)] ?? f.properties?.regionName ?? f.properties?.regionId } })) }
}
export function joinFor(manifest: Manifest | undefined, dataset: Dataset | undefined, boundary: Boundary | undefined, wave: number): Join {
  const none: Join = { kind: 'none' }
  if (!manifest || !dataset || !boundary) return none
  // Schema 1 manifests carry no mapJoin: only a dashboard release maps, onto its own capture.
  const release = dataset.mapJoin?.boundaryRelease ?? (dataset.id.startsWith('dashboard-') ? dataset.id : undefined)
  const inferred = dataset.mapJoin?.policy === 'inferred_by_region_id'
  if (!release || (inferred && !dataset.mapJoin?.families?.[boundary.family]?.eligible)) return none
  const waveMap = (b: Boundary) => b.joinPolicy !== 'reference_only' && b.family === boundary.family && b.id.startsWith(`${release}-`) && Boolean(b.reportedWaves?.includes(wave))
  if (boundary.joinPolicy !== 'reference_only') return waveMap(boundary) ? { kind: 'publisher', inferred } : none
  // A reference edition shows values only through a crosswalk computed against these exact coordinates.
  const crosswalk = manifest.crosswalk?.families[boundary.family]
  const drawn = crosswalk && boundary.sha256 === crosswalk.referenceSha256 && manifest.boundaries.find(b => waveMap(b) && b.sha256 === crosswalk.publisherSha256)
  return drawn ? { kind: 'crosswalk', inferred, regionIds: drawn.regionIds } : none
}
export function getObservation(region: Region | undefined, wave: number, measure: string) {
  return region?.observations.find(o => o.wave === wave && o.measure === measure)
}
export function formatObservation(observation: Observation | undefined, unit: Measure['unit'] = 'percent') {
  if (!observation) return 'No value in this release'
  if (observation.value === null) {
    const labels: Record<string, string> = { not_collected_for_wave: 'Not collected for this wave', publisher_disabled: 'Unavailable from publisher', outside_reporting_period: 'Outside reporting period', not_reported_in_chart: 'Not reported in chart' }
    return observation.raw ? `Source: ${observation.raw}` : labels[observation.status] ?? 'Not reported / suppressed'
  }
  return observation.value.toLocaleString('en-CA', { minimumFractionDigits: unit === 'count' ? 0 : unit === 'percent' ? 1 : 2, maximumFractionDigits: unit === 'count' ? 0 : 2 }) + (unit === 'percent' ? '%' : '')
}
export function mapValues(geometry: FeatureCollection, family: Family | undefined, wave: number, measure: string, join: Join, crosswalk?: CrosswalkFamily): FeatureCollection {
  const regions = new Map((family?.regions ?? []).map(r => [r.id, r]))
  const drawn = join.kind === 'crosswalk' && join.regionIds ? new Set(join.regionIds) : undefined
  return { ...geometry, features: geometry.features.map(f => {
    const id = String(f.properties?.regionId)
    if (join.kind === 'none') return { ...f, properties: { ...f.properties, value: null, status: 'reference_only' } }
    if (join.kind === 'crosswalk') {
      const entry = crosswalk?.regions[id]
      // Never move a value between polygons: changed and newer areas stay unassigned.
      if (!entry) return { ...f, properties: { ...f.properties, value: null, status: 'not_in_edi' } }
      if (entry.status !== 'same_area') return { ...f, properties: { ...f.properties, value: null, status: 'boundary_changed' } }
      if (drawn && !drawn.has(id)) return { ...f, properties: { ...f.properties, value: null, status: 'no_result' } }
    }
    const o = getObservation(regions.get(id), wave, measure)
    return { ...f, properties: { ...f.properties, value: o?.value ?? null, status: o?.status ?? 'no_result' } }
  }) }
}
/** Plain-language comparison of an area code with the current official edition, for the sidebar and tooltips. */
export function describeCrosswalk(crosswalk: CrosswalkFamily | undefined, id: string, names: { current: (id: string) => string; edi: (id: string) => string }) {
  if (!crosswalk) return undefined
  const list = (overlaps: Overlap[] = [], name: (id: string) => string) => overlaps.filter(o => o.shareOfThis >= 0.05).map(o => `${name(o.id)} (${o.id.replace(/^[A-Z]+_/, '')}, ${Math.round(o.shareOfThis * 100)}%)`).join(', ')
  const entry = crosswalk.regions[id]
  if (entry?.status === 'same_area') return `Same area as the current official boundary (${Math.round((entry.iou ?? 0) * 1000) / 10}% overlap), so its values can be shown there.`
  if (entry) {
    const parts = list(entry.overlaps, names.current)
    return `${entry.status === 'changed' ? 'The current official area with this code covers a different area' : 'This code is not in the current official boundaries'}. ${parts ? `The EDI area is now covered by ${parts}. ` : ''}Its values stay on the EDI polygon and are not reassigned.`
  }
  const earlier = crosswalk.referenceOnly[id]
  if (earlier) {
    const parts = list(earlier.overlaps, names.edi)
    return `Created after the EDI boundaries${parts ? `; it was part of ${parts}` : ''}. No EDI value is published for it.`
  }
  return undefined
}
