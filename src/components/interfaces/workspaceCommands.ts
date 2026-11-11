import {
  BookOpen,
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
  Layers,
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
  ScanLine,
  Spline,
  Table2,
  LayoutTemplate,
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
 * - `investigation: true` keeps the command available while the project is an access investigation
 *   (evidence only, no design yet); every other command is hidden there.
 */
export interface CommandDef {
  label: string
  icon: LucideIcon
  kind?: 'pane' | 'editor'
  editor?: WorkflowEditor
  investigation?: boolean
}

export const workspaceCommands = {
  customizeRibbon: { label: 'Customize ribbon', icon: Settings2, kind: 'pane', investigation: true },
  newProject: { label: 'New project', icon: FilePlus2, investigation: true },
  saveProject: { label: 'Save project file', icon: Save },
  plotbook: { label: 'Plot book', icon: BookOpen },
  stakeout: { label: 'Stakeout CSV', icon: Crosshair },
  reportPdf: { label: 'Report PDF', icon: FileText },
  exportGis: { label: 'Road GeoJSON', icon: Layers },
  fieldNotes: { label: 'Field notes', icon: StickyNote, investigation: true },
  importReference: { label: 'Import GIS layer', icon: Layers3 },
  drawProfile: { label: 'Draw terrain profile', icon: ChartNoAxesCombined },
  drawBlock: { label: 'Draw cutblock', icon: Trees },
  drawStream: { label: 'Draw stream', icon: Waves },
  drawAvoid: { label: 'Mark avoidance area', icon: Shapes },
  importAlignment: { label: 'Import road line', icon: FileUp },
  duplicateRoad: { label: 'Duplicate road', icon: Copy },
  traceRoad: { label: 'Trace existing road', icon: Route },
  inspect: { label: 'Inspect map', icon: MousePointer2 },
  crossSection: { label: 'Cross-section', icon: ScanLine },
  sectionCsv: { label: 'Export section CSV', icon: FileSpreadsheet },
  templates: { label: 'Template library', icon: FileStack },
  materials: { label: 'Ground materials', icon: Shovel },
  massHaul: { label: 'Mass haul', icon: ChartNoAxesCombined },
  fullCosts: { label: 'Compare costs', icon: Calculator },
  network: { label: 'Access network', icon: Network },
  sweptPath: { label: 'Vehicle swept path', icon: Truck },
  cable: { label: 'Draw D-line', icon: Spline },
  landing: { label: 'Landing deflection', icon: LandPlot },
  fitRoad: { label: 'Fit selected road', icon: Locate },
  fitAll: { label: 'Fit all roads', icon: MapPinned, investigation: true },
  fitTerrain: { label: 'Fit terrain', icon: Focus, investigation: true },
  contours: { label: 'Contours', icon: WavesLadder, investigation: true },
  stationLabels: { label: 'Station labels', icon: Tags },
  earthworks: { label: 'Earthworks', icon: Layers },
  lidar: { label: 'BC LiDAR', icon: Layers },
  regional: { label: 'Regional DEM', icon: Mountain },
  peg: { label: 'Peg road', icon: Plus },
  extend: { label: 'Extend road', icon: Waypoints },
  editPoints: { label: 'Edit points', icon: MapPin },
  culverts: { label: 'Culverts', icon: Waves },
  startDesign: { label: 'Start design', icon: PencilLine, investigation: true },
  loadMapped: { label: 'Load roads in view', icon: PlanMap, investigation: true },
  undo: { label: 'Undo', icon: Undo2, investigation: true },
  redo: { label: 'Redo', icon: Redo2, investigation: true },
  engineering: { label: 'Engineering inputs', icon: HardHat, kind: 'editor', editor: 'engineering' },
  quantities: { label: 'Quantities', icon: Calculator },
  stations: { label: 'Station table', icon: ListOrdered },
  drainage: { label: 'Drainage', icon: Waves },
  plan: { label: 'Plan view', icon: PlanMap, investigation: true },
  terrain3d: { label: '3D terrain', icon: Box },
  controls: { label: 'Road controls', icon: PanelLeft, investigation: true },
  fullscreen: { label: 'Full screen', icon: Maximize, investigation: true },
  summarySettings: { label: 'Road summary settings', icon: Settings2, kind: 'pane' },
  summary: { label: 'Road summary', icon: BarChart3 },
  projects: { label: 'Project library', icon: LibraryBig, investigation: true },
  open: { label: 'Open project file', icon: FolderOpen, investigation: true },
  export: { label: 'Save and export', icon: Download, investigation: true },
  terrain: { label: 'Terrain settings', icon: Mountain, kind: 'editor', editor: 'terrain' },
  import: { label: 'Import terrain', icon: FileInput },
  sketch: { label: 'Sketch a road', icon: PencilLine },
  alignment: { label: 'Alignment tools', icon: Route, kind: 'editor', editor: 'design' },
  section: { label: 'Road template', icon: ScanLine, kind: 'editor', editor: 'template' },
  review: { label: 'Design checks', icon: ClipboardCheck, kind: 'editor', editor: 'review' },
  compare: { label: 'Compare roads', icon: Table2 },
  profile: { label: 'Road profile', icon: Spline },
  chooseInterface: { label: 'Switch interface', icon: LayoutTemplate, kind: 'pane', investigation: true },
} satisfies Record<string, CommandDef>
export type WorkspaceCommand = keyof typeof workspaceCommands
/** Commands that show a workflow editor; the workspace derives their handlers from `editor`. */
export type EditorCommand = {
  [K in WorkspaceCommand]: (typeof workspaceCommands)[K] extends { kind: 'editor' } ? K : never
}[WorkspaceCommand]
export const workspaceCommandIds = Object.keys(workspaceCommands) as WorkspaceCommand[]

/** What the workspace reports for each command at render time. */
export type CommandState = { disabled?: boolean; pressed?: boolean; hidden?: boolean; label?: string }

export const commandDef = (id: WorkspaceCommand): CommandDef => workspaceCommands[id]
export const isWorkspaceCommand = (id: string): id is WorkspaceCommand =>
  Object.prototype.hasOwnProperty.call(workspaceCommands, id)

/** The label, icon and availability a renderer shows for one command, from the definition and its state. */
export function resolveCommand(id: WorkspaceCommand, state: CommandState | undefined, disabled = false) {
  const def = commandDef(id)
  return {
    id,
    label: state?.label ?? def.label,
    icon: def.icon,
    kind: def.kind,
    disabled: state?.disabled ?? disabled,
    pressed: state?.pressed,
    hidden: !!state?.hidden,
  }
}

/** Commands that must stay out of an access investigation, which has evidence but no design yet. */
export const designOnlyCommands = workspaceCommandIds.filter((id) => !commandDef(id).investigation)
