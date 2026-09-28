import { featureQueryUrl, type FeatureLayerPlan } from './arcgisWebMap'

const PAGE_SIZE = 2000
/** First pixels promptly, then at most three pages in flight per visible layer. */
export async function loadFeaturePages(
  plan: FeatureLayerPlan,
  bounds: [number, number, number, number],
  resolution: number,
  signal: AbortSignal,
  publish: (features: GeoJSON.Feature[]) => void,
  request: typeof fetch = fetch,
) {
  const read = async (offset: number) => {
    signal.throwIfAborted()
    const response = await request(featureQueryUrl(plan, bounds, offset, resolution), { signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    if (data.error || !Array.isArray(data.features))
      throw new Error(String(data.error?.message ?? 'Invalid feature response'))
    if (data.exceededTransferLimit && !data.features.length) throw new Error('Source returned an empty partial page')
    return {
      features: data.features as GeoJSON.Feature[],
      more: data.exceededTransferLimit ?? data.features.length === PAGE_SIZE,
    }
  }
  const first = await read(0)
  signal.throwIfAborted()
  const features = [...first.features]
  publish([...features])
  let more = first.more
  let offset = first.features.length
  let pageSize = first.features.length
  while (more) {
    // Short partial pages imply a smaller server limit; use one page until a full page returns.
    const count = pageSize === PAGE_SIZE ? 3 : 1
    const pages = await Promise.all(Array.from({ length: count }, (_, i) => read(offset + i * PAGE_SIZE)))
    signal.throwIfAborted()
    for (const page of pages) {
      features.push(...page.features)
      offset += page.features.length
      pageSize = page.features.length
      more = page.more
      if (!more || pageSize < PAGE_SIZE) break
    }
    publish([...features])
  }
  return features
}
