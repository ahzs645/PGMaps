import { LegendItem } from '@/components/ui/map-panels'
import type { AttributeSchema } from '@/lib/featureAttributes'
import { legendEntries, type LayerStyle } from '@/lib/layerStyle'
import { distinctValues, numberFormatter, type DataFeatureCollection } from './layerData'
import type { CategoryFilter, DataLayer } from './model'

/**
 * A layer's legend rows. For a categories style each row is a toggle that
 * filters that value off the map and out of the table, as Felt's legend does.
 */
export function LayerLegend({
  layer,
  style,
  attributes,
  collection,
  onToggleCategory,
}: {
  layer: DataLayer
  style: LayerStyle
  attributes: AttributeSchema[]
  /** The layer's features, so a category toggle keeps values the legend lumps into "Other". */
  collection: DataFeatureCollection
  onToggleCategory?: (column: string, value: string, allValues: string[]) => void
}) {
  const column = style.type === 'simple' ? undefined : attributes.find((attribute) => attribute.key === style.column)
  const entries = legendEntries(style, numberFormatter(column))
  if (entries.length === 0) return null
  const categoryValues = style.type === 'categories' ? distinctValues(collection, style.column) : []
  const filter: CategoryFilter | null = layer.filter

  return (
    <div className="space-y-0.5" role="group" aria-label={`${layer.label} legend`}>
      {column && <div className="pb-0.5 text-[11px] font-medium text-muted-foreground">{column.label}</div>}
      {entries.map((entry) => {
        const swatch =
          entry.size !== undefined ? (
            layer.geometry === 'line' ? (
              <span className="flex h-3 w-5 items-center">
                <span
                  className="block w-5 rounded-full"
                  style={{ height: Math.max(1, entry.size), backgroundColor: entry.color }}
                />
              </span>
            ) : (
              <span className="flex size-5 items-center justify-center">
                <span
                  className="block rounded-full border border-white"
                  style={{ width: entry.size * 1.4, height: entry.size * 1.4, backgroundColor: entry.color }}
                />
              </span>
            )
          ) : undefined
        const swatchShape = layer.geometry === 'line' ? 'line' : layer.geometry === 'point' ? 'circle' : 'square'
        const filterable = entry.value !== undefined && style.type === 'categories' && onToggleCategory
        const active = !filterable || !filter || filter.column !== style.column || filter.values.includes(entry.value!)
        return (
          <LegendItem
            key={entry.key}
            color={entry.color}
            label={entry.label}
            swatch={swatch}
            swatchShape={swatchShape}
            active={active}
            className="text-xs"
            onClick={filterable ? () => onToggleCategory!(style.column, entry.value!, categoryValues) : undefined}
          />
        )
      })}
    </div>
  )
}
