import { describe, expect, it } from 'vitest'
import { createEngineeringDesign } from './engineeringTypes'
import {
  activateVerticalAlternative,
  addVerticalAlternative,
  materializeVerticalAlternatives,
  parseVerticalAlternativeFields,
  removeVerticalAlternative,
  setVerticalAlternativeCostMode,
  snapshotActiveVerticalAlternative,
} from './verticalAlternatives'
import type { Alignment, RoadProject } from './types'
import { parseProject, serializeProject } from './project'
import { DEFAULT_ROAD_SETTINGS } from './terrain'
import { createRoadReportSettings } from './reportSettings'
import { fullCostInputSignature, isFullCostRecordCurrent, type FullCostReviewRecord } from './fullCostRecord'
import { createTotalCostPlanningDefaults } from './fullCostPlanning'

function road(): Alignment {
  return {
    id: 'r',
    name: 'Shared horizontal',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: [-122.8, 53.9], radiusM: 0 },
      { id: 'b', coordinate: [-122.8, 53.901], radiusM: 0 },
    ],
    vertical: [
      { id: 's', chainage: 0, elevation: 800, curveLength: 0 },
      { id: 'e', chainage: 100, elevation: 810, curveLength: 0 },
    ],
    template: {
      leftWidth: 3,
      rightWidth: 3,
      crossfallPercent: 3,
      cutSlope: 1,
      fillSlope: 1.5,
      ditchWidth: 1,
      ditchDepth: 0.5,
      surfaceDepth: 0.25,
    },
    overrides: [],
    engineering: createEngineeringDesign(),
  }
}
function projectFor(alignment: Alignment): RoadProject {
  return {
    schema: 'pgmaps-road-project-v1',
    name: 'Vertical evidence',
    activeAlignmentId: alignment.id,
    alignments: [alignment],
    settings: { ...DEFAULT_ROAD_SETTINGS },
    terrain: { kind: 'demo', name: 'Synthetic ground', resolutionM: 1, verticalReference: 'Synthetic metres' },
    context: [],
    cables: [],
    totalCostPlanning: createTotalCostPlanningDefaults('2026-10-30'),
  }
}
function reviewedCost(alignment: Alignment): FullCostReviewRecord {
  const path = {
    edgeIds: [],
    roadIds: [],
    costItemIds: [],
    lengthM: 0,
    weightedLengthM: 0,
    attachmentDistanceM: 0,
    junctionGapM: 0,
    totalCost: 0,
  }
  return {
    schema: 'pgmaps-full-cost-review-v1',
    inputSignature: fullCostInputSignature(alignment, projectFor(alignment)),
    asOf: '2026-10-30',
    candidateId: alignment.id,
    candidateName: alignment.name,
    totalCost: 100,
    allocations: [],
    accessPath: path,
    accessReturnPath: path,
    networkCostItems: [],
    warnings: [],
    ledger: {
      newConstruction: 100,
      internalMaterialHaul: 0,
      newConstructionFixed: 0,
      sourceMaterials: 0,
      sourcePreparation: 0,
      supplyNetworkHaul: 0,
      supplyConnectorHaul: 0,
      networkRehabilitation: 0,
      networkAccess: 0,
      networkStructures: 0,
      networkFixed: 0,
      subtotal: 100,
      contingency: 0,
      total: 100,
    },
  }
}
describe('named vertical alternatives', () => {
  it('retains each profile’s comparison evidence across switches/removal and JSON, without recursive signatures', () => {
    const original = road()
    const record = reviewedCost(original)
    let a = addVerticalAlternative({ ...original, fullCostRecord: record }, 'v2', 'Unreviewed profile')
    expect(a.fullCostRecord).toBeUndefined()
    expect(a.verticalAlternatives![0].fullCostRecord).toEqual(record)
    a = activateVerticalAlternative(a, 'v2-original')
    expect(a.fullCostRecord).toEqual(record)
    expect(isFullCostRecordCurrent(a, projectFor(a))).toBe(true)
    expect(fullCostInputSignature(a, projectFor(a))).toBe(record.inputSignature)
    a = activateVerticalAlternative(a, 'v2')
    a = snapshotActiveVerticalAlternative({
      ...a,
      vertical: a.vertical.map((p) => ({ ...p, elevation: p.elevation + 1 })),
    })
    a = removeVerticalAlternative(a, 'v2')
    expect(a.fullCostRecord).toEqual(record)
    expect(isFullCostRecordCurrent(a, projectFor(a))).toBe(true)
    const loaded = parseProject(JSON.parse(serializeProject(projectFor(a)))).alignments[0]
    expect(loaded.fullCostRecord).toEqual(record)
    expect(loaded.verticalAlternatives![0].fullCostRecord).toEqual(record)
    const changed = snapshotActiveVerticalAlternative({
      ...loaded,
      engineering: { ...loaded.engineering!, haul: { ...loaded.engineering!.haul, borrowRate: 21 } },
    })
    expect(changed.fullCostRecord).toEqual(record)
    expect(isFullCostRecordCurrent(changed, projectFor(changed))).toBe(false)
    expect(fullCostInputSignature(changed, projectFor(changed))).not.toContain('inputSignature')
  })
  it('keeps original and edited profiles independent while using one horizontal model', () => {
    const original = road()
    let a = addVerticalAlternative(original, 'v2', 'Low cut')
    a = snapshotActiveVerticalAlternative({
      ...a,
      vertical: a.vertical.map((p) => ({ ...p, elevation: p.elevation - 2 })),
    })
    const edited = a.vertical
    a = activateVerticalAlternative(a, 'v2-original')
    expect(a.vertical).toEqual(original.vertical)
    expect(a.points).toBe(original.points)
    expect(activateVerticalAlternative(a, 'v2').vertical).toEqual(edited)
    const movedPoints = a.points.map((p) => ({
      ...p,
      coordinate: [p.coordinate[0] + 0.001, p.coordinate[1]] as [number, number],
    }))
    const children = materializeVerticalAlternatives({ ...a, points: movedPoints })
    expect(children).toHaveLength(2)
    expect(children.every((child) => child.alignment.points === movedPoints)).toBe(true)
    expect(children.map((child) => child.alignment.vertical[0].elevation)).toEqual([800, 798])
  })
  it('saves independent engineering per profile and deliberately reunifies selected inputs', () => {
    let a = setVerticalAlternativeCostMode(road(), 'independent')
    a.engineering!.haul.borrowRate = 15
    a = snapshotActiveVerticalAlternative(a)
    a = addVerticalAlternative(a, 'v2', 'Quoted rock')
    a = snapshotActiveVerticalAlternative({
      ...a,
      engineering: { ...a.engineering!, haul: { ...a.engineering!.haul, borrowRate: 80 } },
    })
    a = activateVerticalAlternative(a, 'original-profile')
    expect(a.engineering!.haul.borrowRate).toBe(15)
    expect(activateVerticalAlternative(a, 'v2').engineering!.haul.borrowRate).toBe(80)
    a = setVerticalAlternativeCostMode(a, 'shared')
    const children = materializeVerticalAlternatives(a)
    expect(children.every((child) => child.alignment.engineering?.haul.borrowRate === 15)).toBe(true)
    expect(a.verticalAlternatives!.every((v) => v.engineering === undefined)).toBe(true)
  })
  it('keeps vertical controls local and removes an active child without corrupting its sibling', () => {
    let a = addVerticalAlternative(road(), 'v2', 'Controlled')
    a = snapshotActiveVerticalAlternative({
      ...a,
      verticalControls: [
        {
          id: 'c',
          chainage: 50,
          elevation: 805,
          toleranceAboveM: 0,
          toleranceBelowM: 0,
          gradePercent: null,
          gradeTolerancePercent: 0,
        },
      ],
    })
    expect(activateVerticalAlternative(a, 'v2-original').verticalControls).toBeUndefined()
    const reduced = removeVerticalAlternative(a, 'v2')
    expect(reduced.activeVerticalAlternativeId).toBe('v2-original')
    expect(reduced.verticalControls).toBeUndefined()
    expect(() => removeVerticalAlternative(reduced, 'v2-original')).toThrow('Keep at least one')
  })
  it('round-trips independent profiles and report settings through actual project validation', () => {
    let a = addVerticalAlternative(road(), 'v2', 'Low profile')
    a = setVerticalAlternativeCostMode(a, 'independent')
    a = {
      ...a,
      vertical: a.vertical.map((v) => ({ ...v, elevation: v.elevation - 1.25 })),
      engineering: { ...a.engineering!, haul: { ...a.engineering!.haul, borrowRate: 73 } },
    }
    const project = {
      schema: 'pgmaps-road-project-v1' as const,
      name: 'Profile comparison',
      activeAlignmentId: a.id,
      alignments: [a],
      settings: { ...DEFAULT_ROAD_SETTINGS },
      terrain: {
        kind: 'demo' as const,
        name: 'Synthetic ground',
        resolutionM: 1,
        verticalReference: 'Synthetic metres',
      },
      context: [],
      cables: [],
      reportSettings: createRoadReportSettings(),
    }
    const loaded = parseProject(JSON.parse(serializeProject(project)))
    expect(loaded.reportSettings).toEqual(project.reportSettings)
    expect(loaded.alignments[0].verticalAlternatives!.find((v) => v.id === 'v2')!.vertical[0].elevation).toBe(798.75)
    expect(activateVerticalAlternative(loaded.alignments[0], 'v2-original').vertical[0].elevation).toBe(800)
    expect(loaded.alignments[0].engineering!.haul.borrowRate).toBe(73)
    const invalid = JSON.parse(serializeProject(project))
    invalid.alignments[0].verticalAlternatives[0].vertical[0].elevation = '800'
    expect(() => parseProject(invalid)).toThrow('Design elevation')
  })
  it('validates metadata and delegates every nested child through the normal design parser', () => {
    const a = addVerticalAlternative(road(), 'v2', 'Design')
    let calls = 0
    const parseChild = (raw: Record<string, unknown>) => {
      calls++
      const vertical = raw.vertical as Alignment['vertical']
      if (!Array.isArray(vertical) || vertical.some((p) => !Number.isFinite(p.elevation)))
        throw Error('Invalid child profile')
      return { vertical }
    }
    expect(
      parseVerticalAlternativeFields(a as unknown as Record<string, unknown>, parseChild).verticalAlternatives,
    ).toHaveLength(2)
    expect(calls).toBe(2)
    expect(() => parseVerticalAlternativeFields({ ...a, activeVerticalAlternativeId: 'missing' }, parseChild)).toThrow(
      'does not exist',
    )
    expect(() =>
      parseVerticalAlternativeFields(
        { ...a, verticalAlternatives: [a.verticalAlternatives![0], a.verticalAlternatives![0]] },
        parseChild,
      ),
    ).toThrow('unique')
    expect(() =>
      parseVerticalAlternativeFields(
        { ...a, verticalAlternatives: [{ id: 'bad', name: 'Bad', vertical: [{ elevation: NaN }] }] },
        parseChild,
      ),
    ).toThrow('Invalid child profile')
    expect(() => parseVerticalAlternativeFields({ activeVerticalAlternativeId: 'orphan' }, parseChild)).toThrow(
      'alternatives list',
    )
  })
})
