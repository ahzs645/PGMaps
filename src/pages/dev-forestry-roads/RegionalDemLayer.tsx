import { RegionalReliefLayer } from '@/components/ui/map-regional-relief'

/** The plan's relief layers, lowest first. */
export const RELIEF_LAYER_IDS = ['road-regional-hillshade', 'road-hrdem-relief'] as const

const INTENSITY = { plain: 0.35, imagery: 0.2 }

/** The plan's regional hillshade, kept over imagery together with the HRDEM relief. */
export function RegionalDemLayer({ visible, imagery }: { visible: boolean; imagery: boolean }) {
  return (
    <RegionalReliefLayer
      id="road-regional"
      visible={visible}
      imagery={imagery}
      intensity={INTENSITY}
      reliefLayerIds={RELIEF_LAYER_IDS}
    />
  )
}
