import {
  CalendarRange,
  ChartLine,
  ChevronLeft,
  ChevronRight,
  Download,
  FilePlus2,
  Flame,
  FolderOpen,
  Layers,
  LayoutPanelTop,
  LayoutTemplate,
  Map as MapIcon,
  MapPinned,
  Maximize,
  PanelLeft,
  PenLine,
  Scale,
  Shapes,
  SquareDashed,
  Trees,
  Upload,
  Waves,
  type LucideIcon,
} from 'lucide-react'
import type { CommandDef } from '@/components/interfaces/workspaceKit'

/**
 * The planner's five steps, each a workflow editor: a sidebar tab in Guided mode, a ribbon tab's
 * task pane in Ribbon.
 */
export const PLANNING_EDITORS = ['area', 'blocks', 'schedules', 'compare', 'review'] as const
export type PlanningEditor = (typeof PLANNING_EDITORS)[number]

export const PLANNING_STEPS: { id: PlanningEditor; number: number; label: string; title: string }[] = [
  { id: 'area', number: 1, label: 'Area', title: 'Reporting unit and baseline' },
  { id: 'blocks', number: 2, label: 'Blocks', title: 'Draw or import the blocks' },
  { id: 'schedules', number: 3, label: 'Schedules', title: 'When each schedule cuts each block' },
  { id: 'compare', number: 4, label: 'Compare', title: 'Young-forest patches over time' },
  { id: 'review', number: 5, label: 'Review', title: 'Rules, evidence and the D.5 pathway' },
]

const editor = (label: string, icon: LucideIcon, id: PlanningEditor, description: string): CommandDef => ({
  label,
  icon,
  kind: 'editor',
  editor: id,
  description,
})

/**
 * Every command the block planner offers, defined once. Its layouts
 * (`public/block-planning-layouts.json`) arrange these IDs; every renderer reads the label, icon
 * and kind from here, and the page supplies one handler and one state per ID. `controls`, `open`,
 * `export`, `chooseInterface`, `customizeRibbon` and `fullscreen` mean what they mean in the road
 * designer and visual quality. Each command has its own icon (`layouts.test.ts`).
 */
export const planningCommands = {
  controls: {
    label: 'Planning steps',
    icon: PanelLeft,
    description: 'Show or hide the sidebar with the five planning steps.',
  },
  newPlan: {
    label: 'New plan',
    icon: FilePlus2,
    description: 'Start an empty plan. It replaces the plan on this device; save a copy first to keep it.',
  },
  openSample: {
    label: 'Prince George sample',
    icon: Trees,
    description: 'Open the synthetic teaching landscape: two past openings and one block, cut now or ten years later.',
  },
  open: {
    label: 'Open a plan',
    icon: FolderOpen,
    description: 'Open a block plan file, including one saved by an earlier version of the planner.',
  },
  export: {
    label: 'Save & export',
    icon: Download,
    description: 'Save the plan file, the assessment record or the blocks as GeoJSON.',
  },
  area: editor(
    'Area',
    MapPinned,
    'area',
    'The Objective C reporting unit, the first projection year and the baseline.',
  ),
  blocks: editor('Blocks', SquareDashed, 'blocks', 'Draw, import, rename and reshape the blocks.'),
  schedules: editor(
    'Schedules',
    CalendarRange,
    'schedules',
    'When each schedule cuts each block, or that it does not.',
  ),
  compare: editor('Compare', ChartLine, 'compare', 'Young-forest patch classes over time, schedule by schedule.'),
  review: editor('Review', Scale, 'review', 'Rule packs, evidence for each block and the D.5 pathway.'),
  drawBlock: {
    label: 'Draw block',
    icon: PenLine,
    altLabels: ['Finish block'],
    description:
      'Draw a new block on the map. Click to place corners; click the first corner or double-click to finish.',
  },
  drawShape: {
    label: 'Draw another shape',
    icon: Shapes,
    description: 'Draw a reconfigured version of the selected block. Schedules choose which shape they cut.',
  },
  drawDisturbance: {
    label: 'Draw past disturbance',
    icon: Flame,
    description: 'Add a past harvest, wildfire or other stand-replacing disturbance to the baseline.',
  },
  importBlocks: {
    label: 'Import blocks',
    icon: Upload,
    description: 'Add blocks from a GeoJSON file of WGS84 polygons.',
  },
  importBaseline: {
    label: 'Import baseline',
    icon: Layers,
    description: 'Add past disturbances from a GeoJSON file; each feature needs a year, or one is assumed and marked.',
  },
  importZones: {
    label: 'Riparian zones',
    icon: Waves,
    description: 'Load mapped riparian zones to measure each block’s overlap.',
  },
  fitAll: {
    label: 'Fit to plan',
    icon: MapIcon,
    description: 'Zoom the map to every block and past disturbance.',
  },
  previousPeriod: {
    label: 'Earlier period',
    icon: ChevronLeft,
    description: 'Show the projection five years earlier.',
  },
  nextPeriod: {
    label: 'Later period',
    icon: ChevronRight,
    description: 'Show the projection five years later.',
  },
  customizeRibbon: { label: 'Customize ribbon', icon: LayoutPanelTop, kind: 'pane' },
  chooseInterface: { label: 'Switch interface', icon: LayoutTemplate, kind: 'pane' },
  fullscreen: { label: 'Full screen', icon: Maximize },
} satisfies Record<string, CommandDef>

export type PlanningCommand = keyof typeof planningCommands
export const planningCommandIds = Object.keys(planningCommands) as PlanningCommand[]
