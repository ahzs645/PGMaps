import type { WorkspaceLayout } from '@/components/interfaces/workspaceLayouts'
import {
  parseSummaryOptions,
  type SummaryLevel,
  type SummaryOptions,
} from '@/components/interfaces/workspaceLayoutSchema'
import { useMetricSummaryPreferences } from '@/components/ui/metric-summary'

export type { SummaryLevel }
export type SummaryPreferences = Required<SummaryOptions>

const storageKey = (id: string) => `pgmaps-road-summary:${id}`

/** The road summary's choices for one interface: its layout entry's defaults, then this device's. */
export function useSummaryPreferences(layout: WorkspaceLayout) {
  return useMetricSummaryPreferences<SummaryOptions>(
    storageKey(layout.id),
    {
      visible: layout.summary?.visible ?? true,
      placement: layout.summary?.placement ?? 'left',
      metrics: { ...layout.summary?.metrics },
      curveNote: layout.summary?.curveNote ?? 'full',
    },
    parseSummaryOptions,
  )
}
export type SummaryControls = ReturnType<typeof useSummaryPreferences>
