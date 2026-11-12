import { ribbonFieldLabels } from '@/pages/dev-forestry-roads/roadFieldDefinitions'
import { workspaceCommands, type WorkspaceCommand } from './workspaceCommands'
import type { WorkspaceWidget } from './workspaceLayouts'

export type RibbonTool = WorkspaceCommand | WorkspaceWidget
export const ribbonWidgetLabels: Record<WorkspaceWidget, string> = {
  ...ribbonFieldLabels,
  projectInfo: 'Project name and status',
  roadSelector: 'Active road',
  presets: 'Screen presets and panels',
  terrainSource: 'Terrain source',
  interfaceSwitch: 'Workspace interface',
  history: 'Edit history',
  saveState: 'Save status',
}
export const isRibbonCommand = (id: RibbonTool): id is WorkspaceCommand =>
  Object.prototype.hasOwnProperty.call(workspaceCommands, id)
export const ribbonToolLabel = (id: RibbonTool) =>
  isRibbonCommand(id) ? workspaceCommands[id].label : ribbonWidgetLabels[id]
