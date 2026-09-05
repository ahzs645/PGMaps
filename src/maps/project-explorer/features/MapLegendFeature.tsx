import { useIsMobile } from '@/hooks/useIsMobile'
import { Layers } from 'lucide-react'

import { LegendItem, MapLegendPanel } from '@/components/ui/map-panels'
import type { ProjectMapExplorerWorkspaceDef } from '@/lib/projectPackages'

import type { ExplorerFeature } from './featureTypes'

export function MapLegendFeature({
  config,
  feature,
  counts,
  elevated = false,
}: {
  config: ProjectMapExplorerWorkspaceDef
  feature: ExplorerFeature<'map-legend'>
  counts: Array<[string, number]>
  elevated?: boolean
}) {
  const isMobile = useIsMobile()
  const countMap = new globalThis.Map(counts)
  return (
    <MapLegendPanel
      title={feature.title}
      description={feature.description}
      icon={<Layers className="size-3.5" />}
      collapsible
      defaultCollapsed={isMobile}
      elevated={elevated}
      width="sm"
      contentClassName="space-y-1"
    >
      {config.data.categories.map((type) => (
        <LegendItem
          key={type.id}
          color={type.color}
          label={type.label}
          value={(countMap.get(type.id) ?? 0).toLocaleString()}
        />
      ))}
    </MapLegendPanel>
  )
}
