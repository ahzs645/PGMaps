/**
 * What the visual-quality Save & export dialog offers: each output's group, formats and one-line
 * description, why one is unavailable, and what goes into it — the landform, the viewpoints and
 * saved views with their settings, the blocks, the run and the review — read from the same state
 * the file is written from. No DOM or network access.
 */

import { layoutStageLabel, layoutStageOf } from './fieldChecklist'
import type { SavedDriveView } from './previewState'
import type { ForestryScene } from './scene'
import { findSceneLandform } from './sceneInput'
import type { AnalysisResult, HarvestSystem } from './types'
import type { ViaAssessment, ViaStepId } from './via'
import { lineLengthMeters, polygonAreaMeters } from './visibility'
import { EVQO_CODE_FOR_CLASS, EVQO_NAMES } from './visualsNarrative'
import type { VisualQualityClassId } from './vqo'

export type VisualsExport =
  | 'block-note'
  | 'fs1252'
  | 'analysis-sheet'
  | 'field-brief'
  | 'worksheet'
  | 'evidence'
  | 'scene'
  | 'views'
  | 'workspace'
  | 'scene-package'

export type VisualsExportGroup = 'documents' | 'files'

export const VISUALS_EXPORT_GROUP_LABELS: Record<VisualsExportGroup, string> = {
  documents: 'Assessment documents',
  files: 'Save and reopen',
}

export type ExportFormat = { id: string; label: string; extension: string }

export interface VisualsExportItem {
  kind: VisualsExport
  group: VisualsExportGroup
  label: string
  description: string
  /** The first is the default. */
  formats: readonly ExportFormat[]
}

const PDF: ExportFormat = { id: 'pdf', label: 'PDF', extension: '.pdf' }
const JSON_FILE: ExportFormat = { id: 'json', label: 'JSON', extension: '.json' }

export const VISUALS_EXPORTS: readonly VisualsExportItem[] = [
  {
    kind: 'block-note',
    group: 'documents',
    label: 'Block note',
    description:
      "The planning note's Visuals row: the block, the paragraph, the visual measures, the landform's alteration, every saved view and a plan map.",
    formats: [{ id: 'xlsx', label: 'Excel', extension: '.xlsx' }, PDF],
  },
  {
    kind: 'fs1252',
    group: 'documents',
    label: 'FS1252 form',
    description:
      'The FS1252 simulation draft, one form per chosen station, with the step 4 record. The signature and final decision stay blank.',
    formats: [PDF],
  },
  {
    kind: 'analysis-sheet',
    group: 'documents',
    label: 'Analysis sheet',
    description:
      'A saved view drawn as a perspective viewpoint analysis: outlines from its class pass, block callouts, a legend, and the pixel percent beside the sightline percent.',
    formats: [PDF, { id: 'png', label: 'PNG', extension: '.png' }],
  },
  {
    kind: 'field-brief',
    group: 'documents',
    label: 'Field brief',
    description:
      'One page for the layout crew: the block, landform and objective, where to stand and which way to face, up to three screenshots and the checklist.',
    formats: [PDF],
  },
  {
    kind: 'worksheet',
    group: 'documents',
    label: 'Worksheet',
    description: 'The worked figures of the current run, station by station, as Markdown.',
    formats: [{ id: 'md', label: 'Markdown', extension: '.md' }],
  },
  {
    kind: 'evidence',
    group: 'documents',
    label: 'VIA evidence package',
    description:
      'The recorded assessments, viewpoints and field records with the evidence checklist, separate from the FS1252.',
    formats: [PDF, { id: 'html', label: 'Printable HTML', extension: '.html' }],
  },
  {
    kind: 'scene',
    group: 'files',
    label: 'Scene',
    description:
      'The road, landforms, blocks, openings, masks, settings and review, to reopen here. Terrain and inventory are read again.',
    formats: [JSON_FILE],
  },
  {
    kind: 'views',
    group: 'files',
    label: 'Saved views',
    description:
      'The scene with every saved view, to reopen with Open saved preview. Screenshots are not kept in the file.',
    formats: [JSON_FILE],
  },
  {
    kind: 'workspace',
    group: 'files',
    label: 'Assessment workspace',
    description:
      'Recorded runs, design options, viewpoints, field records and the current scene: the backup of what this browser stores.',
    formats: [JSON_FILE],
  },
  {
    kind: 'scene-package',
    group: 'files',
    label: '3D scene',
    description:
      'The road view as a file for other renderers: the ground, every tree drawn within 600 m, the cut ground and where the eye stands. Display only.',
    formats: [JSON_FILE],
  },
]

export const findVisualsExport = (kind: VisualsExport) =>
  VISUALS_EXPORTS.find((item) => item.kind === kind) ?? VISUALS_EXPORTS[0]

export type Row = { label: string; value: string }

/** A saved view as the dialog lists it: where it was taken and what produced it. */
export type ExportView = {
  id: string
  name: string
  /** The road or viewpoint it was saved on. */
  place: string
  /** Saved on the viewpoint the scene has now, rather than one stood at earlier. */
  here: boolean
  positionMeters: number
  harvestPhase: 'before' | 'after'
  design: string | null
  hasScreenshot: boolean
  hasClassPass: boolean
  /** The reviewer keeps it in the block note (every view is, until left out). */
  inReport: boolean
  /** The settings recorded when it was saved (position, facing, eye, lens, timber…). */
  settings: Row[]
}

/** An inventory viewpoint or rec site near the note's block, as the dialog lists it. */
export type ExportInventoryViewpoint = {
  key: string
  name: string
  kind: 'vli' | 'rec-site'
  distanceMeters: number
  /** One of its arrows points at the block. */
  aims: boolean
}

/** The visibility run the export starts on its own when a file needs it. */
export type ExportAutoRun = {
  /** Why the scene cannot run, or null when it can. */
  blocker: string | null
  status: 'idle' | 'running' | 'error'
  /** The run's progress, worded, while it runs. */
  progress: string | null
  error: string | null
}

export type ExportLandform = {
  name: string
  objective: string
  vac: string | null
  areaHa: number
  source: string
  inventoryUnit: string | null
}

export type ExportContext = {
  run: 'current' | 'stale' | 'none'
  numericalReady: boolean
  /** Run warnings: what the PDF withholds and why. */
  runWarnings: string[]
  perspectivePercent: number | null
  planimetricPercent: number | null
  rating: string | null
  ratingMissing: string[]
  ocularClass: string | null
  viewpoint: { name: string; kind: 'road' | 'spot'; lengthKm: number }
  landform: ExportLandform | null
  landformCount: number
  blocks: Array<{ name: string; areaHa: number; system: string }>
  openings: number
  masks: Array<{ kind: string; name: string }>
  views: ExportView[]
  settings: Row[]
  review: {
    visualsNote: 'yours' | 'draft'
    measures: 'yours' | 'draft'
    stage: string
    checklist: string
  }
  officeFields: { filled: number; total: number }
  /** FS1252: the stations chosen, as labels. */
  fs1252Stations: Array<{ label: string; assessment: boolean; inputs: boolean }>
  /** Block note: the text the paragraph panel holds, or null before a block. */
  blockNote: {
    header: Row[]
    landform: Row[]
    measures: number
    figures: boolean
  } | null
  /** Analysis sheet: the view and the look chosen. */
  figure: { viewId: string | null; style: string; labelStyle: string; cameraInfo: boolean }
  brief: { block: string | null; viewpoints: number; screenshots: number }
  evidence: { loaded: boolean; gaps: string[]; views: number; runs: number; fields: number }
  /** The road view is open with its terrain loaded, so the 3D scene can be written. */
  roadViewReady: boolean
  autoRun: ExportAutoRun
  /** The land status checks (`landStatusChecks.ts`) as the block note would print them now. */
  landChecks: {
    include: boolean
    pending: number
    rows: Array<Row & { note: string; review: boolean; reading: boolean }>
  }
  /** BC inventory viewpoints near the block note's block. */
  inventory: {
    status: 'idle' | 'loading' | 'ready' | 'error'
    error: string | null
    blockName: string | null
    candidates: ExportInventoryViewpoint[]
  }
}

/** The outputs written from the run: the export runs the assessment first when it is missing or stale. */
export const RUNS_ON_EXPORT: ReadonlySet<VisualsExport> = new Set(['block-note', 'fs1252', 'field-brief', 'worksheet'])

/**
 * What writing an output does before the file: run the assessment (in the analysis worker) when
 * the output reads the run and it is missing or stale, and wait for the land checks the block note
 * prints. `note` says so in the dialog, or is null when nothing waits.
 */
export function exportPreparation(
  kind: VisualsExport,
  ctx: Pick<ExportContext, 'run' | 'autoRun' | 'landChecks'>,
): { run: boolean; landChecks: boolean; note: string | null } {
  const run = RUNS_ON_EXPORT.has(kind) && ctx.run !== 'current' && !ctx.autoRun.blocker
  const landChecks = kind === 'block-note' && ctx.landChecks.include && ctx.landChecks.pending > 0
  const note =
    ctx.autoRun.status === 'running' && RUNS_ON_EXPORT.has(kind)
      ? `Running the visibility assessment${ctx.autoRun.progress ? ` · ${ctx.autoRun.progress}` : ''}. The file is written when it finishes.`
      : run
        ? ctx.run === 'stale'
          ? 'The run is out of date: the export runs the assessment again first, in the background, then writes the file.'
          : 'Not run yet: the export runs the assessment first, in the background, then writes the file.'
        : landChecks
          ? 'Land status checks are still reading: the file waits for them.'
          : null
  return { run, landChecks, note }
}

/** Why an output cannot be written yet, or null when it can. */
export function exportUnavailable(kind: VisualsExport, ctx: ExportContext): string | null {
  switch (kind) {
    case 'block-note':
      return ctx.blockNote ? null : 'Add a cutblock in step 1 to write its note.'
    case 'fs1252':
      if (ctx.run !== 'current' && !ctx.autoRun.blocker) return null
      if (ctx.run === 'none') return 'Run the visibility assessment first: the form is filled from the run.'
      if (ctx.run === 'stale') return 'The run is out of date. Run it again to fill the form from the current scene.'
      if (!ctx.fs1252Stations.length) return 'Choose at least one station for the form.'
      return ctx.fs1252Stations.length > 30 ? 'Choose 30 stations or fewer.' : null
    case 'analysis-sheet':
      return ctx.views.some((view) => view.hasScreenshot)
        ? null
        : 'Save a viewpoint in the road view first: its screenshot and class pass are what the sheet is drawn from.'
    case 'field-brief':
      return ctx.brief.block ? null : 'Add a cutblock in step 1 to brief the crew on it.'
    case 'worksheet':
      return ctx.run === 'current' || !ctx.autoRun.blocker
        ? null
        : ctx.run === 'stale'
          ? 'The run is out of date. Run it again to write the worksheet.'
          : `Run the visibility assessment first. ${ctx.autoRun.blocker}`
    case 'evidence':
    case 'workspace':
      return ctx.evidence.loaded ? null : 'The stored workspace is still loading.'
    case 'views':
      return null
    case 'scene':
      return null
    case 'scene-package':
      return ctx.roadViewReady ? null : 'Open the road view and let its terrain load first.'
  }
}

/**
 * A job the dialog can start for a part: `stand:<key>` stands at an inventory viewpoint in the road
 * view, `load-inventory` reads the inventory near the block, `open-road-view` opens the road view.
 */
export type ExportAction = { id: string; label: string }

/** A part of an output, with the step where it is set. */
export type ExportSection = {
  title: string
  step?: ViaStepId
  rows?: Row[]
  /** One entry per thing listed, such as a saved view with its settings. */
  items?: Array<{ title: string; subtitle?: string; rows?: Row[]; action?: ExportAction }>
  /** A button beside the title that does the part's job from the dialog. */
  action?: ExportAction
  /** Said when there is nothing to list. */
  empty?: string
  note?: string
}

const hectares = (ha: number) =>
  `${ha.toLocaleString('en-CA', { maximumFractionDigits: ha < 10 ? 1 : 0, minimumFractionDigits: ha < 10 ? 1 : 0 })} ha`
const percent = (value: number | null) => (value === null ? 'withheld' : `${value.toFixed(2)}%`)
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function runSection(ctx: ExportContext): ExportSection {
  const status =
    ctx.run === 'current'
      ? ctx.numericalReady
        ? 'Current'
        : 'Current · provisional: numerical fields withheld'
      : ctx.run === 'stale'
        ? 'Out of date: the scene changed since it ran'
        : 'Not run'
  return {
    title: 'Run',
    step: 'design',
    rows: [
      { label: 'Status', value: status },
      ...(ctx.run === 'none'
        ? []
        : [
            { label: 'Perspective alteration', value: percent(ctx.perspectivePercent) },
            { label: 'Planimetric alteration', value: percent(ctx.planimetricPercent) },
          ]),
    ],
    note: ctx.runWarnings.length ? ctx.runWarnings.join(' ') : undefined,
  }
}

function landformSection(ctx: ExportContext): ExportSection {
  const lf = ctx.landform
  return {
    title: 'Landform',
    step: 'identify',
    rows: lf
      ? [
          { label: 'Name', value: lf.name },
          { label: 'Objective', value: lf.objective },
          ...(lf.vac ? [{ label: 'VAC', value: lf.vac }] : []),
          { label: 'Area', value: hectares(lf.areaHa) },
          { label: 'Source', value: lf.source },
          ...(lf.inventoryUnit ? [{ label: 'Inventory unit', value: lf.inventoryUnit }] : []),
          ...(ctx.landformCount > 1
            ? [{ label: 'Other landforms', value: `${ctx.landformCount - 1} in the scene, not assessed` }]
            : []),
        ]
      : undefined,
    empty: 'None chosen. Adopt or draw a landform in step 1.',
  }
}

function viewpointSection(ctx: ExportContext): ExportSection {
  return {
    title: 'Viewpoint',
    step: 'identify',
    rows: [
      { label: 'Name', value: ctx.viewpoint.name || 'Unnamed' },
      {
        label: 'Kind',
        value:
          ctx.viewpoint.kind === 'road'
            ? `Road, ${ctx.viewpoint.lengthKm.toFixed(2)} km`
            : 'A spot (a pullout or viewpoint stood at)',
      },
    ],
  }
}

function viewsSection(ctx: ExportContext, title: string, options: { screenshotsOnly?: boolean } = {}): ExportSection {
  const views = options.screenshotsOnly ? ctx.views.filter((view) => view.hasScreenshot) : ctx.views
  return {
    title,
    step: 'visit',
    items: views.map((view) => ({
      title: view.name,
      subtitle: [
        view.here ? `${(view.positionMeters / 1000).toFixed(2)} km along ${view.place}` : `At ${view.place}`,
        view.harvestPhase === 'after' ? 'after harvest' : 'before harvest',
        view.design ? `design ${view.design}` : null,
        view.hasScreenshot ? (view.hasClassPass ? 'screenshot and class pass' : 'screenshot only') : 'no screenshot',
      ]
        .filter(Boolean)
        .join(' · '),
      rows: view.settings,
    })),
    empty: 'No saved views. Save one from the road view’s bar.',
  }
}

/** The block note's views: which go in, which are left out, and which have no screenshot. */
function reportViewsSection(ctx: ExportContext, figures: boolean): ExportSection {
  const order = (view: ExportView) => (view.inReport && view.hasScreenshot ? 0 : view.hasScreenshot ? 2 : 1)
  const views = [...ctx.views].sort((a, b) => order(a) - order(b))
  const shown = views.filter((view) => view.inReport && view.hasScreenshot).length
  return {
    title: 'Viewpoints in the report',
    step: 'visit',
    items: views.map((view) => ({
      title: view.name,
      subtitle: [
        !view.hasScreenshot
          ? view.inReport
            ? 'Listed as missing: no screenshot'
            : 'Left out · no screenshot'
          : view.inReport
            ? figures && view.hasClassPass
              ? 'In the report as its analysis-sheet figure'
              : 'In the report as its screenshot'
            : 'Left out',
        view.here ? `${(view.positionMeters / 1000).toFixed(2)} km along ${view.place}` : `At ${view.place}`,
        view.harvestPhase === 'after' ? 'after harvest' : 'before harvest',
        view.design ? `design ${view.design}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      rows: view.settings,
    })),
    empty: 'No saved views. Stand at a viewpoint below, or open the road view, and save one from its bar.',
    note: ctx.views.length
      ? `${plural(shown, 'view')} in the report. Choose which in Options. Screenshots are taken when a view is saved, never redrawn at export.`
      : undefined,
  }
}

const INVENTORY_SHOWN = 6

/** BC inventory viewpoints near the block: places a reviewer would stand, not yet captured. */
function inventorySection(ctx: ExportContext): ExportSection {
  const inv = ctx.inventory
  const load = { id: 'load-inventory', label: inv.status === 'error' ? 'Try again' : 'Find them' }
  return {
    title: 'Inventory viewpoints near the block',
    step: 'identify',
    action: inv.status === 'idle' || inv.status === 'error' ? load : undefined,
    items:
      inv.status === 'ready'
        ? inv.candidates.slice(0, INVENTORY_SHOWN).map((candidate) => ({
            title: candidate.name,
            subtitle: [
              candidate.kind === 'rec-site' ? 'Recreation site' : 'Inventory viewpoint',
              `${(candidate.distanceMeters / 1000).toFixed(1)} km from the block`,
              candidate.kind === 'rec-site' ? null : candidate.aims ? 'an arrow aims at it' : 'no arrow aims at it',
            ]
              .filter(Boolean)
              .join(' · '),
            action: { id: `stand:${candidate.key}`, label: 'Stand here' },
          }))
        : undefined,
    empty: !inv.blockName
      ? 'Add a cutblock first.'
      : inv.status === 'loading'
        ? 'Reading the BC Visual Landscape Inventory near the block…'
        : inv.status === 'error'
          ? (inv.error ?? 'The inventory could not be read.')
          : inv.status === 'ready'
            ? `None within reach of ${inv.blockName}.`
            : 'Not read yet.',
    note:
      inv.status === 'ready' && inv.candidates.length
        ? `Not in the report until captured: Stand here opens the road view there facing the block; save a view from its bar to add it.${inv.candidates.length > INVENTORY_SHOWN ? ` ${inv.candidates.length - INVENTORY_SHOWN} more in step 1.` : ''}`
        : undefined,
  }
}

/** The land status checks as the note prints them. */
function landChecksSection(ctx: ExportContext): ExportSection {
  const checks = ctx.landChecks
  return {
    title: 'Land status checks',
    rows: checks.include
      ? checks.rows.map((row) => ({
          label: row.label,
          value: row.reading ? 'Checking…' : row.value,
        }))
      : undefined,
    empty: 'Left out of the note. Turn them on in Options.',
    note: checks.include
      ? 'Their own sheet and page: a screen from DataBC, never a legal determination or a mask. Not read means the layer could not be read.'
      : undefined,
  }
}

function blocksSection(ctx: ExportContext): ExportSection {
  return {
    title: 'Blocks',
    step: 'identify',
    rows: [
      ...ctx.blocks.map((block) => ({ label: block.name, value: `${hectares(block.areaHa)} · ${block.system}` })),
      ...(ctx.openings ? [{ label: 'Existing openings', value: String(ctx.openings) }] : []),
      ...(ctx.masks.length
        ? [
            {
              label: 'Masks',
              value: Object.entries(
                ctx.masks.reduce<Record<string, number>>((counts, mask) => {
                  counts[mask.kind] = (counts[mask.kind] ?? 0) + 1
                  return counts
                }, {}),
              )
                .map(([kind, n]) => `${n} ${kind}`)
                .join(' · '),
            },
          ]
        : []),
    ],
    empty: 'No cutblocks yet.',
  }
}

function settingsSection(ctx: ExportContext): ExportSection {
  return { title: 'Run settings', step: 'design', rows: ctx.settings }
}

function reviewSection(ctx: ExportContext): ExportSection {
  return {
    title: 'Review',
    step: 'rate',
    rows: [
      { label: 'Rating', value: ctx.rating ?? 'Not rated yet' },
      ...(ctx.ocularClass ? [{ label: 'Ocular class', value: ctx.ocularClass }] : []),
      ...(ctx.rating || !ctx.ratingMissing.length
        ? []
        : [{ label: 'Still needed', value: ctx.ratingMissing.join('; ') }]),
    ],
  }
}

/** What goes into an output, part by part. */
export function exportContents(kind: VisualsExport, ctx: ExportContext): ExportSection[] {
  switch (kind) {
    case 'block-note': {
      const note = ctx.blockNote
      return [
        {
          title: 'Block',
          step: 'identify',
          rows: note?.header,
          empty: 'No cutblock yet.',
        },
        {
          title: 'Visuals paragraph and measures',
          step: 'rate',
          rows: [
            {
              label: 'Visuals paragraph',
              value: ctx.review.visualsNote === 'yours' ? 'Yours, as signed' : 'The draft, marked as a draft',
            },
            {
              label: 'Visual measures',
              value: `${plural(note?.measures ?? 0, 'measure')} · ${ctx.review.measures === 'yours' ? 'yours' : 'the draft'}`,
            },
          ],
        },
        { title: 'Landform', step: 'identify', rows: note?.landform, empty: 'None adopted.' },
        reportViewsSection(ctx, !!note?.figures),
        inventorySection(ctx),
        landChecksSection(ctx),
        { title: 'Plan map', rows: [{ label: 'Plan map', value: 'The block and the viewpoint, taken from the map' }] },
      ]
    }
    case 'fs1252':
      return [
        runSection(ctx),
        {
          title: 'Stations in the PDF',
          step: 'assess',
          items: ctx.fs1252Stations.map((station) => ({
            title: station.label,
            subtitle: station.assessment
              ? 'The assessment station · step 4 record'
              : station.inputs
                ? 'Reviewer inputs set'
                : 'Reviewer inputs optional',
          })),
          empty: 'None chosen.',
        },
        landformSection(ctx),
        viewpointSection(ctx),
        reviewSection(ctx),
        {
          title: 'Office information',
          rows: [{ label: 'Filled', value: `${ctx.officeFields.filled} of ${ctx.officeFields.total} fields` }],
          note: 'Unknown fields stay blank. The signature and the final decision are never filled.',
        },
      ]
    case 'analysis-sheet': {
      const view = ctx.views.find((entry) => entry.id === ctx.figure.viewId) ?? null
      return [
        {
          title: 'Figure',
          step: 'visit',
          rows: [
            { label: 'Saved view', value: view?.name ?? 'None' },
            { label: 'Figure style', value: ctx.figure.style },
            { label: 'Label style', value: ctx.figure.labelStyle },
            { label: 'Camera information', value: ctx.figure.cameraInfo ? 'On the image' : 'Off' },
            {
              label: 'Outlines and pixel figure',
              value: view?.hasClassPass ? 'From the view’s class pass' : 'None: saved without a class pass',
            },
          ],
        },
        ...(view
          ? [{ title: 'View settings', step: 'visit' as const, rows: view.settings, empty: 'Not recorded.' }]
          : []),
        landformSection(ctx),
        runSection(ctx),
      ]
    }
    case 'field-brief':
      return [
        {
          title: 'Brief',
          step: 'visit',
          rows: [
            { label: 'Block', value: ctx.brief.block ?? 'None' },
            { label: 'Viewpoints', value: String(ctx.brief.viewpoints) },
            { label: 'Screenshots', value: `${ctx.brief.screenshots} (up to 3)` },
            { label: 'Layout stage', value: ctx.review.stage },
            { label: 'Crew checklist', value: ctx.review.checklist },
          ],
        },
        landformSection(ctx),
        runSection(ctx),
        viewsSection(ctx, 'Saved views', { screenshotsOnly: true }),
      ]
    case 'worksheet':
      return [runSection(ctx), landformSection(ctx), viewpointSection(ctx), blocksSection(ctx), settingsSection(ctx)]
    case 'evidence':
      return [
        {
          title: 'Package',
          step: 'rate',
          rows: [
            { label: 'Recorded assessments', value: String(ctx.evidence.runs) },
            { label: 'Viewpoints', value: String(ctx.evidence.views) },
            { label: 'Field records', value: String(ctx.evidence.fields) },
          ],
        },
        {
          title: 'Evidence checklist',
          step: 'rate',
          items: ctx.evidence.gaps.map((gap) => ({ title: gap })),
          empty: 'Expected evidence categories present. Check content and adequacy.',
        },
      ]
    case 'scene':
      return [
        viewpointSection(ctx),
        landformSection(ctx),
        blocksSection(ctx),
        settingsSection(ctx),
        reviewSection(ctx),
        {
          title: 'Not in the file',
          note: 'Saved views and their screenshots, terrain tiles and the inventory. Use Saved views to keep the views.',
        },
      ]
    case 'views': {
      const elsewhere = ctx.views.filter((view) => !view.here).length
      return [
        viewpointSection(ctx),
        {
          ...viewsSection({ ...ctx, views: ctx.views.filter((view) => view.here) }, 'Saved views'),
          note: elsewhere
            ? `${plural(elsewhere, 'view')} saved at other viewpoints ${elsewhere === 1 ? 'is' : 'are'} not in this file; stand there again to save ${elsewhere === 1 ? 'it' : 'them'}.`
            : undefined,
        },
        landformSection(ctx),
        blocksSection(ctx),
        { title: 'Not in the file', note: 'Screenshots and class passes: save the documents that carry them first.' },
      ]
    }
    case 'workspace':
      return [
        {
          title: 'Workspace',
          step: 'rate',
          rows: [
            { label: 'Recorded assessments', value: String(ctx.evidence.runs) },
            { label: 'Viewpoints', value: String(ctx.evidence.views) },
            { label: 'Field records', value: String(ctx.evidence.fields) },
            { label: 'Current scene', value: ctx.viewpoint.name || 'Unnamed viewpoint' },
          ],
        },
      ]
    case 'scene-package':
      return [
        viewpointSection(ctx),
        {
          title: 'Road view',
          step: 'visit',
          rows: [{ label: 'Status', value: ctx.roadViewReady ? 'Open, terrain loaded' : 'Closed' }],
          action: ctx.roadViewReady ? undefined : { id: 'open-road-view', label: 'Open the road view' },
          note: 'The eye and the look are where the road view stands now.',
        },
      ]
  }
}

/** A saved view with what was kept when it was saved, as the page holds them. */
export type ContextView = {
  view: Pick<
    SavedDriveView,
    | 'id'
    | 'name'
    | 'positionMeters'
    | 'harvestPhase'
    | 'treeHeightMeters'
    | 'roadClearWidthMeters'
    | 'lookAtTargetId'
    | 'lookBearing'
    | 'designName'
  >
  here: boolean
  screenshot: boolean
  classPass: boolean
  /** The settings rows recorded with the screenshot (`ViewpointPage.settings`), when one was taken. */
  settings: Row[] | null
  /** Kept in the block note; true unless the reviewer left it out. */
  inReport?: boolean
}

export type ContextInput = {
  scene: ForestryScene
  result: AnalysisResult | null
  stale: boolean
  assessment: ViaAssessment | null
  views: ContextView[]
  fs1252: { selected: number[]; reviews: Record<number, unknown> }
  blockNote: { header: Row[]; landform: Row[]; measures: number } | null
  noteFigures: boolean
  figure: { viewId: string | null; style: string; labelStyle: string; cameraInfo: boolean }
  brief: { blockId: string | null; viewpoints: number }
  evidence: { loaded: boolean; gaps: string[]; counts: { views: number; runs: number; fields: number } }
  roadViewReady: boolean
  officeFieldCount: number
  autoRun: ExportAutoRun
  landChecks: ExportContext['landChecks']
  inventory: ExportContext['inventory']
}

const objectiveName = (id: VisualQualityClassId) => {
  const code = EVQO_CODE_FOR_CLASS[id]
  return `${EVQO_NAMES[code]} (${code})`
}

const SYSTEM_NAMES: Record<HarvestSystem, string> = {
  clearcut: 'clearcut',
  retention: 'dispersed retention',
  partial: 'partial cut',
}

/** The run's settings, worded as the files name them. */
export function settingsRows(scene: ForestryScene): Row[] {
  const s = scene.settings
  return [
    { label: 'Eye height', value: `${s.observerHeightMeters} m` },
    { label: 'Station spacing', value: `${s.stationSpacingMeters} m` },
    { label: 'Farthest view', value: `${(s.maxViewDistanceMeters / 1000).toLocaleString('en-CA')} km` },
    { label: 'Green-up age', value: `${s.greenUpAgeYears} years` },
    {
      label: 'Screening',
      value: s.screeningEnabled
        ? `On · crown closure ${s.minCrownClosurePercent}%+ · cleared ${s.screeningEyeClearingMeters ?? 50} m round the eye`
        : 'Off: bare earth',
    },
    {
      label: 'Perspective denominator',
      value:
        s.perspectiveDenominator === 'non-treed-out'
          ? 'Treed landform only (1998 rule)'
          : 'Landform net of rock, water and ice',
    },
    {
      label: 'Private land',
      value: s.privateLandOutOfDenominator ? 'Out of the denominators' : 'In the denominators, no alteration',
    },
    { label: 'Assessment year', value: String(scene.assessmentYear ?? new Date().getFullYear()) },
  ]
}

/** The settings of a saved view without a screenshot record: what the view itself keeps. */
function viewRows(view: ContextView['view'], scene: ForestryScene): Row[] {
  const target = view.lookAtTargetId ? scene.targets.find((entry) => entry.id === view.lookAtTargetId) : null
  return [
    {
      label: 'Position',
      value: `${(view.positionMeters / 1000).toFixed(2)} km along ${scene.viewpoint.name || 'the road'}`,
    },
    {
      label: 'Facing',
      value: target ? target.name : view.lookBearing != null ? `${Math.round(view.lookBearing)}°` : 'Along the road',
    },
    { label: 'Timber', value: `${view.treeHeightMeters} m where heights are not recorded` },
    { label: 'Road clearing', value: `${view.roadClearWidthMeters} m` },
  ]
}

const roadLengthKm = (coordinates: ReadonlyArray<[number, number]>) => lineLengthMeters(coordinates) / 1000

/** The dialog's context from the page's state. */
export function buildExportContext(input: ContextInput): ExportContext {
  const { scene, result, stale, assessment } = input
  const landform = findSceneLandform(scene)
  const review = scene.viaReview ?? {}
  const checklist = review.fieldChecklist
  const answers = checklist
    ? [...Object.values(checklist.viewpoints), ...Object.values(checklist.greenUp)].filter((entry) => entry.answer)
        .length
    : 0
  const block = (id: string | null) => scene.targets.find((entry) => entry.role === 'block' && entry.id === id) ?? null
  const blocks = scene.targets.filter((target) => target.role === 'block')
  const briefBlock = block(input.brief.blockId) ?? blocks[0] ?? null
  const lengthKm = roadLengthKm(scene.viewpoint.coordinates)
  return {
    run: result ? 'current' : stale ? 'stale' : 'none',
    numericalReady: !!result?.quality?.numericalReady,
    runWarnings: (result?.quality?.warnings ?? []).slice(0, 3),
    perspectivePercent: result?.perspectiveAlteration?.cumulativePercent ?? null,
    planimetricPercent: result?.planimetricAlteration?.cumulativePercent ?? null,
    rating: assessment?.rating?.label ?? null,
    ratingMissing: assessment?.missing ?? [],
    ocularClass: assessment?.ocular ? objectiveName(assessment.ocular.classId) : null,
    viewpoint: {
      name: scene.viewpoint.name,
      kind: scene.viewpoint.mode === 'corridor' && lengthKm > 0.1 ? 'road' : 'spot',
      lengthKm,
    },
    landform: landform
      ? {
          name: landform.name,
          objective: objectiveName(landform.objectiveId),
          vac: landform.vac,
          areaHa: polygonAreaMeters(landform.geometry) / 10_000,
          source: landform.source,
          inventoryUnit: landform.inventoryUnitId ?? null,
        }
      : null,
    landformCount: scene.targets.filter((target) => target.role === 'landscape').length,
    blocks: blocks.map((entry) => ({
      name: entry.name,
      areaHa: polygonAreaMeters(entry.geometry) / 10_000,
      system:
        entry.harvestSystem === 'retention' && entry.retentionPercent != null
          ? `${SYSTEM_NAMES.retention}, ${entry.retentionPercent}% left`
          : SYSTEM_NAMES[entry.harvestSystem ?? 'clearcut'],
    })),
    openings: scene.targets.filter((target) => target.role === 'harvested').length,
    masks: (scene.masks ?? []).map((mask) => ({
      kind: mask.kind === 'retained' ? 'retention' : mask.kind,
      name: mask.name,
    })),
    views: input.views.map(({ view, here, screenshot, classPass, settings, inReport }) => ({
      id: view.id,
      name: view.name,
      place: here ? scene.viewpoint.name || 'the road' : 'an earlier viewpoint',
      here,
      positionMeters: view.positionMeters,
      harvestPhase: view.harvestPhase,
      design: view.designName ?? null,
      hasScreenshot: screenshot,
      hasClassPass: classPass,
      inReport: inReport ?? true,
      settings: [
        ...(settings ?? viewRows(view, scene)),
        { label: 'Harvest phase', value: view.harvestPhase === 'after' ? 'After harvest' : 'Before harvest' },
      ],
    })),
    settings: settingsRows(scene),
    review: {
      visualsNote: review.visualsNote ? 'yours' : 'draft',
      measures: review.visualMeasures ? 'yours' : 'draft',
      stage: layoutStageLabel(layoutStageOf(review)),
      checklist: answers ? `${answers} answer${answers === 1 ? '' : 's'} recorded` : 'Not checked yet',
    },
    officeFields: {
      filled: Object.values(scene.reportMetadata ?? {}).filter((value) => typeof value === 'string' && value.trim())
        .length,
      total: input.officeFieldCount,
    },
    fs1252Stations: result
      ? input.fs1252.selected
          .filter((index) => index < result.stations.length)
          .map((index) => ({
            label: `Station ${index + 1} · ${(result.stations[index].distanceAlongMeters / 1000).toFixed(2)} km`,
            assessment: index === result.assessmentStationIndex,
            inputs: !!input.fs1252.reviews[index],
          }))
      : [],
    blockNote: input.blockNote ? { ...input.blockNote, figures: input.noteFigures } : null,
    figure: input.figure,
    brief: {
      block: briefBlock?.name ?? null,
      viewpoints: input.brief.viewpoints,
      screenshots: Math.min(3, input.views.filter((view) => view.screenshot).length),
    },
    evidence: { loaded: input.evidence.loaded, gaps: input.evidence.gaps, ...input.evidence.counts },
    roadViewReady: input.roadViewReady,
    autoRun: input.autoRun,
    landChecks: input.landChecks,
    inventory: input.inventory,
  }
}
