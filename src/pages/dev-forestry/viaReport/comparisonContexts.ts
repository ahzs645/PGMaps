/**
 * Made-up assessments that between them print every report part and every block kind, for the standing comparison of
 * the two ways a VIA report's Word document is built (`recipeRoute.test.ts`, `scripts/forestry/via-recipes/`): the
 * direct route (`reportDocument(assembleReport(recipe, ctx))`) and the recipe engine's (`recipeRoute.ts`). Made-up
 * cases only: no real VIA's case, block, licensee, place or figure. Test support: no DOM or network access.
 */
import { encodePng } from '@/lib/mapSheet/png'

import { assessmentScope } from '../assessmentScope'
import { DEFAULT_ANALYSIS_SETTINGS, type TargetPolygon } from '../types'
import { assessVia, DESIGN_ELEMENTS, finalRating, type ViaAssessment, type ViaReview } from '../via'
import { findDocumentFormat } from '../viaDocument/formats'
import { resolveViaDocument, type DocumentFacts } from '../viaDocument/resolve'
import type { ReportLogo } from './html'
import type { ReportFigure } from './model'
import type { ReportContext, ReportImages } from './parts'
import { assembleReportParts, type ReportRecipe } from './recipes'
import type { ReportEdits } from './edits'

/** One assessment to build a report from, with what the page adds around it. */
export interface ComparisonCase {
  name: string
  ctx: ReportContext
  edits?: ReportEdits
  leftOut?: ReadonlyArray<{ name: string; reason: string }>
  logo: ReportLogo | null
}

export const COMPARISON_VARIANTS = ['full', 'bare', 'single', 'edited'] as const
export type ComparisonVariant = (typeof COMPARISON_VARIANTS)[number]

/** A PNG data URL `w` × `h`: a sky over a green hill, shifted by `seed` so pictures differ. */
async function png(w: number, h: number, seed: number): Promise<string> {
  const rgba = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const hill = h * (0.55 + 0.15 * Math.sin((x + seed * 13) / Math.max(1, w / 6)))
      const sky = y < hill
      const at = (y * w + x) * 4
      rgba[at] = sky ? 150 + ((x + seed) % 40) : 40 + ((x * 3) % 30)
      rgba[at + 1] = sky ? 190 : 110 + ((y * 5) % 40)
      rgba[at + 2] = sky ? 230 : 50
      rgba[at + 3] = 255
    }
  const bytes = await encodePng(rgba, w, h)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return `data:image/png;base64,${btoa(binary)}`
}

interface Pictures {
  photo: string
  sheet: string
  portrait: string
  wide: string
}
let pictures: Promise<Pictures> | null = null
const drawn = () =>
  (pictures ??= Promise.all([png(60, 40, 2), png(77, 50, 1), png(50, 77, 3), png(96, 36, 4)]).then(
    ([photo, sheet, portrait, wide]) => ({ photo, sheet, portrait, wide }),
  ))

const viewpoint = (name: string, i: number, rich: boolean): DocumentFacts['viewpoints'][number] => ({
  name,
  landform: 'Landform 1',
  objective: 'PR',
  inventory: { vsu: '12', vsc: '2', vac: 'M', evc: 'R', vqo: 'PR', date: '2019-04-01' },
  areas: { landform: 10000, proposed: 300 + 50 * i, nonVeg: 40, privateLand: 120, rock: 500 },
  sightlinePercent: 3.1 + i,
  distanceKm: 2.6 + i,
  hfovDeg: 39.6,
  lensMm: 50,
  lngLat: [-122.5 + i / 100, 53.9],
  elevationM: 640 + 10 * i,
  bearingDeg: 45 + 30 * i,
  blocks: [
    { id: 'X1', status: 'visible', visiblePercent: 40 - 10 * i },
    { id: 'X2', status: i ? 'possible glimpses' : 'not visible', visiblePercent: i ? 4 : 0 },
  ],
  ...(rich
    ? {
        greenUp: 'inventory heights, 20-year green-up',
        review: {
          selectionReason: 'its lake traffic',
          viewingExperience: 'sustained views from the water',
          importance: 'Moderate (3)',
        },
        ...(i === 0 ? { atAssessment: true } : {}),
      }
    : {}),
})

/** The reviewer's step 4 for the full cases: every judgement given. */
const REVIEW: ViaReview = {
  ocular: { visibleness: 'easy', scale: 'small', shape: 'natural' },
  design: Object.fromEntries(DESIGN_ELEMENTS.map((element, i) => [element.id, i % 2 ? 1 : 0])),
  roads: 1,
  retention: 'moderate',
  rationale: 'The block follows the slope and keeps its upper edge below the ridge.',
  viewpointType: 4,
  visualsNote: 'The block is seen from the lake as a small opening below the ridge.',
}

function assessment(): ViaAssessment {
  const base = assessVia({ objectiveId: 'partial-retention', result: null, review: REVIEW })
  const percent = 4.2
  return {
    ...base,
    initialPercent: 5.1,
    clearedPercent: 5.1,
    adjusted: { percent, classId: 'partial-retention' },
    rating: base.ocular
      ? finalRating({ objectiveId: 'partial-retention', ocular: base.ocular, adjustedPercent: percent })
      : null,
  }
}

const figure = (view: string, dataUrl: string, over: Partial<ReportFigure> = {}): ReportFigure => ({
  view,
  caption: `${view}: analysis`,
  dataUrl,
  width: 600,
  height: 400,
  ...over,
})

function images(names: readonly string[], p: Pictures, sheets: boolean): ReportImages {
  const map = {
    legend: [
      { label: 'Proposed block', color: '#ff0000' },
      { label: 'Road', color: '#333333', kind: 'line' as const },
      { label: 'Viewpoint', color: '#1d4ed8', kind: 'point' as const },
    ],
    scale: '1:50,000',
    northUp: true,
  }
  return {
    overviewMap: figure('overview', p.photo, { caption: 'Overview map', map }),
    // An 11 × 17 sheet with its own furniture (landscape), or the portrait end map.
    overviewSheet: sheets
      ? figure('overview sheet', p.portrait, {
          caption: 'Overview sheet',
          width: 792,
          height: 1224,
          map: { ...map, inPicture: true },
        })
      : figure('overview sheet', p.sheet, {
          caption: 'Overview sheet',
          width: 1224,
          height: 792,
          map: { ...map, inPicture: true },
        }),
    regionalMap: figure('regional', p.photo, { caption: 'Regional map', map: { scale: '1:250,000' } }),
    locationMaps: Object.fromEntries(names.map((name) => [name, figure(`location ${name}`, p.photo, { map })])),
    figurePageMaps: {
      location: Object.fromEntries(names.map((name) => [name, figure(`page location ${name}`, p.photo)])),
      regional: figure('page regional', p.photo),
    },
    before: Object.fromEntries(
      names.map((name, i) => [
        name,
        {
          ...figure(`before ${name}`, p.wide, { width: 960, height: 360, landformRows: { y: 100, height: 120 } }),
          source: i ? ('render' as const) : ('photo' as const),
          ...(i ? { renderer: 'PGMaps' } : { takenOn: '2026-06-01' }),
        },
      ]),
    ),
    after: Object.fromEntries(
      names.map((name) => [
        name,
        figure(`after ${name}`, p.wide, {
          width: 960,
          height: 360,
          landformRows: { y: 100, height: 120 },
          marks: [
            { x: 0.3, y: 0.5, label: 'X1', status: 'visible' },
            { x: 0.7, y: 0.55, label: 'X2', status: 'not visible' },
          ],
        }),
      ]),
    ),
    overhead: [figure('overhead', p.photo), figure('oblique 1', p.photo), figure('oblique 2', p.photo)],
  }
}

const square = (lng: number, lat: number, size: number): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [lng, lat],
      [lng + size, lat],
      [lng + size, lat + size],
      [lng, lat + size],
      [lng, lat],
    ],
  ],
})
const made = (id: string, role: TargetPolygon['role'], geometry: GeoJSON.Polygon, patch: Partial<TargetPolygon> = {}) =>
  ({
    id,
    name: id,
    role,
    objectiveId: 'partial-retention',
    vac: null,
    harvestYear: null,
    clearcutPercent: null,
    geometry,
    source: 'Drawn here',
    ...patch,
  }) as TargetPolygon

/** A made-up scope: a drawn landform, a clearcut with a drawn wildlife tree patch, a partial cut. */
const SCOPE = assessmentScope({
  targets: [
    made('Landform 1', 'landscape', square(-122.5, 53.9, 0.05)),
    made('X1', 'block', square(-122.49, 53.91, 0.01)),
    made('X2', 'block', square(-122.47, 53.93, 0.008), { harvestSystem: 'partial', volumeRemovedPercent: 40 }),
  ],
  masks: [
    {
      id: 'wtp',
      name: 'Wildlife tree patch 1',
      kind: 'retained',
      geometry: square(-122.485, 53.915, 0.002),
      source: 'Drawn on the plan map',
    },
  ],
  settings: DEFAULT_ANALYSIS_SETTINGS,
  landformId: 'Landform 1',
})

/** The assessment `variant` as `recipe` reads it. */
export async function comparisonCase(recipe: ReportRecipe, variant: ComparisonVariant): Promise<ComparisonCase> {
  const p = await drawn()
  const rich = variant === 'full' || variant === 'edited'
  const names = variant === 'single' ? ['Lakeshore'] : ['Lakeshore', 'Ridge road']
  const facts: DocumentFacts = { project: 'Block X1', viewpoints: names.map((name, i) => viewpoint(name, i, rich)) }
  const ctx: ReportContext = {
    date: new Date('2026-11-16T12:00:00Z'),
    office:
      variant === 'bare'
        ? {}
        : {
            district: 'Made-up District',
            licensee: 'Made-up Forest Products',
            licence: 'A00000',
            cuttingPermit: '1',
            blockIds: 'X1, X2',
            generalLocation: 'Made-up Lake',
            sourceDocument: 'a made-up higher level plan',
            referenceDocument: 'a made-up earlier assessment',
            evaluator: 'A. Person',
            evaluatorDesignation: 'RPF',
            evaluatorOrganisation: 'Made-up Consulting',
            inventoryDate: '2019',
          },
    blocks: [
      {
        name: 'X1',
        areaHa: 12.4,
        system: 'Clearcut',
        retentionPercent: 8,
        partialCut: null,
        islands: 2,
        reservesHa: 1.1,
      },
      {
        name: 'X2',
        areaHa: 8,
        system: 'Partial cut',
        retentionPercent: null,
        partialCut: { removedPercent: 40, residualHeightM: 25 },
      },
    ],
    landform:
      variant === 'bare'
        ? null
        : { name: 'Landform 1', objective: 'PR', vac: 'M', areaHa: 410, source: 'drawn in step 1' },
    ...(rich ? { landforms: [{ name: 'Landform 1', description: 'A long west-facing slope above the lake.' }] } : {}),
    inventory: variant === 'bare' ? null : (facts.viewpoints[0].inventory ?? null),
    inventoryRead: variant !== 'bare',
    ...(variant === 'bare'
      ? {}
      : {
          inventoryUnits: [
            {
              vsu: '12',
              vsc: '2',
              vac: 'M',
              evc: 'R',
              vqo: 'PR',
              date: '2019-04-01',
              blocks: { X1: 12.4, X2: 8 },
              netBlocks: { X1: 11.3 },
            },
          ],
        }),
    facts,
    document: resolveViaDocument(findDocumentFormat(recipe.format)!, facts),
    assessment: rich ? assessment() : null,
    review: rich ? REVIEW : null,
    breakdown: rich
      ? { existingPercent: 1.2, disturbancePercent: 0.4, proposedPercent: 3.1, cumulativePercent: 4.7 }
      : null,
    method: {
      terrain: 'a made-up terrain model',
      vegetation: 'made-up inventory heights',
      eyeHeightM: 1.6,
      ...(variant === 'edited' ? { drawnBy: 'a made-up engine, final quality' } : {}),
    },
    measures: rich ? ['Keep the upper edge below the ridge.', 'Leave a screen along the lake.'] : [],
    figures:
      variant === 'bare'
        ? []
        : names.map((name, i) =>
            // Analysis sheets 17:11, so each prints on its own 11 × 17 page; the second view prints as a plain picture.
            variant === 'single' || i === 0
              ? figure(name, p.sheet, { width: 1224, height: 792, caption: `${name}: analysis sheet` })
              : figure(name, p.photo),
          ),
    ...(variant === 'bare' ? {} : { images: images(names, p, variant === 'single') }),
    ...(rich ? { scope: SCOPE } : {}),
    ...(rich
      ? {
          setting: {
            places: [
              { name: 'Made-up Town', kind: 'settlement', distanceKm: 6.5, direction: 'north' },
              { name: 'Made-up Lake', kind: 'water', distanceKm: 2.5, direction: 'east' },
            ],
            ground: { aspect: 'west', slopePercent: 38.4 },
            landformSlopePercent: 31.2,
            stand: { species: [{ name: 'Douglas-fir', percent: 62 }], heightM: 33.4, coverPercent: 84 },
          },
        }
      : {}),
  } as ReportContext
  const out: ComparisonCase = {
    name: variant,
    ctx,
    logo:
      variant === 'edited'
        ? { name: 'made-up logo', dataUrl: p.photo }
        : variant === 'full'
          ? { name: 'unreadable logo', dataUrl: 'data:image/png;base64,AA' }
          : null,
  }
  if (variant === 'edited') {
    // Three of the report's own values changed by hand, and one edit kept for a place this report does not print.
    const targets = assembleReportParts(recipe, ctx).edits.targets
    const picked = [targets[0], targets[Math.floor(targets.length / 2)], targets[targets.length - 1]].filter(Boolean)
    out.edits = Object.fromEntries([
      ...picked.map((target, i) => [target.key, `Changed by hand ${i + 1}`]),
      [`${recipe.parts[0]}|A place not printed|field|Gone`, 'kept'],
    ])
    out.leftOut = [{ name: 'Back road', reason: 'not captured yet.' }]
  }
  return out
}
