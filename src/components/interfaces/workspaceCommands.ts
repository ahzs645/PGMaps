import { EXPORT_ITEMS, type RoadExport } from '@/pages/dev-forestry-roads/exportCatalog'
import {
  ZoomIn,
  ZoomOut,
  Sheet,
  FileChartColumn,
  MapPinCheck,
  MapPinHouse,
  Cable,
  FileCode2,
  DraftingCompass,
  FolderArchive,
  BookCopy,
  FileImage,
  Grid3X3,
  WavesArrowDown,
  Files,
  NotebookPen,
  SlidersHorizontal,
  ListTree,
  Container,
  Database,
  SplinePointer,
  Palette,
  BookOpen,
  Footprints,
  MountainSnow,
  PenTool,
  RulerDimensionLine,
  ChartArea,
  ChartSpline,
  Cylinder,
  Droplets,
  FileJson,
  LayoutPanelTop,
  MapPlus,
  Radar,
  Sigma,
  ChartNoAxesCombined,
  Copy,
  Crosshair,
  FilePlus2,
  FileSpreadsheet,
  FileStack,
  FileText,
  FileUp,
  Focus,
  LandPlot,
  Layers3,
  Locate,
  MapPinned,
  MousePointer2,
  Network,
  Save,
  StickyNote,
  Shapes,
  Settings2,
  Shovel,
  Tags,
  Trees,
  Truck,
  WavesLadder,
  ClipboardCheck,
  Undo2,
  Waypoints,
  Plus,
  Layers2,
  MapPin,
  Redo2,
  HardHat,
  Calculator,
  ListOrdered,
  Waves,
  Map as PlanMap,
  Box,
  PanelLeft,
  Maximize,
  BarChart3,
  Download,
  FileInput,
  FolderOpen,
  LibraryBig,
  Mountain,
  PencilLine,
  Route,
  Satellite,
  ScanLine,
  Spline,
  Table2,
  LayoutTemplate,
  Trash2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { WorkflowEditor } from './workspaceLayoutSchema'

/**
 * Every command the road workspace offers, defined once. Layouts (`public/workspace-layouts.json`)
 * arrange these IDs into a ribbon, a guide or a header; every renderer reads the label, icon and
 * kind from here, and the workspace supplies one handler and one state per ID.
 *
 * - `kind: 'pane'` opens a task pane, so a renderer closes its own open group settings first.
 * - `kind: 'editor'` shows one of the workflow editors; the workspace derives its handler from `editor`.
 * - Each command has its own icon, so two commands never look alike side by side
 *   (`workspaceCommands.test.ts`).
 * - `investigation: true` keeps the command available while the project is an access investigation
 *   (evidence only, no design yet); every other command is hidden there.
 */
interface CommandDef {
  label: string
  icon: LucideIcon
  /** What the command does when its label alone cannot say it; every surface shows it as the tooltip. */
  description?: string
  /**
   * Other captions the workspace's state gives it while you work ("Undo point" while pegging). A
   * ribbon button keeps room for the longest, so a caption change never shifts its neighbours.
   */
  altLabels?: readonly string[]
  kind?: 'pane' | 'editor'
  editor?: WorkflowEditor
  investigation?: boolean
}

/** Keep existing layout and preference IDs for the original export shortcuts. */
function exportCommandId(kind: RoadExport) {
  switch (kind) {
    case 'project':
      return 'saveProject'
    case 'geojson':
      return 'exportGis'
    case 'report-pdf':
      return 'reportPdf'
    case 'plotbook':
      return 'plotbook'
    case 'stakeout':
      return 'stakeout'
    default:
      return `export-${kind}` as const
  }
}

export const ribbonExports = EXPORT_ITEMS.map(
  (output) => ({ ...output, command: exportCommandId(output.kind) }) as const,
)

/** Index a catalog without losing the finite command IDs used by layout validation. */
export function commandRecord<T extends { command: string }, V>(entries: readonly T[], value: (entry: T) => V) {
  return Object.fromEntries(entries.map((entry) => [entry.command, value(entry)])) as Record<T['command'], V>
}

/** Layouts reference these commands by ID. The road workspace supplies their behavior. */

const additionalExportIcons: Partial<Record<RoadExport, LucideIcon>> = {
  csv: Sheet,
  report: FileChartColumn,
  'map-pdf': MapPinCheck,
  'block-sheet-pdf': MapPinHouse,
  'dline-sheet-pdf': Cable,
  landxml: FileCode2,
  dxf: DraftingCompass,
  shapefile: FolderArchive,
  'plotbook-pdf': BookCopy,
  'terrain-landxml': FileImage,
  'terrain-ascii': Grid3X3,
  'streams-csv': WavesArrowDown,
  'provincial-evidence': Files,
  notes: NotebookPen,
}

export const workspaceCommands = {
  branding: {
    label: 'Branding',
    icon: Palette,
    description: 'Import a Brandkit brand and choose where to use it.',
    investigation: true,
  },
  ...commandRecord(ribbonExports, (entry) => ({
    label: entry.label,
    icon: additionalExportIcons[entry.kind] ?? Download,
    description: entry.description,
  })),
  cableProfile: { label: 'D-line clearance', icon: SplinePointer },
  peggingData: { label: 'Pegging data', icon: Database },
  zoomIn: { label: 'Zoom in', icon: ZoomIn },
  zoomOut: { label: 'Zoom out', icon: ZoomOut },
  mapSettings: { label: 'Map display settings', icon: SlidersHorizontal },
  mapLegend: { label: 'Map legend', icon: ListTree },
  haulInputs: { label: 'Material haul & cost inputs', icon: Container },

  customizeRibbon: { label: 'Customize ribbon', icon: LayoutPanelTop, kind: 'pane', investigation: true },
  newProject: { label: 'New project', icon: FilePlus2, investigation: true },
  saveProject: { label: 'Save project file', icon: Save, investigation: true },
  plotbook: { label: 'Plot book', icon: BookOpen, description: 'Opens Save and export with the plot book chosen.' },
  stakeout: {
    label: 'Stakeout CSV',
    icon: Crosshair,
    description: 'Opens Save and export with the stakeout CSV chosen.',
  },
  reportPdf: { label: 'Report PDF', icon: FileText, description: 'Opens Save and export with the PDF report chosen.' },
  exportGis: {
    label: 'Road GeoJSON',
    icon: FileJson,
    description: 'Opens Save and export with the road GeoJSON chosen.',
  },
  fieldNotes: { label: 'Field notes', icon: StickyNote, investigation: true },
  importReference: { label: 'Import GIS layer', icon: Layers3 },
  drawProfile: { label: 'Draw terrain profile', icon: ChartArea },
  drawBlock: { label: 'Draw cutblock', icon: Trees },
  drawStream: { label: 'Draw stream', icon: Waves },
  drawAvoid: { label: 'Draw avoidance area', icon: Shapes, description: 'Draw an area route searches keep out of.' },
  importAlignment: { label: 'Import road line', icon: FileUp },
  duplicateRoad: { label: 'Duplicate road', icon: Copy, altLabels: ['Copy as design'] },
  deleteRoad: { label: 'Delete road', icon: Trash2 },
  traceRoad: { label: 'Trace existing road', icon: Footprints },
  inspect: { label: 'Inspect map', icon: MousePointer2 },
  crossSection: { label: 'Cross-section', icon: ScanLine },
  sectionCsv: { label: 'Export section CSV', icon: FileSpreadsheet },
  templates: {
    label: 'Template library',
    icon: FileStack,
    description: 'Named section templates and the stations they apply to, in Engineering settings.',
  },
  materials: { label: 'Ground materials', icon: Shovel },
  massHaul: { label: 'Mass haul', icon: ChartNoAxesCombined },
  fullCosts: {
    label: 'Compare route costs',
    icon: Calculator,
    description: 'The complete cost of each route: build, haul and the work this road leaves for others.',
  },
  network: {
    label: 'Network planning',
    icon: Network,
    description: 'Plan the roads that reach the blocks as one network.',
  },
  sweptPath: { label: 'Vehicle swept path', icon: Truck },
  cable: { label: 'Draw D-line', icon: Spline, description: 'Draw a cable yarding line and check its deflection.' },
  landing: { label: 'Landing deflection', icon: LandPlot },
  fitRoad: { label: 'Fit selected road', icon: Locate },
  fitAll: { label: 'Fit all roads', icon: MapPinned, investigation: true },
  fitTerrain: { label: 'Fit terrain', icon: Focus, investigation: true },
  contours: { label: 'Contours', icon: WavesLadder, investigation: true },
  stationLabels: { label: 'Station labels', icon: Tags },
  sentinel2: { label: 'Sentinel-2 imagery', icon: Satellite, investigation: true },
  earthworks: { label: 'Earthworks', icon: Layers2 },
  lidar: {
    label: 'BC LiDAR sample',
    icon: Radar,
    description:
      'Opens the classified-ground 1 m LiDAR DTM near Prince George as a new project, in place of the open one.',
  },
  regional: {
    label: 'Regional DEM',
    icon: MountainSnow,
    description:
      'Puts coarse regional terrain under this project, for reconnaissance only. Undo returns the terrain it had.',
  },
  peg: { label: 'Peg road', icon: Plus },
  extend: { label: 'Extend road', icon: Waypoints },
  editPoints: { label: 'Edit points', icon: MapPin },
  culverts: { label: 'Culverts', icon: Cylinder },
  startDesign: { label: 'Start design', icon: PenTool, investigation: true },
  loadMapped: {
    label: 'Load mapped roads in view',
    icon: MapPlus,
    description: "Load every mapped road in the plan's view as its own road, each in its own colour.",
    investigation: true,
  },
  undo: { label: 'Undo', icon: Undo2, altLabels: ['Undo point'], investigation: true },
  redo: { label: 'Redo', icon: Redo2, investigation: true },
  engineering: { label: 'Engineering inputs', icon: HardHat, kind: 'editor', editor: 'engineering' },
  quantities: { label: 'Quantities', icon: Sigma },
  stations: { label: 'Station table', icon: ListOrdered },
  drainage: { label: 'Drainage', icon: Droplets },
  plan: { label: 'Plan view', icon: PlanMap, investigation: true },
  terrain3d: { label: '3D terrain', icon: Box },
  controls: { label: 'Road controls', icon: PanelLeft, investigation: true },
  fullscreen: { label: 'Full screen', icon: Maximize, altLabels: ['Exit full screen'], investigation: true },
  summarySettings: { label: 'Road summary settings', icon: Settings2, kind: 'pane' },
  summary: { label: 'Road summary', icon: BarChart3 },
  projects: { label: 'Project library', icon: LibraryBig, investigation: true },
  open: { label: 'Open project file', icon: FolderOpen, investigation: true },
  export: { label: 'Save and export', icon: Download, investigation: true },
  terrain: { label: 'Terrain settings', icon: Mountain, kind: 'editor', editor: 'terrain' },
  import: { label: 'Import terrain', icon: FileInput },
  sketch: { label: 'Sketch a road', icon: PencilLine },
  alignment: { label: 'Alignment tools', icon: Route, kind: 'editor', editor: 'design' },
  section: { label: 'Road template', icon: RulerDimensionLine, kind: 'editor', editor: 'template' },
  review: { label: 'Design checks', icon: ClipboardCheck, kind: 'editor', editor: 'review' },
  compare: { label: 'Compare roads', icon: Table2 },
  profile: { label: 'Road profile', icon: ChartSpline },
  chooseInterface: { label: 'Switch interface', icon: LayoutTemplate, kind: 'pane', investigation: true },
} satisfies Record<string, CommandDef>
export type WorkspaceCommand = keyof typeof workspaceCommands
/** Commands that show a workflow editor; the workspace derives their handlers from `editor`. */
export type EditorCommand = {
  [K in WorkspaceCommand]: (typeof workspaceCommands)[K] extends { kind: 'editor' } ? K : never
}[WorkspaceCommand]
export const workspaceCommandIds = Object.keys(workspaceCommands) as WorkspaceCommand[]

/**
 * What the workspace reports for each command at render time. `reason` says why a disabled
 * command cannot run, and `shortcut` names its keys; both join the description in the tooltip.
 */
export type CommandState = {
  disabled?: boolean
  pressed?: boolean
  hidden?: boolean
  label?: string
  reason?: string
  shortcut?: string
}

export const commandDef = (id: WorkspaceCommand): CommandDef => workspaceCommands[id]
export const isWorkspaceCommand = (id: string): id is WorkspaceCommand =>
  Object.prototype.hasOwnProperty.call(workspaceCommands, id)

/** The label, icon and availability a renderer shows for one command, from the definition and its state. */
export function resolveCommand(id: WorkspaceCommand, state: CommandState | undefined, disabled = false) {
  const def = commandDef(id)
  const off = state?.disabled ?? disabled
  return {
    id,
    label: state?.label ?? def.label,
    icon: def.icon,
    kind: def.kind,
    disabled: off,
    pressed: state?.pressed,
    hidden: !!state?.hidden,
    description: def.description,
    // Every caption this command can show, so a renderer can keep room for the longest.
    captions: [def.label, ...((def as CommandDef).altLabels ?? [])],
    shortcut: state?.shortcut,
    reason: off ? state?.reason : undefined,
  }
}

/**
 * The tooltip every surface gives a command: its label (where the label is not shown, or may be
 * cut short), what it does, its keys, and why it is unavailable.
 */
export function commandTooltip(command: ReturnType<typeof resolveCommand>, withLabel = true) {
  const keys = command.shortcut ? ` (${command.shortcut})` : ''
  return [withLabel ? `${command.label}${keys}` : keys.trim(), command.description, command.reason]
    .filter(Boolean)
    .join('\n')
}

/** Commands that must stay out of an access investigation, which has evidence but no design yet. */
export const designOnlyCommands = workspaceCommandIds.filter((id) => !commandDef(id).investigation)
