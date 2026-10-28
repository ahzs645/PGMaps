import { Table2 } from 'lucide-react'
import { MapPopup } from '@/components/ui/map'
import { KeyValueRows } from '@/components/ui/map-panels'
import { MapPopupCard } from '@/components/ui/map-popup-card'
import { MobileFeatureCard } from '@/components/ui/mobile-feature-card'
import { TextButton } from '@/components/ui/text-button'
import { featureRows, featureSummaryRows, featureTitle, type DataFeature, type LoadedLayer } from './layerData'
import type { DataLayer } from './model'

export interface SelectedFeature {
  feature: DataFeature
  layerId: string
  /** Where the popup points: the click, or the feature's centre when picked in the table. */
  anchor: [number, number]
  nonce: number
}

function detailRows(feature: DataFeature, layer: DataLayer, loaded: LoadedLayer) {
  return featureSummaryRows(feature, layer, loaded.attributes).map(([label, value]) => ({ key: label, label, value }))
}

/** Felt-style popup: layer name, the feature's title and its key fields. Desktop only; must render inside the map. */
export function FeaturePopup({
  selected,
  layer,
  loaded,
  onClose,
  onShowInTable,
}: {
  selected: SelectedFeature
  layer: DataLayer
  loaded: LoadedLayer
  onClose: () => void
  onShowInTable: () => void
}) {
  return (
    <MapPopup
      key={`${selected.feature.properties.__devDataId}:${selected.nonce}`}
      longitude={selected.anchor[0]}
      latitude={selected.anchor[1]}
      onClose={onClose}
      maxWidth="320px"
    >
      <MapPopupCard
        className="w-72"
        eyebrow={layer.label}
        title={featureTitle(selected.feature, layer, loaded.attributes)}
        onClose={onClose}
        actions={
          <TextButton onClick={onShowInTable}>
            <Table2 className="mr-1 inline size-3.5" aria-hidden="true" />
            Show in table
          </TextButton>
        }
      >
        <KeyValueRows variant="grid" rows={detailRows(selected.feature, layer, loaded)} />
      </MapPopupCard>
    </MapPopup>
  )
}

/** The same details as a bottom-sheet card on phones, every field included. */
export function FeatureCard({
  selected,
  layer,
  loaded,
  onClose,
}: {
  selected: SelectedFeature
  layer: DataLayer
  loaded: LoadedLayer
  onClose: () => void
}) {
  const rows = featureRows(
    selected.feature,
    loaded.attributes.filter((attribute) => !attribute.system),
  ).map(([label, value]) => ({
    key: label,
    label,
    value,
  }))
  return (
    <MobileFeatureCard
      stackId="dev-data-feature"
      title={featureTitle(selected.feature, layer, loaded.attributes)}
      subtitle={layer.label}
      closeOnBlankMapClick={false}
      onClose={onClose}
    >
      <KeyValueRows variant="divided" size="sm" rows={rows} />
    </MobileFeatureCard>
  )
}
