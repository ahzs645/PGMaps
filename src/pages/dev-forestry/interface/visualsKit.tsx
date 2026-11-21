import type { WorkspaceKit } from '@/components/interfaces/workspaceKit'
import { visualsCommands } from './visualsCommands'
import { visualsWidgetLabels } from './visualsLayouts'

/**
 * Visual quality's interface kit: its command registry and widget captions, handed to the shared
 * ribbon, header and chooser (`workspaceKit.tsx`), with its own browser storage
 * (`pgmaps-visuals-…`). It has no brand, live lessons or help page of its own, so the chooser
 * shows neither, and the ribbon's tab row starts with the way back.
 */
export const VISUALS_KIT: WorkspaceKit = {
  storage: 'visuals',
  commands: visualsCommands,
  widgetLabels: visualsWidgetLabels,
  headerGroups: {
    attachments: 'file',
    simulationSettings: 'view',
    table: 'view',
    viaStatus: 'state',
    projectInfo: 'more',
  },
  phoneHeaderTools: ['presets', 'export'],
}
