import { describe, expect, it } from 'vitest'
import { analyzeFullCostConnector } from './fullCostComparison'
import { fullCostExportEvidence } from './fullCostExports'
import { createFullCostRecord, isFullCostRecordCurrent } from './fullCostRecord'
import { runFullCostComparison } from './fullCostRun'
import { parseProject, projectGeoJson, projectReportHtml, serializeProject } from './project'
import { demoTerrain } from './terrain'
import { createFullCostTrainingProject, FULL_COST_TRAINING_IDS } from './trainingFullCostScenario'

async function adoptedFixture() {
  const project = parseProject(createFullCostTrainingProject())
  project.totalCostPlanning!.sources[0].notes = 'Original quote <script>alert(1)</script> & access record'
  const alignment = project.alignments[0]
  const run = await runFullCostComparison(project, demoTerrain)
  const result = run.comparison.candidates.find((candidate) => candidate.id === alignment.id)!
  alignment.fullCostRecord = createFullCostRecord(alignment, project, result)
  const restored = parseProject(serializeProject(project))
  const analysis = analyzeFullCostConnector(alignment, demoTerrain, project.settings, project.context)
  return { project: restored, alignment: restored.alignments[0], analysis }
}

describe('complete-access report and interchange evidence', () => {
  it('round-trips an adopted comparison and exports its cost separately from the engineering estimate', async () => {
    const { project, alignment, analysis } = await adoptedFixture()
    expect(isFullCostRecordCurrent(alignment, project)).toBe(true)
    const geojson = projectGeoJson(project, new Map([[alignment.id, analysis]]))
    const properties = geojson.features.find((feature) => feature.id === alignment.id)!.properties!
    expect(properties.covered_construction_estimate_cad).toBe(analysis.estimatedCost)
    expect(properties.complete_access_cost_cad).toBe(alignment.fullCostRecord!.totalCost)
    expect(properties.complete_access_cost_cad).not.toBe(properties.covered_construction_estimate_cad)
    expect(properties.complete_access_cost_status).toBe('current')
    expect(properties.complete_access_cost_as_of).toBe('2026-10-28')
    const evidence = fullCostExportEvidence(alignment, project)!
    expect(properties.complete_access_cost).toEqual(evidence)
    expect(evidence).not.toHaveProperty('inputSignature')
    expect(evidence.accessPath.edgeIds.length).toBeGreaterThan(0)
    expect(evidence.accessReturnPath.edgeIds.length).toBeGreaterThan(0)
    expect(evidence.allocations[0].returnPath).toBeDefined()
    expect(
      evidence.reviewedInputs.context.find((road) => road.id === FULL_COST_TRAINING_IDS.armA)?.roadEvidence
        ?.observations?.[0].observedAt,
    ).toBe('2026-10-27')
    const report = projectReportHtml(project, analysis)
    expect(report).toContain('Covered construction estimate')
    expect(report).toContain('Complete access cost · saved comparison')
    expect(report).toContain('Inputs match saved comparison')
    expect(report).toContain('Engineering cost breakdown')
    expect(report).toContain('empty return network path')
    expect(report).toContain('2026-10-27')
  })

  it('labels old totals stale while preserving the adoption-time quotes and dated evidence safely in HTML', async () => {
    const { project, alignment, analysis } = await adoptedFixture()
    const recordedCost = alignment.fullCostRecord!.totalCost
    project.totalCostPlanning!.sources[0].notes = 'Later quote'
    project.totalCostPlanning!.sources[0].acquisitionRate = 99
    project.context.find((road) => road.id === FULL_COST_TRAINING_IDS.armA)!.roadEvidence!.observations![0].observedAt =
      '2027-01-01'
    const evidence = fullCostExportEvidence(alignment, project)!
    expect(evidence.inputStatus).toBe('stale')
    expect(evidence.totalCost).toBe(recordedCost)
    expect(evidence.reviewedInputs.totalCostPlanning!.sources[0].acquisitionRate).toBe(0)
    expect(evidence.reviewedInputs.totalCostPlanning!.sources[0].notes).toContain('Original quote')
    const report = projectReportHtml(project, analysis)
    expect(report).toContain('STALE — inputs changed; recalculate')
    expect(report).toContain('Original quote &lt;script&gt;alert(1)&lt;/script&gt; &amp; access record')
    expect(report).not.toContain('<script>')
    expect(report).toContain('2026-10-27')
    const properties = projectGeoJson(project, new Map([[alignment.id, analysis]])).features.find(
      (feature) => feature.id === alignment.id,
    )!.properties!
    expect(properties.complete_access_cost_status).toBe('stale')
    expect(properties.complete_access_cost_cad).toBe(recordedCost)
  })
})
