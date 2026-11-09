import { describe, expect, it } from 'vitest'
import {
  assessHistoricalPath,
  historicalSharedUsage,
  reviewHistoricalPath,
  traceHistoricalAccess,
} from './accessHistory'
import { historicalMapFeatures, HISTORY_UNRESOLVED_COLOR } from './accessHistoryMap'
import { parseProject, serializeProject } from './project'
import { createTrainingScenario } from './scenarios'
import { ACCESS_HISTORY_TRAINING_IDS as ids } from './trainingAccessHistoryScenario'

describe('worked historical-access project', () => {
  it('explains both 2010 blocks through a shared crossing without using the later bypass or granting present reuse', () => {
    const project = createTrainingScenario('training-access-history')
    const history = project.accessHistory!
    expect(history.paths).toHaveLength(2)
    for (const path of history.paths) {
      expect(path.relationship).toBe('inferred-access')
      expect(path.roadIds).toContain(ids.crossing)
      expect(path.roadIds).not.toContain(ids.bypass)
      expect(path.roadIds).not.toContain(ids.undated)
      expect(path.roadIds).not.toContain(ids.overpass)
      expect(path.structureIds).toContain(ids.bridge)
      expect(assessHistoricalPath(path, history, project.context)).toMatchObject({
        stale: false,
        temporalStatus: 'compatible',
        connectivity: 'stored-continuous',
      })
    }
    const shared = historicalSharedUsage(history.paths, history)
    expect(shared.uniqueStructureCount).toBe(2)
    expect(shared.summedPathRoadLengthM).toBeGreaterThan(shared.uniqueRoadLengthM)
    expect(shared.sharedRoadLengthM).toBeGreaterThan(800)
    expect(shared.constructionCost).toBeNull()
    expect(
      project.context
        .filter((feature) => feature.kind === 'existing-road')
        .every((road) => road.roadEvidence?.reuseAllowed === false),
    ).toBe(true)
  })

  it('finds a bypass after the bridge closure and retains both conflicting reports', () => {
    const project = createTrainingScenario('training-access-history')
    const state = project.accessHistory!
    const result = traceHistoricalAccess({
      context: project.context,
      state,
      blockId: ids.blockA,
      settings: { asOf: '2022-08-01' },
    })
    expect(result.paths.length).toBeGreaterThan(0)
    for (const path of result.paths) {
      expect(path.roadIds).toContain(ids.bypass)
      expect(path.structureIds).not.toContain(ids.bridge)
    }
    expect(result.structures.find((structure) => structure.structureId === ids.bridge)?.status).toBe('conflict')
    expect(
      state.structures
        .find((structure) => structure.id === ids.bridge)
        ?.evidence.map((evidence) => evidence.ratedLoadTonnes),
    ).toEqual([60, null, 60, 0])
    // The saved 2010 reconstruction remains inspectable independently of a new query date.
    expect(
      assessHistoricalPath(
        state.paths[0],
        { ...state, settings: { ...state.settings, asOf: '2022-08-01' } },
        project.context,
      ).stale,
    ).toBe(false)
  })

  it('makes unknown-time assumptions visible and cannot connect a grade-separated crossing', () => {
    const project = createTrainingScenario('training-access-history')
    const result = traceHistoricalAccess({
      context: project.context,
      state: project.accessHistory!,
      blockId: ids.blockA,
      settings: { allowUnknownTime: true },
    })
    const uncertain = result.paths.find((path) => path.roadIds.includes(ids.undated))
    expect(uncertain).toBeDefined()
    expect(uncertain!.assumptions.join(' ')).toMatch(/unknown|timing|physical/i)
    expect(result.paths.every((path) => !path.roadIds.includes(ids.overpass))).toBe(true)
  })

  it('round-trips assertions and exact road identifiers, and invalidates review after a material identifier change', () => {
    const project = createTrainingScenario('training-access-history')
    const state = project.accessHistory!
    const path = state.paths[0]
    const reviewed = reviewHistoricalPath(
      state,
      path.id,
      'documented-use',
      {
        reviewer: 'Synthetic training reviewer',
        reviewedOn: '2026-11-08',
        reference: 'Invented haul ledger, route A, page 2. Training only.',
      },
      ['example-haul-ledger'],
      project.context,
    )
    const reopened = parseProject(serializeProject({ ...project, accessHistory: reviewed }))
    expect(reopened.accessHistory).toEqual(reviewed)
    const bridgeRoad = reopened.context.find((feature) => feature.id === ids.crossing)!
    expect(bridgeRoad.roadEvidence).toMatchObject({ forestFileId: '009900', roadSectionId: '002', reuseAllowed: false })
    bridgeRoad.roadEvidence!.roadSectionId = '099'
    const assessment = assessHistoricalPath(reopened.accessHistory!.paths[0], reopened.accessHistory!, reopened.context)
    expect(assessment.stale).toBe(true)
    expect(() =>
      reviewHistoricalPath(
        reopened.accessHistory!,
        path.id,
        'documented-use',
        path.review ?? {
          reviewer: 'Reviewer',
          reviewedOn: '2026-11-08',
          reference: 'Old reference',
        },
        ['example-haul-ledger'],
        reopened.context,
      ),
    ).toThrow(/Retrace|resolve/i)
  })

  it('shows the selected saved date on the map and changes stale routes to an unresolved colour', () => {
    const project = createTrainingScenario('training-access-history')
    const state = project.accessHistory!
    state.settings.asOf = '2022-08-01'
    const map = historicalMapFeatures(project.context, state)
    expect(map.asOf).toBe('2010-06-30')
    expect(map.route.features).toHaveLength(1)
    expect(map.structures.features.find((feature) => feature.id === ids.bridge)?.properties).toMatchObject({
      status: 'compatible',
      onSelectedRoute: true,
    })
    const changed = {
      ...state,
      sources: state.sources.map((source, index) =>
        index ? source : { ...source, description: 'Changed physical evidence' },
      ),
    }
    const updated = historicalMapFeatures(project.context, changed)
    expect(updated.route.features[0].properties).toMatchObject({ status: 'stale', color: HISTORY_UNRESOLVED_COLOR })
  })
})
