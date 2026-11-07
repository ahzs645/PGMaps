import { describe, expect, it } from 'vitest'
import { analyzeRoad } from './engine'
import { projectReportHtml, parseProject, serializeProject } from './project'
import { createDemoProject, demoTerrain } from './terrain'
import { streamRegisterCsv } from './streamReports'
import { EMPTY_STREAM_ASSESSMENT } from './streamClass'

describe('stream reports', () => {
  it('reports saved evidence, distinct class decisions, unknown widths and source completeness honestly', () => {
    const p = createDemoProject()
    p.context[0].streamAssessment = {
      ...EMPTY_STREAM_ASSESSMENT,
      channelWidthM: 6,
      fish: 'present',
      importedClass: 'S6',
      reviewedClass: 'S3',
      reviewedFingerprint: 'old',
      assessor: '<img src=x onerror=alert(1)>',
      notes: '<script>danger()</script>',
    }
    const project = parseProject(serializeProject(p))
    const analysis = analyzeRoad(project.alignments[0], demoTerrain, project.settings, project.context)
    const report = projectReportHtml(project, analysis)
    expect(report).toContain('Streams and riparian assessment')
    expect(report).toContain('Needs review')
    expect(report).toContain('S6')
    expect(report).toContain('S2')
    expect(report).toContain('S3')
    expect(report).toContain('No complete provincial stream query is retained')
    expect(report).toContain('&lt;script&gt;danger()&lt;/script&gt;')
    expect(report).not.toContain('<img src=x onerror=alert(1)>')
    expect(report).toContain('slope distance from the channel bank')
  })

  it('exports one stream row with each road crossing and guards spreadsheet formulas in user text', () => {
    const p = createDemoProject()
    p.context[0].name = '=HYPERLINK("https://example.invalid","x")'
    const analyses = new Map(p.alignments.map((a) => [a.id, analyzeRoad(a, demoTerrain, p.settings, p.context)]))
    const output = streamRegisterCsv(p, analyses)
    expect(output).toContain('"\'=HYPERLINK(')
    expect(output).toContain('demo-main@')
    expect(output).toContain('demo-contour@')
    expect(output).toContain('"Unassessed"')
    expect(output).toContain('"Unresolved"')
    expect(output.trim().split('\r\n')).toHaveLength(2)
  })
})
