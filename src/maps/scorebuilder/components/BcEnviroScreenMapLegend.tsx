import type { ReactNode } from 'react'
import { MapSteppedLegend } from '@/components/ui/map-panels'
import type { BcEnviroScreenMapView } from '../lib/bcEnviroScreenMapView'

/**
 * The BC EnviroScreen class legend shared by the Index Lab map and project
 * previews: variable title, stepped bins, an optional note, and the count of
 * LHAs with no value.
 */
export function BcEnviroScreenMapLegend({ view, note }: { view: BcEnviroScreenMapView; note?: ReactNode }) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold text-foreground">{view.label}</h4>
      <MapSteppedLegend
        bands={view.bands}
        labels={view.legendLabels}
        angledLabels={view.binCount > 5}
        data-bc-enviro-screen-legend="true"
      />
      {note && <div className="text-xs leading-snug text-muted-foreground">{note}</div>}
      {view.missingCount > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="h-3 w-3 rounded-sm border border-black/10 bg-slate-400" />
          Missing in {view.missingCount} LHA
          {view.missingCount === 1 ? '' : 's'}
        </div>
      )}
    </div>
  )
}
