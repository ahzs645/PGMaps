import { Layers } from 'lucide-react'
import { MapLegendPanel, MapSteppedLegend } from '@/components/ui/map-panels'
import { readableTextColor } from '@/lib/color'
import { DROUGHT_LEVELS } from '../constants'

const DROUGHT_LEGEND_BANDS = [
  ...DROUGHT_LEVELS.map((item) => ({
    label: item.label,
    color: item.color,
    textColor: readableTextColor(item.color, { threshold: 0.55, dark: '#000000', weights: '709' }),
    swatchLabel: item.level,
  })),
  { label: 'Not updated / no numeric level', color: '#8a8f98', swatchLabel: '' },
]

export function DroughtLegend() {
  return (
    <MapLegendPanel
      title="Drought level"
      icon={<Layers className="h-3.5 w-3.5" />}
      width="sm"
      collapsible
      defaultCollapsed="mobile"
    >
      <MapSteppedLegend bands={DROUGHT_LEGEND_BANDS} variant="rows" />
    </MapLegendPanel>
  )
}
