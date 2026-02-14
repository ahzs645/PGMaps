import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { getNetworkColor } from '../constants'
import type { AirMonitor } from '../types'

interface AirQualitySidebarProps {
  monitors: AirMonitor[]
  filteredMonitors: AirMonitor[]
  visibleMonitorCount: number
  totalMonitorCount: number
  selectedMonitor: AirMonitor | null
  selectedNetworks: string[]
  searchQuery: string
  showHeatmap: boolean
  loading: boolean
  error: string | null
  onSearchQueryChange: (query: string) => void
  onToggleHeatmap: () => void
  onToggleNetwork: (network: string) => void
  onSelectAllNetworks: () => void
  onClearNetworks: () => void
  onMonitorClick: (monitor: AirMonitor) => void
  onClearSelection: () => void
}

const MAX_VISIBLE_ROWS = 250

export function AirQualitySidebar({
  monitors,
  filteredMonitors,
  visibleMonitorCount,
  totalMonitorCount,
  selectedMonitor,
  selectedNetworks,
  searchQuery,
  showHeatmap,
  loading,
  error,
  onSearchQueryChange,
  onToggleHeatmap,
  onToggleNetwork,
  onSelectAllNetworks,
  onClearNetworks,
  onMonitorClick,
  onClearSelection
}: AirQualitySidebarProps) {
  const networkCounts = useMemo(() => {
    const counts = new Map<string, number>()
    monitors.forEach((monitor) => {
      counts.set(monitor.network, (counts.get(monitor.network) || 0) + 1)
    })
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [monitors])

  const displayedRows = useMemo(() => {
    return filteredMonitors.slice(0, MAX_VISIBLE_ROWS)
  }, [filteredMonitors])

  return (
    <div className="z-10 flex h-full w-[350px] flex-col border-r border-border bg-background/95 shadow-xl backdrop-blur">
      <div className="border-b border-border bg-background/95 p-4">
        <h1 className="text-xl font-bold text-foreground">Air Quality</h1>
        <p className="text-sm text-muted-foreground">Monitoring Networks</p>
      </div>

      <div className="border-b border-border bg-background/95 p-4">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <div className="text-xs text-muted-foreground">Visible monitors</div>
            <div className="text-xl font-bold text-foreground">{visibleMonitorCount}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Total monitors</div>
            <div className="text-sm font-medium text-foreground">{totalMonitorCount}</div>
          </div>
        </div>

        <input
          type="text"
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder="Search monitors, city, network..."
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-500"
        />
      </div>

      <div className="border-b border-border bg-background/95 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-foreground">Networks</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={onToggleHeatmap}
              className={cn(
                'rounded border px-2 py-1 text-xs transition-colors',
                showHeatmap
                  ? 'border-orange-500 text-orange-600 dark:text-orange-400'
                  : 'border-input text-muted-foreground hover:text-foreground'
              )}
            >
              Heatmap
            </button>
            <button
              onClick={onSelectAllNetworks}
              className="text-xs text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300"
            >
              All
            </button>
            <button
              onClick={onClearNetworks}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              None
            </button>
          </div>
        </div>

        <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto pr-1">
          {networkCounts.map(([network, count]) => {
            const selected = selectedNetworks.includes(network)
            const networkColor = getNetworkColor(network)
            return (
              <button
                key={network}
                onClick={() => onToggleNetwork(network)}
                className={cn(
                  'flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition-colors',
                  selected
                    ? 'bg-background'
                    : 'border-input bg-background text-foreground hover:bg-accent'
                )}
                style={selected ? { borderColor: networkColor } : undefined}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: networkColor }}
                />
                <span
                  className="truncate max-w-[110px]"
                  style={selected ? { color: networkColor } : undefined}
                >
                  {network}
                </span>
                <span
                  className={cn('opacity-80', selected ? '' : 'text-muted-foreground')}
                  style={selected ? { color: networkColor } : undefined}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {selectedMonitor && (
        <div className="border-b border-sky-300/60 bg-sky-50 p-4 dark:border-sky-800/60 dark:bg-sky-950/30">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-sky-900 dark:text-sky-200">{selectedMonitor.name}</div>
              <div className="text-xs text-sky-700 dark:text-sky-300">
                {[selectedMonitor.city, selectedMonitor.province].filter(Boolean).join(', ') || 'Location available'}
              </div>
            </div>
            <button
              onClick={onClearSelection}
              className="text-sky-700 hover:text-sky-900 dark:text-sky-300 dark:hover:text-sky-100"
              aria-label="Clear selected monitor"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex items-center gap-2 text-xs text-sky-800 dark:text-sky-200">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: getNetworkColor(selectedMonitor.network) }}
            />
            <span>{selectedMonitor.network}</span>
            {selectedMonitor.status && (
              <span className="rounded bg-sky-100 px-2 py-0.5 text-[10px] font-medium uppercase dark:bg-sky-900/60">
                {selectedMonitor.status}
              </span>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Loading monitor data...
        </div>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="text-center text-sm text-red-500">
            <p className="font-medium">Error loading monitor data</p>
            <p>{error}</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="sticky top-0 flex items-center justify-between border-b border-border bg-background/95 p-2 text-xs text-muted-foreground backdrop-blur">
            <span>{visibleMonitorCount} monitors in view</span>
            {filteredMonitors.length > MAX_VISIBLE_ROWS && (
              <span>Showing first {MAX_VISIBLE_ROWS}</span>
            )}
          </div>
          <div className="divide-y divide-border">
            {displayedRows.map((monitor) => {
              const isSelected = selectedMonitor?.id === monitor.id
              return (
                <button
                  key={`${monitor.id}-${monitor.network}`}
                  onClick={() => onMonitorClick(monitor)}
                  className={cn(
                    'w-full px-4 py-3 text-left transition-colors hover:bg-accent',
                    isSelected && 'bg-sky-50 dark:bg-sky-950/30'
                  )}
                >
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <span className="line-clamp-1 text-sm font-medium text-foreground">{monitor.name}</span>
                    <span
                      className="mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: getNetworkColor(monitor.network) }}
                    />
                  </div>
                  <div className="mb-1 text-xs text-muted-foreground">{monitor.network}</div>
                  <div className="text-xs text-muted-foreground">
                    {[monitor.city, monitor.province].filter(Boolean).join(', ') || 'No city/province'}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
