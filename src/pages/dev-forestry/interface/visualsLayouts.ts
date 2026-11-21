import { layoutIconIds, type LayoutIcon } from '@/components/interfaces/workspaceKit'
import { interfacePreferences } from '@/components/interfaces/interfacePreference'
import { loadLayoutCatalog } from '@/components/interfaces/layoutCatalog'
import {
  parseLayout,
  parseWorkspaceLayouts,
  resolveToolbar,
  type LayoutConfig,
  type LayoutToolbar,
  type LayoutVocabulary,
} from '@/components/interfaces/workspaceLayoutSchema'
import { VISUALS_WORKSPACE, type VisualsLayout, type VisualsPane } from '../visualsWorkspace'
import {
  VISUALS_EDITORS,
  visualsCommandIds,
  visualsExportCommands,
  type VisualsCommand,
  type VisualsEditor,
} from './visualsCommands'

/**
 * Controls a layout can place beside commands. The page renders each one once; the header or a
 * ribbon section only decides where it sits.
 */
export const visualsWidgets = [
  'projectInfo',
  'viaStatus',
  'presets',
  'table',
  'simulationSettings',
  'interfaceSwitch',
] as const
export type VisualsWidget = (typeof visualsWidgets)[number]

export const visualsWidgetLabels: Record<VisualsWidget, string> = {
  projectInfo: 'Project name',
  viaStatus: 'VIA rating',
  presets: 'Screen presets and panels',
  table: 'Table',
  simulationSettings: 'Simulation settings',
  interfaceSwitch: 'Workspace interface',
}

const outputsOf = (group: string) =>
  visualsExportCommands.filter((output) => output.group === group).map((output) => output.command)

export const visualsLayoutVocabulary: LayoutVocabulary<
  LayoutIcon,
  VisualsCommand,
  VisualsWidget,
  VisualsEditor,
  VisualsLayout
> = {
  icons: layoutIconIds,
  commands: visualsCommandIds,
  widgets: visualsWidgets,
  editors: VISUALS_EDITORS,
  // The tiled workspace's presets (`visualsWorkspace.ts`), its default first.
  presets: [
    VISUALS_WORKSPACE.defaultPreset,
    ...VISUALS_WORKSPACE.presets.map((preset) => preset.id).filter((id) => id !== VISUALS_WORKSPACE.defaultPreset),
  ],
  collections: {
    documentOutputs: outputsOf('documents'),
    fileOutputs: outputsOf('files'),
    exchangeOutputs: outputsOf('exchange'),
  },
  panels: VISUALS_WORKSPACE.panes.map((pane) => pane.id),
}

export type VisualsInterface = LayoutConfig<LayoutIcon, VisualsCommand, VisualsWidget, VisualsEditor, VisualsLayout>
export type VisualsToolbar = LayoutToolbar<LayoutIcon, VisualsCommand, VisualsWidget, VisualsEditor>

export const parseVisualsLayouts = (value: unknown) =>
  parseWorkspaceLayouts(value, visualsLayoutVocabulary).map((layout) =>
    layout.toolbar ? { ...layout, toolbar: resolveToolbar(layout.toolbar, visualsLayoutVocabulary) } : layout,
  )

/** The interface the page has always had, kept when the served file cannot be read. */
export const GUIDED_INTERFACE_NAME = 'Guided mode'
const recoveryLayout = parseLayout(
  {
    id: 'guided',
    name: GUIDED_INTERFACE_NAME,
    description: 'Work through the VIA handbook’s five steps in the sidebar beside the plan and road view.',
    icon: 'panels',
  },
  visualsLayoutVocabulary,
)

export const loadVisualsLayouts = (signal: AbortSignal) =>
  loadLayoutCatalog({
    file: 'visuals-layouts.json',
    parse: parseVisualsLayouts,
    recovery: recoveryLayout,
    recoveryName: GUIDED_INTERFACE_NAME,
    signal,
  })

/** Which interface the page opens in, under `pgmaps-visuals-interface`; Guided mode by default. */
export const visualsInterfaces = interfacePreferences('visuals', 'guided')

/** The header's tools when a layout names none: today's strip, as the Guided mode had it. */
export const DEFAULT_VISUALS_HEADER_TOOLS: (VisualsCommand | VisualsWidget)[] = [
  'controls',
  'presets',
  'table',
  'simulationSettings',
  'open',
  'attachments',
  'export',
  'interfaceSwitch',
  'fullscreen',
]

export type { VisualsPane }
