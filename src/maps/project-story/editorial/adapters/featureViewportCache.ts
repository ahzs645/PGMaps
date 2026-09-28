import type { FeatureLayerPlan } from './arcgisWebMap'

type Bounds = [number, number, number, number]
interface Entry {
  key: string
  bounds: Bounds
  resolution: number
  features: GeoJSON.Feature[]
  positions: number
}
export const featurePlanKey = (plan: FeatureLayerPlan) => JSON.stringify([plan.url, plan.where, plan.fields])
const contains = (outer: Bounds, inner: Bounds) =>
  outer[0] <= inner[0] + 1e-9 &&
  outer[1] <= inner[1] + 1e-9 &&
  outer[2] >= inner[2] - 1e-9 &&
  outer[3] >= inner[3] - 1e-9
function positions(value: unknown): number {
  if (!Array.isArray(value)) return 0
  return typeof value[0] === 'number' ? 1 : value.reduce((count, child) => count + positions(child), 0)
}
/** Per-map, completed views only. Bounds and precision must both cover a cache hit. */
export class FeatureViewportCache {
  private entries: Entry[] = []
  constructor(
    private maxFeatures = 60_000,
    private maxPositions = 500_000,
    private maxEntries = 4,
  ) {}
  get(plan: FeatureLayerPlan, bounds: Bounds, resolution: number) {
    const key = featurePlanKey(plan)
    const index = this.entries.findIndex(
      (entry) => entry.key === key && contains(entry.bounds, bounds) && entry.resolution <= resolution * (1 + 1e-9),
    )
    if (index < 0) return undefined
    const [entry] = this.entries.splice(index, 1)
    this.entries.push(entry)
    return entry.features
  }
  put(plan: FeatureLayerPlan, bounds: Bounds, resolution: number, features: GeoJSON.Feature[]) {
    const count = features.reduce(
      (sum, feature) =>
        sum + positions(feature.geometry && 'coordinates' in feature.geometry ? feature.geometry.coordinates : []),
      0,
    )
    if (features.length > this.maxFeatures || count > this.maxPositions) return
    const key = featurePlanKey(plan)
    this.entries = this.entries.filter(
      (entry) => !(entry.key === key && entry.resolution >= resolution && contains(bounds, entry.bounds)),
    )
    this.entries.push({ key, bounds, resolution, features, positions: count })
    while (
      this.entries.length > this.maxEntries ||
      this.entries.reduce((sum, entry) => sum + entry.features.length, 0) > this.maxFeatures ||
      this.entries.reduce((sum, entry) => sum + entry.positions, 0) > this.maxPositions
    )
      this.entries.shift()
  }
}
