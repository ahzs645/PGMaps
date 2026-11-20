import type { WorkspaceKit } from '@/components/interfaces/workspaceKit'
import { ribbonFieldLabels } from '@/pages/dev-forestry-roads/roadFieldDefinitions'
import { roadCommandAnchor, roadInterfaceAnchor, roadWorkflowAnchor } from '@/pages/dev-forestry-roads/tours/roadTour'
import { AccessLockup } from './AccessLockup'
import { workspaceHelpSearch } from './interfacePreference'
import { ribbonWidgetLabels } from './ribbonToolCatalog'
import { workspaceCommands } from './workspaceCommands'

/**
 * The road designer's interface kit: its command registry, field and widget captions, lesson
 * anchors, brand and help, handed to the shared ribbon, header and chooser (`workspaceKit.tsx`).
 * Storage keys stay `pgmaps-road-*`, as they were before the kit was shared.
 */
export const ROAD_KIT: WorkspaceKit = {
  storage: 'road',
  commands: workspaceCommands,
  widgetLabels: ribbonWidgetLabels,
  quickFields: new Set(Object.keys(ribbonFieldLabels)),
  brand: { full: <AccessLockup />, compact: <AccessLockup compact /> },
  anchors: { command: roadCommandAnchor, workflow: roadWorkflowAnchor, interfaceOption: roadInterfaceAnchor },
  helpHref: (layoutId) => `${import.meta.env.BASE_URL}help?${workspaceHelpSearch({ id: layoutId })}`,
  headerGroups: { startDesign: 'start', loadMapped: 'start' },
  phoneHeaderTools: ['presets', 'detachedPanels', 'controls', 'export'],
}
