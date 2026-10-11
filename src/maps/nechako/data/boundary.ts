import bbox from '@turf/bbox'
import echoscreen from '../../../../public/data/projects/echoscreen-climate-health.json'
import { fetchJson } from '@/lib/fetchJson'
import { selectResearchBoundary } from '@/maps/project-explorer/adapters/researchBoundary'
import { normalizeGeojson, type VectorData } from './workspace'

// Reuse the existing project's source, identity and paint rather than copy geometry.
const layer = echoscreen.portalMap.contextLayers.find(
  (item) => item.featureProperty === 'namedWatershedId' && item.featureValue === 8886,
)!
export const NECHAKO_BOUNDARY_URL = layer.data!
export const NECHAKO_BOUNDARY_ID = 'nechako-watershed-boundary'

export function nechakoBoundary(source: unknown) {
  const { data } = selectResearchBoundary(normalizeGeojson(source), layer.featureProperty!, String(layer.featureValue))
  const vector: VectorData = {
    id: NECHAKO_BOUNDARY_ID,
    name: layer.layerName,
    data,
    color: layer.lineColor!,
    fillOpacity: layer.fillOpacity,
    lineOpacity: layer.lineOpacity,
    lineWidth: layer.lineWidth,
    visible: true,
    original: {
      source: 'Government of British Columbia Freshwater Atlas',
      sourceLayer: 'FWA_NAMED_WATERSHEDS_POLY',
      sourceUrl: NECHAKO_BOUNDARY_URL,
      project: '/dev/projects/echoscreen-climate-health',
      derivation: 'Exact feature selection from the existing 50 metre topology-preserved watershed snapshot',
      namedWatershedId: layer.featureValue,
    },
  }
  return { vector, bounds: bbox(data.features[0]) as [number, number, number, number] }
}

export async function loadNechakoBoundary(signal?: AbortSignal) {
  return nechakoBoundary(await fetchJson(NECHAKO_BOUNDARY_URL, signal))
}
