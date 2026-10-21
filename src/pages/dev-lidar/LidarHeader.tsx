import { Button } from '@/components/ui/button'
import { ArrowLeft, PanelLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Basemap } from './basemaps'
import type { LidarController } from './useLidarWorkspace'
import { LIDAR_BASE, LIDAR_TOOLS, type LidarToolId } from './workspaceTools'
export function LidarHeader({ controller: c }: { controller: LidarController }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-2 sm:px-3">
      <Button asChild variant="ghost" size="icon" className="size-8 shrink-0">
        {c.isLibrary ? (
          <a href="https://pgmaps.ahmadjalil.com/dev/" aria-label="Back to PGMaps Dev" title="Back to PGMaps Dev">
            <ArrowLeft className="size-4" />
          </a>
        ) : (
          <Link to={LIDAR_BASE} aria-label="LiDAR tool library" title="LiDAR tool library">
            <ArrowLeft className="size-4" />
          </Link>
        )}
      </Button>
      <div className="min-w-0 flex-1">
        <span className="hidden text-sm font-semibold sm:inline">LiDAR</span>
      </div>
      <select
        aria-label="LiDAR tool"
        className="h-8 min-w-0 max-w-[150px] rounded border bg-background px-2 text-xs"
        value={c.tool?.id ?? ''}
        onChange={(e) => c.openTool((e.target.value || undefined) as LidarToolId | undefined)}
      >
        <option value="">All tools</option>
        {LIDAR_TOOLS.map((t) => (
          <option key={t.id} value={t.id}>
            {t.title}
          </option>
        ))}
      </select>
      {!c.isLibrary && (
        <>
          <select
            aria-label="Basemap"
            value={c.basemap}
            onChange={(e) => c.setBasemap(e.target.value as Basemap)}
            className="h-8 w-[92px] rounded border bg-background px-1 text-xs"
          >
            <option value="vector">Vector</option>
            <option value="satellite">Satellite</option>
            <option value="none">None</option>
          </select>
          {c.tool?.id !== 'compare' && c.tool?.id !== 'volume' && c.tool?.id !== 'inventory' && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 shrink-0 gap-1 px-2 text-xs"
              aria-expanded={c.showPanel}
              aria-controls="lidar-sidebar"
              onClick={() => c.setPanelOpen(!c.showPanel)}
              disabled={!c.summary}
            >
              <PanelLeft className="size-3.5" />
              {c.showPanel ? 'Hide panel' : 'Panels'}
            </Button>
          )}
        </>
      )}
    </header>
  )
}
