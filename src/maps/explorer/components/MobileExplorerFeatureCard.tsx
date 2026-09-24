import { MobileFeatureCard } from '@/components/ui/mobile-feature-card'
import type { ExplorerItem } from '../types'
import { ExplorerItemDetails } from './ExplorerItemDetails'

interface MobileExplorerFeatureCardProps {
  item: ExplorerItem
  onClose: () => void
}

export function MobileExplorerFeatureCard({ item, onClose }: MobileExplorerFeatureCardProps) {
  return (
    <MobileFeatureCard
      title={item.name}
      subtitle={item.subtitle}
      onClose={onClose}
    >
      <ExplorerItemDetails item={item} />
    </MobileFeatureCard>
  )
}
