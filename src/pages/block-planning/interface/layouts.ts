import { interfacePreferences } from '@/components/interfaces/interfacePreference'
import { loadLayoutCatalog } from '@/components/interfaces/layoutCatalog'
import { layoutIconIds, type LayoutIcon, type WorkspaceKit } from '@/components/interfaces/workspaceKit'
import {
  parseLayout,
  parseWorkspaceLayouts,
  resolveToolbar,
  type LayoutConfig,
  type LayoutVocabulary,
} from '@/components/interfaces/workspaceLayoutSchema'
import { PLANNING_WORKSPACE, type PlanningPreset } from '../workspace'
import {
  PLANNING_EDITORS,
  planningCommandIds,
  planningCommands,
  type PlanningCommand,
  type PlanningEditor,
} from './commands'

/** Controls a layout can place beside commands. The page renders each once; layouts only place them. */
export const planningWidgets = ['projectInfo', 'schedulePicker', 'periodPicker', 'presets', 'interfaceSwitch'] as const
export type PlanningWidget = (typeof planningWidgets)[number]

export const planningWidgetLabels: Record<PlanningWidget, string> = {
  projectInfo: 'Plan name',
  schedulePicker: 'Schedule on the map',
  periodPicker: 'Year on the map',
  presets: 'Screen presets and panels',
  interfaceSwitch: 'Workspace interface',
}

export const planningVocabulary: LayoutVocabulary<
  LayoutIcon,
  PlanningCommand,
  PlanningWidget,
  PlanningEditor,
  PlanningPreset
> = {
  icons: layoutIconIds,
  commands: planningCommandIds,
  widgets: planningWidgets,
  editors: PLANNING_EDITORS,
  presets: [
    PLANNING_WORKSPACE.defaultPreset,
    ...PLANNING_WORKSPACE.presets.map((p) => p.id).filter((id) => id !== PLANNING_WORKSPACE.defaultPreset),
  ],
  collections: {},
  panels: PLANNING_WORKSPACE.panes.map((pane) => pane.id),
}

export type PlanningInterface = LayoutConfig<
  LayoutIcon,
  PlanningCommand,
  PlanningWidget,
  PlanningEditor,
  PlanningPreset
>

export const parsePlanningLayouts = (value: unknown) =>
  parseWorkspaceLayouts(value, planningVocabulary).map((layout) =>
    layout.toolbar ? { ...layout, toolbar: resolveToolbar(layout.toolbar, planningVocabulary) } : layout,
  )

export const GUIDED_INTERFACE_NAME = 'Guided mode'
const recovery = parseLayout(
  {
    id: 'guided',
    name: GUIDED_INTERFACE_NAME,
    description: 'Work through the five planning steps in the sidebar beside the map and the patch classes over time.',
    icon: 'panels',
  },
  planningVocabulary,
)

export const loadPlanningLayouts = (signal: AbortSignal) =>
  loadLayoutCatalog({
    file: 'block-planning-layouts.json',
    parse: parsePlanningLayouts,
    recovery,
    recoveryName: GUIDED_INTERFACE_NAME,
    signal,
  })

/** Which interface opens, under `pgmaps-block-planning-interface`; Guided mode by default. */
export const planningInterfaces = interfacePreferences('block-planning', 'guided')

export const DEFAULT_PLANNING_HEADER_TOOLS: (PlanningCommand | PlanningWidget)[] = [
  'controls',
  'schedulePicker',
  'periodPicker',
  'presets',
  'open',
  'export',
  'interfaceSwitch',
  'fullscreen',
]

/** The planner's interface kit, with its own browser storage (`pgmaps-block-planning-…`). */
export const PLANNING_KIT: WorkspaceKit = {
  storage: 'block-planning',
  commands: planningCommands,
  widgetLabels: planningWidgetLabels,
  headerGroups: {
    schedulePicker: 'view',
    periodPicker: 'view',
    newPlan: 'file',
    openSample: 'file',
    projectInfo: 'more',
  },
  phoneHeaderTools: ['presets', 'export'],
}
