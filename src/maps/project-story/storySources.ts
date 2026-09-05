import type { ProjectStoryLayerDef } from '@/lib/projectPackages'
import { fetchJson } from '@/lib/fetchJson'

export function storySourceKey(layer: ProjectStoryLayerDef): string {
  return JSON.stringify([layer.data, layer.attributes ?? null])
}

export async function loadStorySource(
  layer: ProjectStoryLayerDef,
  signal: AbortSignal,
): Promise<GeoJSON.FeatureCollection> {
  const join = layer.attributes
  const [boundaries, attributes] = await Promise.all([
    fetchJson<GeoJSON.FeatureCollection>(layer.data, signal),
    join ? fetchJson<Record<string, unknown>>(join.data, signal) : undefined,
  ])
  if (boundaries.type !== 'FeatureCollection' || !Array.isArray(boundaries.features)) {
    throw new Error('Source is not a GeoJSON feature collection')
  }
  if (!join || !attributes) return boundaries
  const records = attributes[join.recordsProperty ?? 'records']
  if (!Array.isArray(records)) throw new Error('Attribute source has no records array')
  const byId = new Map(
    records
      .filter((record): record is Record<string, unknown> => Boolean(record && typeof record === 'object'))
      .map((record) => [String(record[join.attributeProperty]), record]),
  )
  return {
    ...boundaries,
    features: boundaries.features.map((feature) => {
      const properties = feature.properties ?? {}
      const extra = byId.get(String(properties[join.boundaryProperty]))
      return extra ? { ...feature, properties: { ...properties, ...extra } } : feature
    }),
  }
}

export type StorySourceState =
  | { status: 'loading' }
  | { status: 'ready'; data: GeoJSON.FeatureCollection }
  | { status: 'error'; message: string }

/** Instance-scoped active sources only: deduplicate requests, release inactive data,
 * abort obsolete work, and publish successes independently of failed neighbours. */
export class StorySourceStore {
  private entries = new Map<
    string,
    { layer: ProjectStoryLayerDef; controller: AbortController; state: StorySourceState }
  >()
  private snapshot = new Map<string, StorySourceState>()
  private listeners = new Set<() => void>()
  constructor(private load = loadStorySource) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  getSnapshot = () => this.snapshot
  private publish() {
    this.snapshot = new Map([...this.entries].map(([key, entry]) => [key, entry.state]))
    this.listeners.forEach((listener) => listener())
  }
  private start(layer: ProjectStoryLayerDef) {
    const key = storySourceKey(layer)
    const entry = { layer, controller: new AbortController(), state: { status: 'loading' } as StorySourceState }
    this.entries.set(key, entry)
    this.load(layer, entry.controller.signal).then(
      (data) => {
        if (this.entries.get(key) !== entry || entry.controller.signal.aborted) return
        entry.state = { status: 'ready', data }
        this.publish()
      },
      (error) => {
        if (this.entries.get(key) !== entry || entry.controller.signal.aborted) return
        entry.controller.abort()
        entry.state = { status: 'error', message: error instanceof Error ? error.message : 'Source unavailable' }
        this.publish()
      },
    )
  }
  setSources(layers: ProjectStoryLayerDef[]) {
    const requested = new Map(layers.map((layer) => [storySourceKey(layer), layer]))
    let changed = false
    for (const [key, entry] of this.entries)
      if (!requested.has(key)) {
        entry.controller.abort()
        this.entries.delete(key)
        changed = true
      }
    for (const [key, layer] of requested)
      if (!this.entries.has(key)) {
        this.start(layer)
        changed = true
      }
    if (changed) this.publish()
  }
  retry = () => {
    for (const entry of this.entries.values()) if (entry.state.status === 'error') this.start(entry.layer)
    this.publish()
  }
  dispose = () => {
    for (const entry of this.entries.values()) entry.controller.abort()
    this.entries.clear()
    this.publish()
  }
}
