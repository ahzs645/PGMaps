import { MobileFeatureCard } from '@/components/ui/mobile-feature-card'
import { cn } from '@/lib/utils'
import { formatScore } from '../lib/metrics'
import { formatDriverDelta, type ScoreDriver } from '../lib/scoreDrivers'
import type { ScoredBoundaryRegion, ScoreDataSource } from '../types'

interface ScoreBuilderMobileRegionCardProps {
  region: ScoredBoundaryRegion
  drivers: ScoreDriver[]
  /** Only counts for sources in the recipe are shown; the rest are noise for this index. */
  enabledDataSources: ScoreDataSource[]
  pinned: boolean
  onOpenInsight: () => void
  onToggleComparison: () => void
  onClose: () => void
}

/** Mobile overlay card summarizing the currently selected scored region, drivers first. */
export function ScoreBuilderMobileRegionCard({
  region,
  drivers,
  enabledDataSources,
  pinned,
  onOpenInsight,
  onToggleComparison,
  onClose,
}: ScoreBuilderMobileRegionCardProps) {
  const sources = new Set(enabledDataSources)
  const facts: Array<[string, string]> = [
    ['Area', `${region.region.areaKm2.toFixed(1)} km²`],
    ['Coverage', `${(region.dataCoverageScore * 100).toFixed(0)}%`],
  ]
  if (sources.has('airQuality')) facts.push(['Sensors', region.counts.monitorCount.toLocaleString()])
  if (sources.has('parks')) facts.push(['Parks', region.counts.parkCount.toLocaleString()])
  if (sources.has('restaurants')) facts.push(['Restaurants', region.counts.restaurantCount.toLocaleString()])
  if (sources.has('census')) facts.push(['Population', region.counts.populationSum.toLocaleString()])

  return (
    <MobileFeatureCard
      title={region.region.name}
      subtitle={`Rank #${region.rank} | Score ${formatScore(region.score)}`}
      onClose={onClose}
    >
      {drivers.length > 0 && (
        <div className="rounded-md border border-cyan-200/70 bg-cyan-50 p-2.5 text-xs text-cyan-900 dark:border-cyan-900/70 dark:bg-cyan-950/30 dark:text-cyan-100">
          <div className="mb-1 font-semibold">Why it ranks here</div>
          <ul className="space-y-0.5">
            {drivers.map((driver) => (
              <li key={driver.key} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">{driver.intentLabel}</span>
                <span className="shrink-0 font-semibold tabular-nums">{formatDriverDelta(driver.scoreDelta)} pts</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-2 text-xs text-muted-foreground">
        {region.rankConfidence} · rank #{region.rankInterval[0]}-#{region.rankInterval[1]} · score{' '}
        {formatScore(region.scoreInterval[0])}-{formatScore(region.scoreInterval[1])}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {facts.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2">
            <span>{label}</span>
            <span className="font-medium text-foreground">{value}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onOpenInsight}
          className="min-h-11 rounded-md border border-cyan-400/70 bg-cyan-50 px-3 py-2 text-sm font-medium text-cyan-900 transition-colors hover:bg-cyan-100 dark:border-cyan-800 dark:bg-cyan-950/20 dark:text-cyan-100"
        >
          View insight
        </button>
        <button
          type="button"
          onClick={onToggleComparison}
          className={cn(
            'min-h-11 rounded-md border px-3 py-2 text-sm transition-colors',
            pinned
              ? 'border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-200'
              : 'border-input text-foreground hover:bg-muted',
          )}
        >
          {pinned ? 'Unpin' : 'Compare'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 rounded-md border border-input px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Clear
        </button>
      </div>
    </MobileFeatureCard>
  )
}
