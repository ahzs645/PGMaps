import { ribbonFieldIds } from '@/pages/dev-forestry-roads/roadFieldDefinitions'
import type { RoadLayout } from '@/pages/dev-forestry-roads/RoadPaneLayout'
import { layoutIconIds, type LayoutIcon } from '@/components/interfaces/workspaceKit'
import {
  parseLayout,
  parseWorkspaceLayouts,
  resolveToolbar as resolveCollections,
  type LayoutConfig,
  type LayoutToolbar,
  type LayoutVocabulary,
} from '@/components/interfaces/workspaceLayoutSchema'
import { loadLayoutCatalog } from '@/components/interfaces/layoutCatalog'
import { DEFAULT_INTERFACE_NAME } from './interfacePreference'
import { ribbonExports, workspaceCommandIds, type WorkspaceCommand } from './workspaceCommands'

export { layoutIcons } from '@/components/interfaces/workspaceKit'

/** The road workspace's workflow editors, each one tab of its sidebar or ribbon. */
export const WORKFLOW_EDITORS = ['terrain', 'design', 'template', 'engineering', 'review'] as const
export type WorkflowEditor = (typeof WORKFLOW_EDITORS)[number]

/** The screen presets an interface can start on (`RoadPaneLayout.tsx`); the first is the default. */
const ROAD_PRESETS: readonly RoadLayout[] = ['linked', 'split', 'plan', 'engineering', 'pegging']

/**
 * Controls a layout can place beside commands. The road workspace renders each one once; a
 * ribbon section, the guide or the header only decides where it sits.
 */
export const workspaceWidgets = [
  'projectInfo',
  'roadSelector',
  'presets',
  'terrainSource',
  'terrainDisplay',
  'interfaceSwitch',
  'history',
  'saveState',
  'detachedPanels',
  ...ribbonFieldIds,
] as const
export type WorkspaceWidget = (typeof workspaceWidgets)[number]

export const roadLayoutVocabulary: LayoutVocabulary<
  LayoutIcon,
  WorkspaceCommand,
  WorkspaceWidget,
  WorkflowEditor,
  RoadLayout
> = {
  icons: layoutIconIds,
  commands: workspaceCommandIds,
  widgets: workspaceWidgets,
  editors: WORKFLOW_EDITORS,
  presets: ROAD_PRESETS,
  collections: {
    documentExports: ribbonExports.filter((item) => item.group === 'documents').map((item) => item.command),
    dataExports: ribbonExports.filter((item) => item.group !== 'documents').map((item) => item.command),
  },
  panels: ['plan', 'profile', 'detail', 'data'],
}

export type WorkspaceLayout = LayoutConfig<LayoutIcon, WorkspaceCommand, WorkspaceWidget, WorkflowEditor, RoadLayout>
export type WorkspaceToolbar = LayoutToolbar<LayoutIcon, WorkspaceCommand, WorkspaceWidget, WorkflowEditor>

export const parseLayoutCatalog = (value: unknown) =>
  parseWorkspaceLayouts(value, roadLayoutVocabulary).map((layout) =>
    layout.toolbar ? { ...layout, toolbar: resolveToolbar(layout.toolbar) } : layout,
  )

/** Hosted placements win. Expand catalog-backed groups before applying personal ribbon preferences. */
export const resolveToolbar = (toolbar: WorkspaceToolbar): WorkspaceToolbar =>
  resolveCollections(toolbar, roadLayoutVocabulary)

// Keep one usable view even when the editable file is missing or contains invalid JSON.
const recoveryLayout = parseLayout(
  {
    id: 'workbench',
    name: DEFAULT_INTERFACE_NAME,
    shortName: DEFAULT_INTERFACE_NAME,
    description: 'Open the road design tools with linked plan, profile and cross-section views.',
    preview: 'workbench.webp',
  },
  roadLayoutVocabulary,
)

/**
 * The served catalog is a deploy-time configuration file. The service worker fetches it
 * network-first (`public/sw.js`), so an edited file applies on the next load.
 */
export const loadWorkspaceLayouts = (signal: AbortSignal) =>
  loadLayoutCatalog({
    file: 'workspace-layouts.json',
    parse: parseLayoutCatalog,
    recovery: recoveryLayout,
    recoveryName: DEFAULT_INTERFACE_NAME,
    signal,
  })

/**
 * The header's tools when a layout names none. A layout can choose its own with `headerTools`
 * (see `docs/forestry-road-design/workspace-layouts.md`); the header places each tool in its
 * group, and the list's order is the order inside a group.
 */
export const DEFAULT_HEADER_TOOLS: (WorkspaceCommand | WorkspaceWidget)[] = [
  'controls',
  'undo',
  'redo',
  'history',
  'presets',
  'summarySettings',
  'detachedPanels',
  'startDesign',
  'loadMapped',
  'saveState',
  'projects',
  'open',
  'export',
  'interfaceSwitch',
  'branding',
  'fullscreen',
]
