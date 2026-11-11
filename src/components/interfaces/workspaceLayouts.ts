import { ribbonFieldIds } from '@/pages/dev-forestry-roads/roadFieldDefinitions'
import { Compass, LayoutDashboard, Map, PanelsLeftBottom, PanelsTopLeft, Route, Ruler } from 'lucide-react'
import { workspaceCommandIds, type WorkspaceCommand } from './workspaceCommands'
import {
  parseLayout,
  parseWorkspaceLayouts,
  type LayoutConfig,
  type LayoutToolbar,
  type LayoutVocabulary,
} from './workspaceLayoutSchema'

export type { WorkflowEditor } from './workspaceLayoutSchema'

export const layoutIcons = {
  compass: Compass,
  dashboard: LayoutDashboard,
  map: Map,
  panels: PanelsLeftBottom,
  ribbon: PanelsTopLeft,
  route: Route,
  ruler: Ruler,
}
type LayoutIcon = keyof typeof layoutIcons

/**
 * Controls a layout can place beside commands. The road workspace renders each one once; a
 * ribbon section, the guide or the header only decides where it sits.
 */
export const workspaceWidgets = [
  'projectInfo',
  'roadSelector',
  'presets',
  'terrainSource',
  'interfaceSwitch',
  'history',
  'saveState',
  ...ribbonFieldIds,
] as const
export type WorkspaceWidget = (typeof workspaceWidgets)[number]

const vocabulary: LayoutVocabulary<LayoutIcon, WorkspaceCommand, WorkspaceWidget> = {
  icons: Object.keys(layoutIcons) as LayoutIcon[],
  commands: workspaceCommandIds,
  widgets: workspaceWidgets,
}

export type WorkspaceLayout = LayoutConfig<LayoutIcon, WorkspaceCommand, WorkspaceWidget>
export type WorkspaceToolbar = LayoutToolbar<LayoutIcon, WorkspaceCommand, WorkspaceWidget>

export const parseLayoutCatalog = (value: unknown) => parseWorkspaceLayouts(value, vocabulary)

// Keep one usable view even when the editable file is missing or contains invalid JSON.
const recoveryLayout = parseLayout(
  {
    id: 'workbench',
    name: 'Engineering workbench',
    shortName: 'Workbench',
    description: 'Open the road design tools with linked plan, profile and cross-section views.',
    preview: 'workbench.webp',
  },
  vocabulary,
)

/**
 * The served catalog is a deploy-time configuration file. The service worker fetches it
 * network-first (`public/sw.js`), so an edited file applies on the next load.
 */
export async function loadWorkspaceLayouts(signal: AbortSignal) {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}workspace-layouts.json`, { cache: 'no-cache', signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return { layouts: parseLayoutCatalog(await response.json()), fallback: false }
  } catch (error) {
    if (!signal.aborted) console.warn('Using the built-in engineering workbench.', error)
    return { layouts: [recoveryLayout], fallback: true }
  }
}
