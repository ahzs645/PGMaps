import type { FeatureCollection } from 'geojson'
import { prepareLayer, FEATURE_ID_KEY } from '../dev-data/layerData'
import type { MissionLayer } from './model'

/** Persist source identities so hiding/deleting an earlier feature cannot retarget an edit. */
export function identifyFeatures(data: FeatureCollection): FeatureCollection {
  const used = new Set<string>(),
    reserved = new Set(data.features.flatMap((f) => (f.id == null ? [] : [String(f.id)])))
  return {
    ...data,
    features: data.features.map((f, index) => {
      let id = f.id
      let suffix = 0
      if (id == null || used.has(String(id))) {
        id = `feature-${index}`
        while (reserved.has(String(id)) || used.has(String(id))) id = `feature-${index}-${++suffix}`
      }
      used.add(String(id))
      return { ...f, id }
    }),
  }
}
export function featureKey(layerId: string, id: string | number) {
  return `${layerId}:${encodeURIComponent(String(id))}`
}
export function sourceFeatureKey(layer: MissionLayer, index: number) {
  return featureKey(layer.id, layer.data.features[index]?.id ?? `feature-${index}`)
}
export function featureIndex(layer: MissionLayer, key: string) {
  return layer.data.features.findIndex((_, i) => sourceFeatureKey(layer, i) === key)
}
export function prepareMissionLayer(layer: MissionLayer) {
  const prepared = prepareLayer(layer, layer.data)
  return {
    ...prepared,
    collection: {
      ...prepared.collection,
      features: prepared.collection.features.map((f, i) => ({
        ...f,
        properties: { ...f.properties, [FEATURE_ID_KEY]: sourceFeatureKey(layer, i) },
      })),
    },
  }
}
