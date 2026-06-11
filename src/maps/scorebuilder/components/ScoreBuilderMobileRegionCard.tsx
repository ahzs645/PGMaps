import { MobileFeatureCard } from '@/components/ui/mobile-feature-card'
import { cn } from '@/lib/utils'
import { formatScore } from '../lib/metrics'
import { formatDriverDelta, type ScoreDriver } from '../lib/scoreDrivers'
import type { ScoredBoundaryRegion } from '../types'

interface ScoreBuilderMobileRegionCardProps {
  region: ScoredBoundaryRegion
  drivers: ScoreDriver[]
  pinned: boolean
  onOpenInsight: () => void
  onToggleComparison: () => void
  onClose: () => void
}

/** Mobile overlay card summarizing the currently selected scored region. */
export function ScoreBuilderMobileRegionCard({
  region,
  drivers,
  pinned,
  onOpenInsight,
  onToggleComparison,
  onClose,
}: ScoreBuilderMobileRegionCardProps) {
  return (
    <MobileFeatureCard
      title={region.region.name}
      subtitle={`Rank #${region.rank} | Score ${formatScore(region.score)}`}
      onClose={onClose}
    >
      <div className="text-[11px] font-medium text-cyan-800 dark:text-cyan-200">
        {region.rankConfidence} · rank #{region.rankInterval[0]}-#{region.rankInterval[1]} · score{' '}
        {formatScore(region.scoreInterval[0])}-{formatScore(region.scoreInterval[1])}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-cyan-800 dark:text-cyan-200">
        <div>Area: {region.region.areaKm2.toFixed(1)} km²</div>
        <div>Sensors: {region.counts.monitorCount.toLocaleString()}</div>
        <div>Parks: {region.counts.parkCount.toLocaleString()}</div>
        <div>Restaurants: {region.counts.restaurantCount.toLocaleString()}</div>
        <div>Coverage: {(region.dataCoverageScore * 100).toFixed(0)}%</div>
      </div>
      {drivers.length > 0 && (
        <div className="mt-2 text-[11px] text-cyan-800 dark:text-cyan-200">
          Top drivers:{' '}
          {drivers.map((driver) => `${driver.intentLabel} ${formatDriverDelta(driver.scoreDelta)}`).join(', ')} pts
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onOpenInsight}
          className="rounded border border-cyan-400/70 bg-white/70 px-2 py-1 text-xs font-medium text-cyan-900 transition-colors hover:bg-white dark:border-cyan-800 dark:bg-cyan-950/20 dark:text-cyan-100"
        >
          View Insight
        </button>
        <button
          type="button"
          onClick={onToggleComparison}
          className={cn(
            'rounded border px-2 py-1 text-xs transition-colors',
            pinned
              ? 'border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-200'
              : 'border-cyan-300/70 text-cyan-800 hover:bg-cyan-100/70 dark:border-cyan-900 dark:text-cyan-300',
          )}
        >
          {pinned ? 'Unpin' : 'Compare'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-cyan-300/70 px-2 py-1 text-xs text-cyan-800 transition-colors hover:bg-cyan-100/70 dark:border-cyan-900 dark:text-cyan-300 dark:hover:bg-cyan-950/40"
        >
          Clear
        </button>
      </div>
    </MobileFeatureCard>
  )
}
