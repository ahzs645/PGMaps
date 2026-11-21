import {
  Archive,
  Binoculars,
  BookOpen,
  Bookmark,
  Briefcase,
  Camera,
  Car,
  CarFront,
  ChartLine,
  Clapperboard,
  ClipboardCheck,
  ClipboardList,
  Download,
  FileChartColumn,
  FileCheck2,
  FileJson,
  FilePlus2,
  FileText,
  FileUp,
  Focus,
  FolderOpen,
  Globe,
  ImageDown,
  Images,
  LayoutPanelTop,
  LayoutTemplate,
  Map as MapIcon,
  MapPinHouse,
  MapPinPlus,
  Maximize,
  Mountain,
  NotebookPen,
  Package,
  PackageCheck,
  PanelLeft,
  Paperclip,
  Play,
  Route,
  RulerDimensionLine,
  Save,
  ScanEye,
  Sheet,
  Signpost,
  SquareDashed,
  TreePine,
  Trees,
  type LucideIcon,
} from 'lucide-react'
import type { CommandDef } from '@/components/interfaces/workspaceKit'
import { VISUALS_EXPORTS, type VisualsExport } from '../visualsExports'

/** The VIA handbook's five steps (`via.ts`): each is a workflow editor, one tab of the sidebar or ribbon. */
export const VISUALS_EDITORS = ['identify', 'visit', 'design', 'assess', 'rate'] as const
export type VisualsEditor = (typeof VISUALS_EDITORS)[number]

/** One icon per output, so two outputs never look alike in a ribbon group. */
const EXPORT_ICONS: Record<VisualsExport, LucideIcon> = {
  'block-note': NotebookPen,
  'route-card': ClipboardCheck,
  fs1252: FileCheck2,
  'analysis-sheet': FileChartColumn,
  'via-document': FileText,
  'via-report': BookOpen,
  'field-brief': MapIcon,
  'block-sheet': MapPinHouse,
  worksheet: Sheet,
  evidence: PackageCheck,
  project: Save,
  scene: FileJson,
  views: Images,
  workspace: Briefcase,
  'scene-package': Package,
  'scene-gis': Globe,
  'castor-constraint': ChartLine,
  'stand-trees': TreePine,
  'sightline-archive': Archive,
  'road-video': Clapperboard,
}

/** Each Save & export output as a command that opens the dialog on it (`export-<kind>`). */
export const visualsExportCommands = VISUALS_EXPORTS.map((output) => ({
  ...output,
  command: `export-${output.kind}` as const,
}))
export type VisualsExportCommand = (typeof visualsExportCommands)[number]['command']

const exportCommandDefs = Object.fromEntries(
  visualsExportCommands.map((output) => [
    output.command,
    {
      label: output.label,
      icon: EXPORT_ICONS[output.kind],
      description: `Opens Save & export on ${output.label}. ${output.description}`,
    },
  ]),
) as Record<VisualsExportCommand, CommandDef>

/**
 * Every command visual quality offers, defined once. Its layouts (`public/visuals-layouts.json`)
 * arrange these IDs into a ribbon or a header; every renderer reads the label, icon and kind from
 * here (through `visualsKit.tsx`), and the page supplies one handler and one state per ID.
 * Commands shared by name with the road designer (`controls`, `open`, `export`, `chooseInterface`,
 * `customizeRibbon`, `fullscreen`) mean the same thing there. Each command has its own icon
 * (`visualsCommands.test.ts`).
 */
export const visualsCommands = {
  controls: {
    label: 'Assessment steps',
    icon: PanelLeft,
    description: 'Show or hide the sidebar with the five VIA steps.',
  },
  newSite: {
    label: 'New site',
    icon: FilePlus2,
    description: 'Clear the map for a site of your own. It replaces what is on the map.',
  },
  sampleTabor: {
    label: 'Tabor Mountain sample',
    icon: Mountain,
    description: 'Open the worked Tabor Mountain sample. It replaces what is on the map.',
  },
  samplePurden: {
    label: 'Hwy 16 · Purden Lake',
    icon: Signpost,
    description: 'Open the Highway 16 sample at Purden Lake. It replaces what is on the map.',
  },
  sampleRoadside: {
    label: 'Roadside demo drive',
    icon: CarFront,
    description: 'Open the roadside demo straight into the road view. It replaces what is on the map.',
  },
  open: {
    label: 'Open a project',
    icon: FolderOpen,
    description: 'Open a PGMaps project ZIP, an earlier project JSON file, or a Saved views file from Save & export.',
  },
  export: {
    label: 'Save & export',
    icon: Download,
    description: 'Every file the page writes, with what goes into each.',
  },
  attachments: {
    label: 'Project files',
    icon: Paperclip,
    description: "The files kept with this project: field photos' originals and anything you add.",
  },
  referenceMeasurements: {
    label: 'Reference measurements',
    icon: ClipboardList,
    description: 'Review a historical VIA against its sheets: its case.json and sheets are read from Project files.',
  },
  ...exportCommandDefs,
  drawRoad: { label: 'Draw the road', icon: Route, description: 'Click along the road; double-click to end.' },
  drawBlock: { label: 'Draw block', icon: SquareDashed, description: 'Click its corners; double-click to close.' },
  importShapes: {
    label: 'Import cutblocks or landforms',
    icon: FileUp,
    description: 'Cutblocks or landforms as GeoJSON or a zipped shapefile.',
  },
  addView: {
    label: 'Add a view of interest',
    icon: MapPinPlus,
    description: 'Click the plan where the view stands.',
  },
  inventory: {
    label: 'Viewpoints and rec sites',
    icon: Binoculars,
    description: "Read BC's inventory viewpoints and recreation sites around the block, and show them on the map.",
  },
  lookFromRoad: {
    label: 'Look from the road',
    icon: Car,
    altLabels: ['Return to map'],
    description: 'Open the eye-level road view. With no road yet, the next plan click picks one.',
  },
  saveViewpoint: {
    label: 'Save viewpoint',
    icon: Bookmark,
    description: 'Save this spot, look and harvest phase; it is captioned for the planning note.',
  },
  downloadImage: { label: 'Download image', icon: ImageDown, description: 'Download this view as a captioned PNG.' },
  ownPhotos: {
    label: 'Own photos',
    icon: Camera,
    description: 'Line your own field or aircraft photos up with the terrain.',
  },
  runAssessment: {
    label: 'Run the assessment',
    icon: Play,
    altLabels: ['Cancel run'],
    description: 'Simulate what the road sees of each block and landform.',
  },
  routePreview: { label: 'Route preview', icon: ScanEye, description: 'Terrain seen from the road, on the plan.' },
  drawPatch: {
    label: 'Draw a wildlife tree patch',
    icon: Trees,
    description: 'Kept standing in the run; the road view stays open.',
  },
  measure: { label: 'Measure', icon: RulerDimensionLine, description: 'Measure a distance, an area or a circle.' },
  fitScene: {
    label: 'Zoom to the scene',
    icon: Focus,
    description: 'Frame the road, blocks and landforms on the plan.',
  },
  customizeRibbon: { label: 'Customize ribbon', icon: LayoutPanelTop, kind: 'pane' },
  chooseInterface: { label: 'Switch interface', icon: LayoutTemplate, kind: 'pane' },
  fullscreen: { label: 'Full screen', icon: Maximize, altLabels: ['Exit full screen'] },
} satisfies Record<string, CommandDef>

export type VisualsCommand = keyof typeof visualsCommands
export const visualsCommandIds = Object.keys(visualsCommands) as VisualsCommand[]
