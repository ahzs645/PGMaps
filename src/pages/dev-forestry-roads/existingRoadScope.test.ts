import { describe, expect, it } from 'vitest'
import { parseRoadEvidence, refreshExistingRoadFeature, unreviewedRoadEvidence } from './existingRoadEvidence'
import { parseProject, projectGeoJson, serializeProject } from './project'
import { importExistingRoads } from './existingRoads'
import { evaluateNetworkRoad, roadNetworkInputs } from './roadNetwork'
import { createFullCostTrainingProject } from './trainingFullCostScenario'
import type { ContextFeature } from './types'

function refreshedFacts(previous: ContextFeature): ContextFeature {
  return {
    ...structuredClone(previous),
    roadEvidence: {
      ...unreviewedRoadEvidence('bc-ften'),
      roadClass: 'fsr',
      sourceId: '123',
      retrievedAt: '2026-10-28T18:00:00Z',
    },
  }
}

describe('existing-road geometry review scope', () => {
  it('rejects array-coerced evidence enums before they can bypass a known manual closure', () => {
    const evidence = createFullCostTrainingProject().context[0].roadEvidence!
    expect(() => parseRoadEvidence({ ...evidence, condition: ['closed'] })).toThrow('condition')
    expect(() => parseRoadEvidence({ ...evidence, source: ['scenario'] })).toThrow('source')
    expect(() => parseRoadEvidence({ ...evidence, conditionBasis: ['field-verified'] })).toThrow('condition evidence')
    expect(() => parseRoadEvidence({ ...evidence, roadClass: ['fsr'] })).toThrow('network class')
  })
  it('refreshes unchanged catalogue geometry without upgrading or discarding the separate review evidence', () => {
    const previous = createFullCostTrainingProject().context[0]
    const facts = refreshedFacts(previous)
    const next = refreshExistingRoadFeature(facts, previous)
    expect(next.roadEvidence?.source).toBe('bc-ften')
    expect(next.roadEvidence?.condition).toBe(previous.roadEvidence?.condition)
    expect(next.roadEvidence?.conditionBasis).toBe('assumed')
    expect(next.roadEvidence?.observations).toEqual(previous.roadEvidence?.observations)
    expect(next.roadEvidence?.conditionPolicy).toEqual(previous.roadEvidence?.conditionPolicy)
    expect(next.roadEvidence?.network).toEqual(previous.roadEvidence?.network)
    expect(next.roadEvidence?.reuseAllowed).toBe(true)
    expect(next.roadEvidence?.geometryReviewRequired).not.toBe(true)
  })

  it('keeps review history but disables reused scope when a publisher changes same-ID geometry', () => {
    const project = createFullCostTrainingProject()
    const previous = project.context[0]
    const facts = refreshedFacts(previous)
    if (facts.geometry.type !== 'LineString') throw Error('Expected fixture road line')
    facts.geometry.coordinates[0][0] += 0.001
    const original = structuredClone({ previous, facts })
    const next = refreshExistingRoadFeature(facts, previous)
    expect(next.roadEvidence?.geometryReviewRequired).toBe(true)
    expect(next.roadEvidence?.reuseAllowed).toBe(false)
    expect(next.roadEvidence?.observations).toEqual(previous.roadEvidence?.observations)
    expect(next.roadEvidence?.network).toEqual(previous.roadEvidence?.network)
    expect({ previous, facts }).toEqual(original)
    project.context[0] = next
    expect(parseProject(serializeProject(project)).context[0].roadEvidence?.geometryReviewRequired).toBe(true)
    // A later unchanged refresh cannot clear a still-pending scope review.
    expect(refreshExistingRoadFeature(facts, next).roadEvidence?.geometryReviewRequired).toBe(true)
  })

  it('requires scope review on reversal because direction, grades and station-specific evidence may change', () => {
    const previous = createFullCostTrainingProject().context[0]
    const facts = refreshedFacts(previous)
    if (facts.geometry.type !== 'LineString') throw Error('Expected fixture road line')
    facts.geometry.coordinates.reverse()
    expect(refreshExistingRoadFeature(facts, previous).roadEvidence?.geometryReviewRequired).toBe(true)
  })

  it('rejects invalid persisted scope markers and cannot unlock the graph merely by toggling reuse', () => {
    const project = createFullCostTrainingProject()
    const road = project.context[0]
    const evidence = { ...road.roadEvidence!, geometryReviewRequired: true, reuseAllowed: false }
    expect(() => parseRoadEvidence({ ...evidence, geometryReviewRequired: 'true' })).toThrow('true or false')
    expect(() => parseRoadEvidence({ ...evidence, reuseAllowed: true })).toThrow('geometry scope')
    // Even a direct caller bypassing project-file validation cannot use an unresolved scope.
    const input = roadNetworkInputs([{ ...road, roadEvidence: { ...evidence, reuseAllowed: true } }])[0]
    const blocked = evaluateNetworkRoad(input, project.totalCostPlanning!.networkPolicy)
    expect(blocked.eligible).toBe(false)
    expect(blocked.reasons.some((reason) => reason.toLowerCase().includes('geometry'))).toBe(true)
    const confirmed = { ...evidence, geometryReviewRequired: false, reuseAllowed: false }
    expect(parseRoadEvidence(confirmed).reuseAllowed).toBe(false)
    input.evidence = { ...confirmed, reuseAllowed: true }
    expect(evaluateNetworkRoad(input, project.totalCostPlanning!.networkPolicy).eligible).toBe(true)
  })

  it('retains an expired unresolved closure through project JSON and road GeoJSON without upgrading manual condition', () => {
    const project = createFullCostTrainingProject()
    const evidence = project.context[0].roadEvidence!
    evidence.observations!.push({
      id: 'historical-unresolved-closure',
      source: 'inspection',
      component: 'overall',
      observedAt: '2020-01-01',
      finding: 'closed',
      sourceUrl: 'https://example.invalid/old-closure',
      notes: 'Synthetic closure evidence with no explicit reopening record.',
      review: { reviewer: 'Synthetic historical reviewer', reviewedAt: '2020-01-02' },
    })
    const restored = parseProject(serializeProject(project))
    const road = restored.context[0]
    const imported = importExistingRoads(
      projectGeoJson({ ...restored, alignments: [], cables: [], context: [road] }, new Map()),
    )[0]
    expect(imported.roadEvidence?.observations).toEqual(evidence.observations)
    expect(imported.roadEvidence?.conditionPolicy).toEqual(evidence.conditionPolicy)
    expect(imported.roadEvidence?.condition).toBe('serviceable')
    expect(imported.roadEvidence?.conditionBasis).toBe('assumed')
    const result = evaluateNetworkRoad(roadNetworkInputs([imported])[0], {
      ...restored.totalCostPlanning!.networkPolicy,
      requireCurrentConditionEvidence: false,
      allowUnknownCondition: true,
    })
    expect(result.eligible).toBe(false)
    expect(result.reasons.some((reason) => reason.includes('unresolved closure'))).toBe(true)
  })

  it('uses the saved planning assessment date consistently after restore without promoting tenure dates into inspections', () => {
    const project = createFullCostTrainingProject()
    const evidence = project.context[0].roadEvidence!
    evidence.constructionYear = 2002
    evidence.awardDate = '2028-01-01'
    evidence.retrievedAt = '2028-01-01T12:00:00Z'
    project.totalCostPlanning!.asOf = '2028-01-01'
    // Deliberately stale nested policy date: restoration must use the shared assessment date.
    const restored = parseProject(serializeProject(project))
    expect(restored.totalCostPlanning!.networkPolicy.asOf).toBe('2028-01-01')
    const result = evaluateNetworkRoad(
      roadNetworkInputs(restored.context)[0],
      restored.totalCostPlanning!.networkPolicy,
    )
    expect(result.eligible).toBe(false)
    expect(restored.context[0].roadEvidence!.condition).toBe('serviceable')
    expect(restored.context[0].roadEvidence!.conditionBasis).toBe('assumed')
    expect(restored.context[0].roadEvidence!.observations).toEqual(evidence.observations)
  })
})
