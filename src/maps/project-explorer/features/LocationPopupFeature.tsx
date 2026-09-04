import type { ExplorerFeature } from './featureTypes'

export function LocationPopupFeature({
  feature,
  name,
  count,
  resourceTypes,
  resourceTypeColors,
  resourceTypeLabels,
  recordPlural,
}: {
  feature: ExplorerFeature<'location-popup'>
  name: string
  count: number
  resourceTypes: Record<string, number>
  resourceTypeColors: Record<string, string>
  resourceTypeLabels: Record<string, string>
  recordPlural: string
}) {
  const sorted = Object.entries(resourceTypes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, feature.maxCategories)
  const maxTypeCount = sorted[0]?.[1] ?? 1
  const showComparisonBars = sorted.some(([, typeCount]) => typeCount !== maxTypeCount)

  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold">{name}</h3>
        <p className="text-xs text-muted-foreground">
          {count.toLocaleString()} {recordPlural} (filtered)
        </p>
      </div>
      <div className="space-y-1">
        {sorted.map(([type, typeCount]) => (
          <div key={type} className="flex items-center gap-2 text-xs">
            <span
              className={showComparisonBars ? 'size-2 shrink-0 rounded-full' : 'size-2.5 shrink-0 rounded-sm'}
              style={{ backgroundColor: resourceTypeColors[type] ?? resourceTypeColors.other }}
            />
            {showComparisonBars ? (
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${(typeCount / maxTypeCount) * 100}%`,
                    backgroundColor: resourceTypeColors[type] ?? resourceTypeColors.other,
                  }}
                />
              </span>
            ) : null}
            <span
              className={
                showComparisonBars
                  ? 'w-16 truncate text-right text-muted-foreground'
                  : 'min-w-0 flex-1 text-muted-foreground'
              }
            >
              {resourceTypeLabels[type] ?? type}
            </span>
            <span className="w-6 text-right font-medium">{typeCount}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
