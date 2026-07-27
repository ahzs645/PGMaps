import { MobileFeatureCard } from '@/components/ui/mobile-feature-card'
import { DEV_DATA_LAYER_BY_ID, featureLabel, formatCellValue, type DataFeature, type DataLayerId } from './data'

/**
 * Attribute card for the focused feature, using the shared MobileFeatureCard so it
 * joins the same mobile card stack as the data table.
 */
export function DevDataFeatureCard({
  feature,
  layerId,
  onClose,
}: {
  feature: DataFeature
  layerId: DataLayerId
  onClose: () => void
}) {
  const definition = DEV_DATA_LAYER_BY_ID.get(layerId)
  if (!definition) return null

  const rows = definition.columns.map((column) => ({
    key: column.key,
    header: column.header,
    value: formatCellValue(feature.properties[column.key], column.type),
  }))

  return (
    <MobileFeatureCard
      stackId="dev-data-feature"
      title={featureLabel(feature, definition)}
      subtitle={definition.label}
      closeOnBlankMapClick={false}
      onClose={onClose}
    >
      <dl className="divide-y divide-border/70">
        {rows.map((row) => (
          <div key={row.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-3 py-2.5 text-sm">
            <dt className="min-w-0 truncate text-muted-foreground">{row.header}</dt>
            <dd className={row.value ? 'min-w-0 break-words font-medium' : 'min-w-0 text-muted-foreground'}>
              {row.value || '—'}
            </dd>
          </div>
        ))}
      </dl>
    </MobileFeatureCard>
  )
}
