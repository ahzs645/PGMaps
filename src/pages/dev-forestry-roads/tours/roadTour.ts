import type { TutorialSemanticAction, TutorialStep, TutorialViewContext } from 'tourkit/core'
import { roadDetailViews } from '../detailViews'
import type { RoadPaneId } from '../RoadPaneLayout'

/**
 * The road designer's side of a live lesson (guide `docs/forestry-road-design/live-lessons.md`):
 * the actions a lesson may name, the anchors it may point at, the snapshot its checks read and the
 * executor Watch runs. A lesson names nothing else; `roadLessons.test.ts` holds every lesson to it.
 * Keep this file free of DOM access.
 */

/** Separates the designer's saved lesson progress and completions from any other page's. */
export const ROAD_TOUR_NAMESPACE = 'pgmaps-road-design'

/** Every action a road lesson may name, with the arguments it takes. */
export const ROAD_TOUR_ACTIONS = {
  /** A workspace command by its registry ID (`workspaceCommands.ts`): `{ command }`. */
  command: 'road.command',
  /** Select a station by chainage in metres: `{ chainage }`. */
  station: 'road.station.select',
  /** Make a road the active one, by its ID: `{ id }`. */
  selectRoad: 'road.alignment.select',
  /** Set a PVI's level on the active road, 1-based: `{ pvi, elevation }`. Absolute, so a replay lands the same. */
  pviLevel: 'road.vertical.setLevel',
  /** Set one of the active road's template fields (`TEMPLATE_FIELDS`): `{ field, value }`. */
  templateField: 'road.template.set',
  /**
   * Open a workflow editor and one of its folded sections: `{ editor, section, scroll? }`. It
   * scrolls the section into view unless `scroll` is false, for a step whose control is elsewhere.
   */
  revealSection: 'road.workflow.reveal',
  /** Turn a sketch stroke into a road, as the plan's drag does: `{ stroke: [[lon, lat], …], metresPerPixel }`. */
  sketch: 'road.sketch.stroke',
  /** Set the vertical datum new terrain is imported with: `{ value }`. */
  importDatum: 'road.terrain.datum',
  /** Import a sample file served under `public/`, as its file chooser would: `{ kind, path }`. */
  importFile: 'road.file.import',
  /** Switch the workspace interface, as the interface chooser does: `{ id }`. */
  selectInterface: 'road.interface.select',
  /** Choose a screen preset (`linked`, `split`, …), as the preset picker does: `{ preset }`. */
  selectLayoutPreset: 'road.layout.select',
  /** Show an output in Save & export: `{ kind }`. */
  filesOutput: 'road.files.output',
  /** Save & export's Save or Download, without the download: `{ kind }`. */
  saveFile: 'road.files.save',
  /** Close Save & export or the interface chooser. */
  closeDialog: 'road.dialog.close',
  /** Open the project file this lesson saved, as Open would (once). */
  reopenSavedCopy: 'road.project.reopen',
  /** Record the active road's detected stream crossings, as Record detected crossings does. */
  recordCrossings: 'road.crossings.record',
} as const
export const ROAD_TOUR_ACTION_IDS: readonly string[] = Object.values(ROAD_TOUR_ACTIONS)

/**
 * The anchors (`data-tutorial-id`) the designer draws. Every registry command's button also carries
 * `road.command.<id>`; a command drawn on two visible surfaces at once is ambiguous to Tourkit, so a
 * lesson points at a pane or the station box where it can.
 */
export const ROAD_TOUR_ANCHORS = {
  plan: 'road.plan',
  profile: 'road.profile',
  sectionReadout: 'road.section.readout',
  /** The detail pane's view picker (Section, 3D, Grade, …). */
  detailView: 'road.detail.view',
  station: 'road.station',
  /** The Design editor's Road name field (not the Ribbon's quick-field copy). */
  roadName: 'road.design.roadName',
  /** The plan's sketch panel's Done sketching. */
  sketchDone: 'road.sketch.done',
  /** Terrain: the folded Import options section, its datum field, and the terrain source box. */
  importOptions: 'road.terrain.importOptions',
  importDatum: 'road.terrain.datum',
  terrainSource: 'road.terrain.source',
  /** Design: the folded Vertical alignment section. */
  verticalAlignment: 'road.design.verticalAlignment',
  /** Section: the Left half-width field (not the Ribbon's quick-field copy). */
  leftWidth: 'road.template.leftWidth',
  /** The road switcher's Compare all, and the comparison's baseline and table. */
  compareOpen: 'road.compare.open',
  compareBaseline: 'road.compare.baseline',
  compareTable: 'road.compare.table',
  /** The header's road switcher, and its planning-basis badge (SYNTHETIC TRAINING). */
  road: 'road.road',
  planningBasis: 'road.header.basis',
  /** Engineering: Show quantities & cost breakdown, and the cost table it opens in the detail pane. */
  showQuantities: 'road.engineering.quantities',
  costTable: 'road.quantities.cost',
  /** Engineering: the Stream crossing estimates toggle, Record detected crossings, the structure option. */
  crossings: 'road.crossings.toggle',
  recordCrossings: 'road.crossings.record',
  crossingStructure: 'road.crossings.structure',
  /** Review: the Ready to review verdict and the Design standards toggle. */
  reviewVerdict: 'road.review.verdict',
  designStandards: 'road.review.standards',
  /** Save & export: the dialog, and its Save / Download button. */
  files: 'road.files',
  filesSave: 'road.files.save',
} as const
export const roadCommandAnchor = (command: string) => `road.command.${command}`
/** A sidebar workflow tab (`terrain`, `design`, `template`, `engineering`, `review`). */
export const roadWorkflowAnchor = (editor: string) => `road.workflow.${editor}`
/** A PVI's level field on the active road, 1-based. */
export const roadPviLevelAnchor = (pvi: number) => `road.vertical.level.${pvi}`
/** A Review check's action button (Set standards, …), by readiness row ID (`readiness.ts`). */
export const roadReviewActionAnchor = (check: string) => `road.review.action.${check}`
/** An output's row in Save & export, by export kind (`exportCatalog.ts`). */
export const roadFilesOutputAnchor = (kind: string) => `road.files.output.${kind}`
/** An interface's card in the interface chooser, by layout ID. */
export const roadInterfaceAnchor = (id: string) => `road.interface.option.${id}`
/** A road's row in the comparison table, by road ID. */
export const roadCompareRowAnchor = (id: string) => `road.compare.row.${id}`

/** The registry command that opens each workflow editor (`workspaceCommands.ts`, `kind: 'editor'`). */
export const ROAD_EDITOR_COMMANDS: Readonly<Record<string, string>> = {
  terrain: 'terrain',
  design: 'alignment',
  template: 'section',
  engineering: 'engineering',
  review: 'review',
}

export interface RoadTourSnapshotInput {
  /** The project is the synthetic training example (`?example=training`). */
  training: boolean
  interfaceId: string
  roadName: string
  roadLength: number
  /** The selected station's chainage. */
  station: number
  /** The panes on screen, in the layout's order. */
  visiblePanes: readonly RoadPaneId[]
  /** What the detail pane shows (`section`, `terrain`, `grade`, …). */
  detail: string
  /** The workflow editor selected (`terrain`, `design`, …), and whether it is on screen. */
  workflow: { editor: string; shown: boolean }
  /** The plan's drawing tool (`inspect`, `sketch`, `road`, …). */
  toolMode: string
  roadId: string
  roadCount: number
  /** The share of the active road's stations with terrain ground, 0–100. */
  groundShare: number
  /** The active road's PVI levels, in station order. */
  pviLevels: readonly number[]
  template: { leftWidth: number; rightWidth: number }
  /** The section at the selected station, as its readout prints it; null where none is calculated. */
  section: { formationZ: number | null; groundZ: number | null; widthLeft: number; widthRight: number } | null
  terrain: { name: string; kind: string; cellM: number | null; epsg: number | null; verticalReference: string }
  /** The vertical datum the Terrain tab's import options hold for the next import. */
  importDatum: string
  busy: boolean
  /** The screen preset (`linked`, `split`, …, or `saved:<id>`). */
  layoutPreset: string
  /** The dialog a lesson step works in: the interface chooser, Save & export, or none. */
  dialog: 'interface' | 'files' | null
  /** The output Save & export shows. */
  filesOutput: string
  /** A project file holds what is open (saved or opened this session). */
  fileSaved: boolean
  /** The kind of the last file saved or downloaded from Save & export. */
  lastExport: string | null
  /** A project was opened from a file this session. */
  openedFromFile: boolean
  /** The labels of the collapsible sections open, in any editor. */
  openSections: readonly string[]
  /** The active road's crossing records. */
  crossingRecords: number
}

const round = (value: number | null | undefined, digits: number) =>
  value === null || value === undefined || !Number.isFinite(value) ? null : Number(value.toFixed(digits))

/**
 * What a lesson's checks read. Paths are part of the lesson contract: rename one only with every
 * lesson that reads it. Numbers are rounded to what a person can select, so a check never depends
 * on a floating-point remainder.
 */
export function roadTourSnapshot(input: RoadTourSnapshotInput) {
  return {
    project: { training: input.training },
    interface: { id: input.interfaceId },
    road: { name: input.roadName, lengthM: Math.round(input.roadLength * 10) / 10 },
    station: { metre: Math.round(input.station), chainage: Math.round(input.station * 10) / 10 },
    panes: {
      plan: input.visiblePanes.includes('plan'),
      profile: input.visiblePanes.includes('profile'),
      detail: input.visiblePanes.includes('detail'),
    },
    detail: { view: input.detail },
    workflow: { editor: input.workflow.editor, shown: input.workflow.shown },
    tool: { mode: input.toolMode },
    roads: { count: input.roadCount, activeId: input.roadId, groundShare: Math.round(input.groundShare) },
    vertical: { levels: input.pviLevels.map((level) => round(level, 2)) },
    template: { leftWidth: round(input.template.leftWidth, 2), rightWidth: round(input.template.rightWidth, 2) },
    section: input.section && {
      formationZ: round(input.section.formationZ, 2),
      groundZ: round(input.section.groundZ, 2),
      widthLeft: round(input.section.widthLeft, 1),
      widthRight: round(input.section.widthRight, 1),
    },
    terrain: {
      name: input.terrain.name,
      kind: input.terrain.kind,
      cellM: round(input.terrain.cellM, 1),
      epsg: input.terrain.epsg,
      verticalReference: input.terrain.verticalReference,
      importDatum: input.importDatum.trim(),
    },
    busy: input.busy,
    layout: { preset: input.layoutPreset },
    dialog: { open: input.dialog },
    files: {
      output: input.dialog === 'files' ? input.filesOutput : null,
      saved: input.fileSaved,
      lastExport: input.lastExport,
      openedFromFile: input.openedFromFile,
    },
    sections: { open: [...input.openSections].sort().map((name) => ({ name })) },
    crossings: { records: input.crossingRecords },
    /**
     * Tourkit's view vocabulary, which a step's `context` names: `host.view` is the detail pane's
     * view while that pane is on screen, else null. Practice offers to restore it; Watch restores it
     * itself, through `roadTourContextActions`.
     */
    host: {
      view: input.visiblePanes.includes('detail') ? input.detail : null,
      /** The workflow editor while it is on screen, else null. */
      tab: input.workflow.shown ? input.workflow.editor : null,
    },
  }
}
export type RoadTourSnapshot = ReturnType<typeof roadTourSnapshot>

const command = (id: string): TutorialSemanticAction => ({
  id: ROAD_TOUR_ACTIONS.command,
  args: { command: id },
  match: 'subset',
})
const reveal = (editor: string, section: string): TutorialSemanticAction => ({
  id: ROAD_TOUR_ACTIONS.revealSection,
  args: { editor, section },
  match: 'subset',
})

/** What puts each anchor back on screen, for the player's "Take me back". */
const ANCHOR_RETURNS: Record<string, TutorialSemanticAction> = {
  [ROAD_TOUR_ANCHORS.plan]: command('plan'),
  [ROAD_TOUR_ANCHORS.profile]: command('profile'),
  [ROAD_TOUR_ANCHORS.sectionReadout]: command('crossSection'),
  [ROAD_TOUR_ANCHORS.detailView]: command('crossSection'),
  [ROAD_TOUR_ANCHORS.roadName]: command('alignment'),
  [ROAD_TOUR_ANCHORS.sketchDone]: command('sketch'),
  [ROAD_TOUR_ANCHORS.importOptions]: command('terrain'),
  [ROAD_TOUR_ANCHORS.importDatum]: reveal('terrain', 'Import options'),
  [ROAD_TOUR_ANCHORS.terrainSource]: command('terrain'),
  [ROAD_TOUR_ANCHORS.verticalAlignment]: command('alignment'),
  [ROAD_TOUR_ANCHORS.leftWidth]: command('section'),
  [ROAD_TOUR_ANCHORS.compareOpen]: command('alignment'),
  [ROAD_TOUR_ANCHORS.compareBaseline]: command('compare'),
  [ROAD_TOUR_ANCHORS.compareTable]: command('compare'),
}
export function roadTourReturnAction(anchorId: string | undefined): TutorialSemanticAction | null {
  if (!anchorId) return null
  if (ANCHOR_RETURNS[anchorId]) return ANCHOR_RETURNS[anchorId]
  const tab = /^road\.workflow\.([a-z]+)$/.exec(anchorId)?.[1]
  if (tab && ROAD_EDITOR_COMMANDS[tab]) return command(ROAD_EDITOR_COMMANDS[tab])
  if (/^road\.vertical\.level\.\d+$/.test(anchorId)) return reveal('design', 'Vertical alignment')
  if (anchorId.startsWith('road.compare.row.')) return command('compare')
  return null
}

/**
 * The commands that put a step's `context` back: a detail view (`host.view`) by its registry
 * command, a workflow editor (`host.tab`) by the command that opens it.
 */
export function roadTourContextActions(context: TutorialViewContext): TutorialSemanticAction[] {
  return context.all.flatMap(({ path, equals }) => {
    if (path === 'host.tab' && typeof equals === 'string' && ROAD_EDITOR_COMMANDS[equals])
      return [command(ROAD_EDITOR_COMMANDS[equals])]
    if (path !== 'host.view') return []
    const view = roadDetailViews.find((item) => item.value === equals)
    return view ? [command(view.command)] : []
  })
}

/**
 * A step whose outcome is a dialog's (Save & export open, an output chosen in it, an interface
 * chosen in the chooser) expects that dialog: the player works with it open instead of pausing.
 */
export function roadTourStepExpectsDialog(step: Pick<TutorialStep, 'check'>): boolean {
  return (step.check?.all ?? []).some(
    (clause) => clause.path.startsWith('dialog.') || clause.path === 'files.output' || clause.path === 'interface.id',
  )
}

/** The page operations Watch runs; each is what the matching control calls. */
export interface RoadTourPage {
  isCommand: (id: string) => boolean
  runCommand: (id: string) => void
  selectStation: (chainage: number) => void
  selectRoad: (id: string) => void
  setPviLevel: (pvi: number, elevation: number) => void
  setTemplateField: (field: string, value: number) => void
  revealSection: (editor: string, section: string, scroll: boolean) => void
  sketch: (stroke: [number, number][], metresPerPixel: number) => void
  setImportDatum: (value: string) => void
  importFile: (kind: 'terrain' | 'alignment' | 'project', path: string) => Promise<void>
  selectInterface: (id: string) => void
  selectLayoutPreset: (preset: string) => void
  setFilesOutput: (kind: string) => void
  saveFile: (kind: string) => Promise<void>
  closeDialog: () => void
  reopenSavedCopy: () => Promise<void>
  recordCrossings: () => void
}

/** The outputs a lesson's Watch may prepare (no download): text files the next step can read back. */
export const SAVABLE_OUTPUTS: readonly string[] = ['project', 'csv']

const finite = (value: unknown, what: string) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${what} must be a number.`)
  return value
}
const text = (value: unknown, what: string) => {
  if (typeof value !== 'string' || !value) throw new Error(`${what} must be text.`)
  return value
}

/**
 * Watch's executor. It calls the page's own operations and reports nothing to the action stream:
 * the stream carries only what the learner did.
 */
export function createRoadTourExecutor(page: RoadTourPage) {
  return (action: TutorialSemanticAction): void | Promise<void> => {
    const args = action.args ?? {}
    switch (action.id) {
      case ROAD_TOUR_ACTIONS.command: {
        const id = args.command
        if (typeof id !== 'string' || !page.isCommand(id))
          throw new Error(`The road designer has no command "${String(id)}".`)
        return page.runCommand(id)
      }
      case ROAD_TOUR_ACTIONS.station:
        return page.selectStation(finite(args.chainage, "A station action's chainage"))
      case ROAD_TOUR_ACTIONS.selectRoad:
        return page.selectRoad(text(args.id, 'A road ID'))
      case ROAD_TOUR_ACTIONS.pviLevel:
        return page.setPviLevel(finite(args.pvi, 'A PVI number'), finite(args.elevation, 'A PVI level'))
      case ROAD_TOUR_ACTIONS.templateField:
        return page.setTemplateField(text(args.field, 'A template field'), finite(args.value, 'A template value'))
      case ROAD_TOUR_ACTIONS.revealSection:
        return page.revealSection(
          text(args.editor, 'An editor'),
          text(args.section, 'A section'),
          args.scroll !== false,
        )
      case ROAD_TOUR_ACTIONS.sketch: {
        const stroke = args.stroke
        if (
          !Array.isArray(stroke) ||
          stroke.length < 2 ||
          !stroke.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number'))
        )
          throw new Error('A sketch needs a stroke of two or more [longitude, latitude] points.')
        return page.sketch(stroke as [number, number][], finite(args.metresPerPixel, 'A sketch scale'))
      }
      case ROAD_TOUR_ACTIONS.importDatum:
        return page.setImportDatum(typeof args.value === 'string' ? args.value : '')
      case ROAD_TOUR_ACTIONS.importFile: {
        const kind = args.kind
        if (kind !== 'terrain' && kind !== 'alignment' && kind !== 'project')
          throw new Error(`The road designer cannot import a "${String(kind)}" file.`)
        const path = text(args.path, 'A sample file path')
        if (!/^help\/[a-z0-9-]+\/[a-z0-9._-]+$/i.test(path))
          throw new Error(`A lesson imports only its own sample files under help/, not "${path}".`)
        return page.importFile(kind, path)
      }
      case ROAD_TOUR_ACTIONS.selectInterface:
        return page.selectInterface(text(args.id, 'An interface ID'))
      case ROAD_TOUR_ACTIONS.selectLayoutPreset:
        return page.selectLayoutPreset(text(args.preset, 'A screen preset'))
      case ROAD_TOUR_ACTIONS.filesOutput:
        return page.setFilesOutput(text(args.kind, 'An output'))
      case ROAD_TOUR_ACTIONS.saveFile: {
        const kind = text(args.kind, 'An output')
        if (!SAVABLE_OUTPUTS.includes(kind)) throw new Error(`A lesson does not save "${kind}" files.`)
        return page.saveFile(kind)
      }
      case ROAD_TOUR_ACTIONS.closeDialog:
        return page.closeDialog()
      case ROAD_TOUR_ACTIONS.reopenSavedCopy:
        return page.reopenSavedCopy()
      case ROAD_TOUR_ACTIONS.recordCrossings:
        return page.recordCrossings()
    }
    throw new Error(`The road designer has no lesson action "${action.id}".`)
  }
}

/**
 * The player re-reads its checks whenever the snapshot object changes, and the page re-renders
 * several times a second during playback and hover. This keeps the same object while what a check
 * reads is unchanged.
 */
export function createRoadTourSnapshotMemo() {
  let last: { key: string; snapshot: RoadTourSnapshot } | null = null
  return (input: RoadTourSnapshotInput) => {
    const snapshot = roadTourSnapshot(input)
    const key = JSON.stringify(snapshot)
    if (last?.key !== key) last = { key, snapshot }
    return last.snapshot
  }
}
