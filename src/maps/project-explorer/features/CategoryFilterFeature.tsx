import { LegendItem, SidebarSection } from '@/components/ui/map-panels'

import type { ExplorerFeature } from './featureTypes'

export function CategoryFilterFeature({
  feature,
  categories,
  selectedCategories,
  colors,
  labels,
  onToggle,
}: {
  feature: ExplorerFeature<'category-filter'>
  categories: Array<[string, number]>
  selectedCategories: Set<string>
  colors: Record<string, string>
  labels: Record<string, string>
  onToggle: (category: string) => void
}) {
  return (
    <SidebarSection title={feature.title} className="p-3">
      <div className="space-y-0.5">
        {categories.map(([category, count]) => {
          const active = selectedCategories.size === 0 || selectedCategories.has(category)
          return (
            <LegendItem
              key={category}
              color={colors[category] ?? colors.other}
              label={labels[category] ?? category}
              value={count.toLocaleString()}
              active={active}
              onClick={() => onToggle(category)}
              className="rounded px-2 py-1"
            />
          )
        })}
      </div>
    </SidebarSection>
  )
}
