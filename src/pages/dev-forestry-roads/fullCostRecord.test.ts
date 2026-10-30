import { describe, expect, it } from 'vitest'
import { createDemoProject } from './terrain'
import { createTotalCostPlanningDefaults } from './fullCostPlanning'
import {
  createFullCostRecord,
  fullCostInputSignature,
  isFullCostRecordCurrent,
  parseFullCostRecord,
  MAX_FULL_COST_SIGNATURE_BYTES,
  FULL_COST_MODEL_VERSION,
  type FullCostReviewRecord,
} from './fullCostRecord'
import type { FullCostCandidateResult } from './fullCostComparison'
import type { Alignment, RoadProject } from './types'

function fixture() {
  const project = { ...createDemoProject(), totalCostPlanning: createTotalCostPlanningDefaults('2026-10-28') }
  const alignment = project.alignments[0]
  const path: NonNullable<FullCostCandidateResult['accessPath']> = {
    coordinates: [
      [-122.72, 53.89],
      [-122.72, 53.891],
    ],
    edgeIds: ['edge-a'],
    roadIds: ['fsr-a'],
    lengthM: 100,
    distanceM: 100,
    weightedLengthM: 100,
    reusedLengthM: 100,
    junctionGapM: 0,
    attachmentDistanceM: 0,
    haulCost: 0,
    rehabilitationCost: 0,
    accessCost: 0,
    structureCost: 0,
    fixedCost: 0,
    totalCost: 0,
    cost: 0,
    costItems: [],
    costItemIds: [],
    costGroupIds: [],
    warnings: [],
  }
  const result: FullCostCandidateResult = {
    id: 'candidate-a',
    name: 'Reviewed connector A',
    status: 'feasible',
    totalCost: 110,
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
      contingency: 10,
      total: 110,
    },
    allocations: [],
    demands: [],
    blockers: [],
    warnings: ['Entered planning rates.'],
    networkCostItems: [],
    accessPath: path,
    accessReturnPath: path,
  }
  return { project, alignment, result }
}

const attach = (alignment: Alignment, record: FullCostReviewRecord) => ({ ...alignment, fullCostRecord: record })

describe('saved complete-access cost snapshots', () => {
  it('round-trips a checked ledger and its source path while canonical object key order is irrelevant', () => {
    const { project, alignment, result } = fixture()
    const record = createFullCostRecord(alignment, project, result)
    expect(parseFullCostRecord(JSON.parse(JSON.stringify(record)))).toEqual(record)
    expect(record.accessPath.edgeIds).toEqual(['edge-a'])
    const reordered = Object.fromEntries(Object.entries(project).reverse()) as unknown as typeof project
    expect(fullCostInputSignature(alignment, reordered)).toBe(record.inputSignature)
    expect(isFullCostRecordCurrent(attach(alignment, record), reordered)).toBe(true)
    expect(JSON.parse(record.inputSignature).modelVersion).toBe(FULL_COST_MODEL_VERSION)
    const olderInputs = JSON.parse(record.inputSignature)
    olderInputs.modelVersion = 'connected-access-previous-model'
    const older = parseFullCostRecord({ ...record, inputSignature: JSON.stringify(olderInputs) })
    expect(isFullCostRecordCurrent(attach(alignment, older), project)).toBe(false)
    delete olderInputs.modelVersion
    const legacy = parseFullCostRecord({ ...record, inputSignature: JSON.stringify(olderInputs) })
    expect(isFullCostRecordCurrent(attach(alignment, legacy), project)).toBe(false)
  })

  it('adoption and switching active roads do not stale the saved inputs; price, date, context and geometry edits do', () => {
    const { project, alignment, result } = fixture()
    const record = createFullCostRecord(alignment, project, result)
    const adopted = attach(alignment, record)
    expect(
      isFullCostRecordCurrent(adopted, {
        ...project,
        alignments: [...project.alignments, adopted],
        activeAlignmentId: adopted.id,
      }),
    ).toBe(true)
    expect(isFullCostRecordCurrent(adopted, { ...project, activeAlignmentId: project.alignments[1].id })).toBe(true)
    expect(isFullCostRecordCurrent(adopted, { ...project, settings: { ...project.settings, cutRate: 500 } })).toBe(
      false,
    )
    expect(
      isFullCostRecordCurrent(adopted, {
        ...project,
        totalCostPlanning: { ...project.totalCostPlanning, asOf: '2027-10-28' },
      }),
    ).toBe(false)
    expect(isFullCostRecordCurrent(adopted, { ...project, context: [...project.context].reverse() })).toBe(false)
    expect(
      isFullCostRecordCurrent(
        {
          ...adopted,
          points: adopted.points.map((point, index) => (index ? point : { ...point, coordinate: [-122.721, 53.89] })),
        },
        project,
      ),
    ).toBe(false)
  })

  it('preserves different loaded and empty-return paths and their separate source costs', () => {
    const { project, alignment, result } = fixture()
    const path = result.accessPath!
    const allocation = {
      sourceId: 'source-1',
      sourceName: 'Entered pit',
      use: 'surfacing' as const,
      volumeBasis: 'compacted' as const,
      volumeM3: 50,
      unitMaterialRate: 2,
      materialCost: 100,
      networkDistanceM: 1000,
      networkHaulCost: 30,
      returnNetworkDistanceM: 1500,
      returnNetworkHaulCost: 45,
      connectorHaulM3Km: 2.5,
      connectorHaulCost: 5,
      returnConnectorHaulCost: 7.5,
      sourcePreparationCost: 10,
      path: { ...path, edgeIds: ['loaded-edge'], lengthM: 1000, weightedLengthM: 1000, totalCost: 30 },
      returnPath: { ...path, edgeIds: ['return-edge'], lengthM: 1500, weightedLengthM: 1500, totalCost: 45 },
    }
    const record = createFullCostRecord(alignment, project, {
      ...result,
      totalCost: 327.25,
      allocations: [allocation],
      ledger: {
        ...result.ledger!,
        sourceMaterials: 100,
        sourcePreparation: 10,
        supplyNetworkHaul: 75,
        supplyConnectorHaul: 12.5,
        subtotal: 297.5,
        contingency: 29.75,
        total: 327.25,
      },
    })
    const reopened = parseFullCostRecord(JSON.parse(JSON.stringify(record)))
    expect(() =>
      parseFullCostRecord({ ...record, allocations: [{ ...record.allocations[0], use: ['surfacing'] }] }),
    ).toThrow(/material use or volume basis/)
    expect(() =>
      parseFullCostRecord({
        ...record,
        networkCostItems: [{ id: 'rehab', kind: ['rehabilitation'], amount: 0, label: 'Rehab', roadId: 'fsr-a' }],
      }),
    ).toThrow(/network cost kind/)
    expect(reopened.allocations[0].path.edgeIds).toEqual(['loaded-edge'])
    expect(reopened.allocations[0].returnPath.edgeIds).toEqual(['return-edge'])
    expect(reopened.allocations[0].returnNetworkDistanceM).toBe(1500)
    expect(reopened.allocations[0].returnNetworkHaulCost).toBe(45)
    expect(reopened.accessReturnPath.edgeIds).toEqual(['edge-a'])
  })

  it('retains terrain checksum and raster metadata without embedding all raster values in the signature', () => {
    const { project, alignment } = fixture()
    const rasterProject = {
      ...project,
      terrain: {
        ...project.terrain,
        sha256: 'a'.repeat(64),
        raster: {
          id: 'raster-a',
          name: 'Fixture',
          kind: 'terrain' as const,
          epsg: 4326,
          origin: [-122.73, 53.9] as [number, number],
          pixelSize: [0.001, -0.001] as [number, number],
          width: 2,
          height: 2,
          values: [100, 101, 102, 103],
          acquired: '2026-10-01',
          verticalReference: 'Synthetic fixture metres',
          sha256: 'a'.repeat(64),
        },
      },
    }
    const signature = fullCostInputSignature(alignment, rasterProject)
    expect(signature).not.toContain('"values"')
    expect(
      fullCostInputSignature(alignment, {
        ...rasterProject,
        terrain: { ...rasterProject.terrain, sha256: 'b'.repeat(64) },
      }),
    ).not.toBe(signature)
    expect(
      fullCostInputSignature(alignment, {
        ...rasterProject,
        terrain: { ...rasterProject.terrain, raster: { ...rasterProject.terrain.raster, pixelSize: [0.002, -0.001] } },
      }),
    ).not.toBe(signature)
  })

  it('rejects infeasible adoption, contradictory totals and dates, and over-budget input records', () => {
    const { project, alignment, result } = fixture()
    expect(() =>
      createFullCostRecord(alignment, project, { ...result, status: 'infeasible', totalCost: null }),
    ).toThrow(/feasible/)
    const record = createFullCostRecord(alignment, project, result)
    expect(() => parseFullCostRecord({ ...record, totalCost: 999 })).toThrow(/sum/)
    expect(() => parseFullCostRecord({ ...record, asOf: '2026-10-29' })).toThrow(/assessment date/)
    const oversized = {
      ...project,
      context: [{ name: 'x'.repeat(MAX_FULL_COST_SIGNATURE_BYTES) }],
    } as unknown as RoadProject
    expect(() => fullCostInputSignature(alignment, oversized)).toThrow(/8 MiB/)
  })
})
