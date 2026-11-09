import { describe, expect, it } from 'vitest'
import { historicalMapFeatures, HISTORY_CONFLICT_COLOR, HISTORY_UNRESOLVED_COLOR } from './accessHistoryMap'
import { ACCESS_HISTORY_TRAINING_IDS as ids, createAccessHistoryTrainingProject } from './trainingAccessHistoryScenario'

describe('historical access map assessments', () => {
  it.each(['missing', 'changed-key', 'moved'] as const)(
    'marks a structure unresolved when its named road is %s',
    (change) => {
      const project = createAccessHistoryTrainingProject()
      if (change === 'missing') project.context = project.context.filter((feature) => feature.id !== ids.crossing)
      else
        project.context = project.context.map((feature) =>
          feature.id !== ids.crossing
            ? feature
            : {
                ...feature,
                ...(change === 'changed-key'
                  ? { roadEvidence: { ...feature.roadEvidence!, roadSectionId: '099' } }
                  : {}),
                ...(change === 'moved' && feature.geometry.type === 'LineString'
                  ? {
                      geometry: {
                        ...feature.geometry,
                        coordinates: feature.geometry.coordinates.map(([longitude, latitude]) => [
                          longitude,
                          latitude + 0.02,
                        ]),
                      },
                    }
                  : {}),
              },
        )
      const map = historicalMapFeatures(project.context, project.accessHistory)
      expect(map.route.features[0].properties?.status).toBe('stale')
      expect(map.structures.features.find((feature) => feature.id === ids.bridge)?.properties).toMatchObject({
        status: 'unresolved',
        color: HISTORY_UNRESOLVED_COLOR,
      })
      expect(map.structures.features.find((feature) => feature.id === ids.bridge)?.properties?.explanation).toMatch(
        /missing|absent|match|distance|tolerance|beyond/i,
      )
    },
  )

  it('exposes contradictory source rows for the same physical asset on every affected marker', () => {
    const project = createAccessHistoryTrainingProject()
    const history = project.accessHistory!
    const bridge = history.structures.find((structure) => structure.id === ids.bridge)!
    history.structures.push({
      ...bridge,
      id: 'example-bridge-conflicting-row',
      sourceRowId: 'SYNTHETIC-OTHER-ROW',
      evidence: [
        {
          id: 'example-bridge-conflicting-closure',
          kind: 'closure',
          sourceIds: ['example-closure-notice'],
          validFrom: '2005-01-01',
          validUntil: null,
          ratedLoadTonnes: null,
          description: 'Synthetic contradictory source row.',
        },
      ],
    })
    const map = historicalMapFeatures(project.context, history)
    for (const id of [ids.bridge, 'example-bridge-conflicting-row']) {
      expect(map.structures.features.find((feature) => feature.id === id)?.properties).toMatchObject({
        status: 'conflict',
        color: HISTORY_CONFLICT_COLOR,
      })
    }
  })

  it('assesses each marker against the selected saved route date instead of the next trace date', () => {
    const project = createAccessHistoryTrainingProject()
    project.accessHistory!.settings.asOf = '2022-08-01'
    const map = historicalMapFeatures(project.context, project.accessHistory)
    expect(map.asOf).toBe('2010-06-30')
    expect(map.structures.features.find((feature) => feature.id === ids.bridge)?.properties).toMatchObject({
      date: '2010-06-30',
      status: 'compatible',
    })
  })
})
