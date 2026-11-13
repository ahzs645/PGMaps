import { describe, expect, it } from 'vitest'
import external from './external.generated.json'
import type { EvidenceRecord } from './costEvidence'
import { applyAdoption, createAdoption } from './rateAdoption'
import { analyzeRoad } from '../engine'
import { parseProject, projectReportHtml, serializeProject } from '../project'
import { describeProjectChange } from '../projectChangeLabel'
import { createDemoProject, demoTerrain } from '../terrain'

const baseCourse = (external.records as EvidenceRecord[]).find((item) => item.id === 'alberta-upa-2026-3')!
const adoption = createAdoption(
  {
    record: baseCourse,
    rateKey: 'surfacingRate',
    rate: 74,
    reason: '2.2 t per compacted m³ <pit report>',
    specificationConfirmed: true,
  },
  '2026-11-12',
)

describe('an adopted rate in the project', () => {
  it('leaves a project without one unchanged', () => {
    const project = createDemoProject()
    const restored = parseProject(JSON.parse(serializeProject(project)))
    expect('rateEvidence' in restored).toBe(false)
    expect(restored.settings).toEqual(project.settings)
    const active = project.alignments.find((a) => a.id === project.activeAlignmentId)!
    expect(projectReportHtml(project, analyzeRoad(active, demoTerrain, project.settings))).not.toContain('Rate sources')
  })

  it('keeps the observation in the project file and prints it under the cost assumptions', () => {
    const base = createDemoProject()
    const project = { ...base, ...applyAdoption(base, 'surfacingRate', adoption) }
    expect(describeProjectChange(base, project)).toMatch(/Design settings/)
    expect(describeProjectChange(base, project)).toMatch(/Rate sources/)
    const restored = parseProject(JSON.parse(serializeProject(project)))
    expect(restored.settings.surfacingRate).toBe(74)
    expect(restored.rateEvidence).toEqual({ surfacingRate: adoption })

    const active = project.alignments.find((a) => a.id === project.activeAlignmentId)!
    const report = projectReportHtml(project, analyzeRoad(active, demoTerrain, project.settings))
    expect(report).toMatch(/surfacing \$74(\.0+)?\/m³/)
    expect(report).toContain('<dt>Rate sources</dt>')
    expect(report).toContain('Surfacing rate $74.00/m³ adopted 2026-11-12 from $33.70/tonne · CAD · 2026')
    expect(report).toContain('Tender average · Granular Base Course — Des.2 Cl.25 · Alberta tender averages')
    expect(report).toContain(`<a href="${baseCourse.url}">`)
    expect(report).toContain('Adjustment: 2.2 t per compacted m³ &lt;pit report&gt;')
    expect(report).not.toContain('edited after this adoption')
  })

  it('says in the report when the rate was edited after the adoption', () => {
    const base = createDemoProject()
    const adopted = { ...base, ...applyAdoption(base, 'surfacingRate', adoption) }
    const project = { ...adopted, settings: { ...adopted.settings, surfacingRate: 80 } }
    const active = project.alignments.find((a) => a.id === project.activeAlignmentId)!
    expect(projectReportHtml(project, analyzeRoad(active, demoTerrain, project.settings))).toContain(
      'The rate is now $80.00/m³, edited after this adoption',
    )
  })

  it('refuses a project file whose rate source could not have been adopted', () => {
    const base = createDemoProject()
    const stored = JSON.parse(serializeProject({ ...base, ...applyAdoption(base, 'surfacingRate', adoption) }))
    stored.rateEvidence.surfacingRate.observation.kind = 'municipal-fee'
    expect(() => parseProject(stored)).toThrow(/cannot inform a rate/)
  })
})
