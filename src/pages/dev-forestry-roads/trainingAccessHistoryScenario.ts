/** An invented, offline worked example. No provincial feature extracts or asserted real-world links. */
import {
  createAccessHistoryState,
  mergeHistoricalTrace,
  roadGeometryFingerprint,
  traceHistoricalAccess,
} from './accessHistory'
import type { DateWindow, HistoricalSource } from './accessHistoryTypes'
import { createRoadNetworkEvidence } from './roadNetwork'
import { createDemoProject, DEMO_ORIGIN } from './terrain'
import type { ContextFeature, Coordinate, RoadProject } from './types'

export const ACCESS_HISTORY_TRAINING_DATE = '2010-06-30'
export const ACCESS_HISTORY_TRAINING_IDS = {
  blockA: 'history-example-block-a',
  blockB: 'history-example-block-b',
  west: 'history-example-mainline-west',
  crossing: 'history-example-bridge-road',
  east: 'history-example-mainline-east',
  spurA: 'history-example-spur-a',
  spurB: 'history-example-spur-b',
  bypass: 'history-example-bypass',
  undated: 'history-example-undated-track',
  overpass: 'history-example-overpass',
  bridge: 'history-example-bridge',
  culvert: 'history-example-culvert',
  entranceA: 'history-example-entrance-a',
  entranceB: 'history-example-entrance-b',
  outlet: 'history-example-outlet',
} as const

export function accessHistoryTrainingCoordinate(x: number, y: number): Coordinate {
  return [DEMO_ORIGIN[0] + x / (111195 * Math.cos((DEMO_ORIGIN[1] * Math.PI) / 180)), DEMO_ORIGIN[1] + y / 111195]
}
const at = accessHistoryTrainingCoordinate
const exact = (date: string): DateWindow => ({ earliest: date, latest: date })
const ids = ACCESS_HISTORY_TRAINING_IDS
const exampleUrl = 'https://github.com/ahzs645/PGMaps/blob/main/docs/forestry-road-design/access-history.md'

function source(id: string, dataset: string, publishedOn: string, description: string): HistoricalSource {
  return {
    id,
    dataset: `Synthetic ${dataset}`,
    recordId: `INVENTED-${id}`,
    url: exampleUrl,
    retrievedAt: '2026-11-08T00:00:00Z',
    publishedOn,
    description: `${description} Invented for training; not a BC record.`,
    synthetic: true,
  }
}

function road(
  id: string,
  name: string,
  coordinates: Coordinate[],
  section: string,
  junctions: { id: string; coordinate: Coordinate }[],
  level = 0,
): ContextFeature {
  return {
    id,
    name: `Synthetic ${name}`,
    kind: 'existing-road',
    geometry: { type: 'LineString', coordinates },
    roadEvidence: {
      source: 'scenario',
      roadClass: 'fsr',
      forestFileId: '009900',
      roadSectionId: section,
      condition: 'unknown',
      conditionBasis: 'unreviewed',
      reuseAllowed: false,
      network: { ...createRoadNetworkEvidence(), level, junctions },
    },
  }
}

function block(id: string, name: string, x: number, y: number, start: string, end: string): ContextFeature {
  return {
    id,
    name: `Synthetic ${name}`,
    kind: 'harvest',
    geometry: {
      type: 'Polygon',
      coordinates: [[at(x, y), at(x + 220, y), at(x + 220, y + 200), at(x, y + 200), at(x, y)]],
    },
    harvestEvidence: {
      source: 'scenario',
      sourceId: `INVENTED-${id}`,
      status: 'harvested',
      startDate: start,
      endDate: end,
      startYear: Number(start.slice(0, 4)),
      endYear: Number(end.slice(0, 4)),
      yearMethod: 'reported-dates',
    },
  }
}

/** Two blocks share one crossing; the later bypass cannot explain access in 2010. */
export function createAccessHistoryTrainingProject(): RoadProject {
  const project = createDemoProject()
  project.name = 'Training · reconstruct block access and bridges'
  project.harvestHistoryYear = 2010
  const west = { id: 'history-junction-west', coordinate: at(400, 0) }
  const forkA = { id: 'history-junction-a', coordinate: at(900, 0) }
  const forkB = { id: 'history-junction-b', coordinate: at(1100, 0) }
  const entranceA = { id: 'history-junction-entrance-a', coordinate: at(1000, 350) }
  const entranceB = { id: 'history-junction-entrance-b', coordinate: at(1400, 200) }
  project.context = [
    block(ids.blockA, 'block A · harvested 2009–2010', 950, 350, '2009-09-01', '2010-09-30'),
    block(ids.blockB, 'block B · harvested 2010–2011', 1350, 200, '2010-01-01', '2011-03-31'),
    road(ids.west, 'mainline west · built 1988', [at(0, 0), west.coordinate], '001', [west]),
    road(ids.crossing, 'bridge road · built 1988', [west.coordinate, at(600, 0), forkA.coordinate], '002', [
      west,
      forkA,
    ]),
    road(ids.east, 'mainline east · built 1988', [forkA.coordinate, forkB.coordinate], '003', [forkA, forkB]),
    road(ids.spurA, 'spur A · built 2008', [forkA.coordinate, entranceA.coordinate], '004', [forkA, entranceA]),
    road(ids.spurB, 'spur B · built 2009', [forkB.coordinate, entranceB.coordinate], '005', [forkB, entranceB]),
    road(ids.bypass, 'bypass · built 2016', [west.coordinate, at(400, -350), at(1100, -350), forkB.coordinate], '006', [
      west,
      forkB,
    ]),
    road(ids.undated, 'track · date unknown', [at(0, 0), entranceA.coordinate], '007', [entranceA]),
    // A line crossing is not a junction. This road has no declared connection and is at a different level.
    road(ids.overpass, 'grade-separated road · no junction', [at(700, -200), at(700, 250)], '008', [], 1),
    {
      id: 'history-example-stream',
      name: 'Synthetic stream · classification unknown',
      kind: 'stream',
      geometry: { type: 'LineString', coordinates: [at(600, -200), at(600, 250)] },
    },
  ]
  // A draft lets existing profile/section tools open normally; it does not assert an as-built alignment.
  const draft = project.alignments[0]
  project.alignments = [
    {
      ...draft,
      name: 'Synthetic design reference · not as-built',
      points: [at(0, 0), at(400, 0), at(900, 0), at(1000, 350)].map((coordinate, index) => ({
        id: `history-example-design-${index}`,
        coordinate,
        radiusM: 0,
      })),
      vertical: [],
      overrides: [],
      engineering: undefined,
    },
  ]
  project.activeAlignmentId = draft.id

  let state = createAccessHistoryState(ACCESS_HISTORY_TRAINING_DATE)
  state.sources = [
    source(
      'example-road-log',
      'construction ledger',
      '2016-12-31',
      'Dates for mainline, spurs and bypass; not permit award dates.',
    ),
    source(
      'example-harvest-log',
      'harvest and entrance plan',
      '2011-04-01',
      'Two harvest periods and explicitly located entrances.',
    ),
    source(
      'example-crossing-register',
      'crossing register',
      '2022-07-01',
      'Bridge and culvert identities, locations and reported rating.',
    ),
    source(
      'example-closure-notice',
      'bridge closure notice',
      '2019-01-01',
      'Bridge closed from 2019; conflicts with the later inventory rating.',
    ),
    source(
      'example-haul-ledger',
      'haul ledger',
      '2010-07-01',
      'Invented route-specific evidence a reviewer can use to demonstrate a documented-use assertion.',
    ),
  ]
  const construction: Record<string, string> = {
    [ids.west]: '1988-06-01',
    [ids.crossing]: '1988-06-01',
    [ids.east]: '1988-06-01',
    [ids.spurA]: '2008-08-01',
    [ids.spurB]: '2009-08-01',
    [ids.bypass]: '2016-07-01',
    [ids.overpass]: '1988-06-01',
  }
  state.events = project.context.flatMap((feature) =>
    construction[feature.id]
      ? [
          {
            id: `constructed-${feature.id}`,
            roadId: feature.id,
            kind: 'constructed' as const,
            when: exact(construction[feature.id]),
            observedOn: '2016-12-31',
            sourceIds: ['example-road-log'],
            geometryFingerprint: roadGeometryFingerprint(feature),
          },
        ]
      : [],
  )
  state.anchors = [
    {
      id: ids.entranceA,
      name: 'Synthetic block A entrance',
      role: 'entrance',
      coordinate: entranceA.coordinate,
      roadId: ids.spurA,
      blockId: ids.blockA,
      sourceIds: ['example-harvest-log'],
    },
    {
      id: ids.entranceB,
      name: 'Synthetic block B entrance',
      role: 'entrance',
      coordinate: entranceB.coordinate,
      roadId: ids.spurB,
      blockId: ids.blockB,
      sourceIds: ['example-harvest-log'],
    },
    {
      id: ids.outlet,
      name: 'Synthetic established-network outlet',
      role: 'outlet',
      coordinate: at(0, 0),
      roadId: ids.west,
      blockId: null,
      sourceIds: ['example-road-log'],
    },
  ]
  state.structures = [
    {
      id: ids.bridge,
      name: 'Synthetic shared bridge · closed in 2019',
      kind: 'bridge',
      coordinate: at(600, 0),
      sourceIds: ['example-crossing-register', 'example-closure-notice'],
      crossingSiteId: 'SYNTHETIC-SITE-01',
      structureId: 'SYNTHETIC-BRIDGE-01',
      sourceRowId: 'SYNTHETIC-ROW-01',
      roadId: ids.crossing,
      roadKey: { forestFileId: '009900', roadSectionId: '002' },
      attachment: 'reviewed',
      attachmentToleranceM: 5,
      construction: exact('1988-06-01'),
      removal: null,
      evidence: [
        {
          id: 'example-rating-original',
          kind: 'load-rating',
          sourceIds: ['example-crossing-register'],
          validFrom: '1988-06-01',
          validUntil: '2018-12-31',
          ratedLoadTonnes: 60,
          description: 'Invented historical rating; not a vehicle authorization.',
        },
        {
          id: 'example-closure',
          kind: 'closure',
          sourceIds: ['example-closure-notice'],
          validFrom: '2019-01-01',
          validUntil: null,
          ratedLoadTonnes: null,
          description: 'Invented closure effective 2019-01-01.',
        },
        {
          id: 'example-rating-inventory',
          kind: 'load-rating',
          sourceIds: ['example-crossing-register'],
          validFrom: '2022-07-01',
          validUntil: null,
          ratedLoadTonnes: 60,
          description: 'Invented inventory still lists 60 t; conflict remains visible.',
        },
        {
          id: 'example-rating-notice',
          kind: 'load-rating',
          sourceIds: ['example-closure-notice'],
          validFrom: '2019-01-01',
          validUntil: null,
          ratedLoadTonnes: 0,
          description: 'Invented closure notice lists zero tonnes.',
        },
      ],
    },
    {
      id: ids.culvert,
      name: 'Synthetic spur B culvert',
      kind: 'culvert',
      coordinate: at(1250, 100),
      sourceIds: ['example-crossing-register'],
      crossingSiteId: 'SYNTHETIC-SITE-02',
      structureId: 'SYNTHETIC-CULVERT-01',
      sourceRowId: 'SYNTHETIC-ROW-02',
      roadId: ids.spurB,
      roadKey: { forestFileId: '009900', roadSectionId: '005' },
      attachment: 'reviewed',
      attachmentToleranceM: 5,
      construction: exact('2009-08-01'),
      removal: null,
      evidence: [],
    },
  ]
  for (const blockId of [ids.blockA, ids.blockB]) {
    state = mergeHistoricalTrace(state, traceHistoricalAccess({ context: project.context, state, blockId }))
  }
  state.selectedPathId = state.paths.find((path) => path.blockId === ids.blockA)?.id ?? null
  project.accessHistory = state
  return project
}
