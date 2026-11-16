import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fromArrayBuffer } from 'geotiff'
import { safeAnalyzeRoad } from '../analysisResult'
import { projectReadiness, readinessParts } from '../readiness'
import { createDemoProject, demoTerrain } from '../terrain'
import type { Alignment, RoadProject } from '../types'
import { roadLesson } from './roadLessons'

/**
 * Every number a lesson prints, against the training project as the designer calculates it: the
 * page passes the project's context and terrain options (`useRoadWorkspace.ts`), and without them a
 * fill or a cost differs in its last digits. A change to the training road fails here rather than
 * leaving a lesson wrong.
 */
const analyse = (project: RoadProject, road: Alignment) =>
  safeAnalyzeRoad(road, demoTerrain, project.settings, project.context, {
    verticalReference: project.terrain.verticalReference,
    sharedCrossingCosts: project.sharedCrossingCosts,
    gradeStandards: project.standards,
  })
const text = async (id: string) => JSON.stringify(await roadLesson(id)!.load())
const at = (analysis: ReturnType<typeof analyse>, chainage: number) =>
  analysis.stations.find((s) => Math.abs(s.chainage - chainage) < 1e-6)!
const thousands = (value: number) => Math.round(value).toLocaleString('en-CA')
const training = () => {
  const project = createDemoProject()
  const [main, contour] = project.alignments
  return { project, main, contour }
}

describe('lesson readings', () => {
  it('open-hillside and compare-roads: the two training roads, by name and ID', async () => {
    const { main, contour } = training()
    expect([main.id, contour.id]).toEqual(['demo-main', 'demo-contour'])
    // The road selector shows the short name; Road name holds the whole one.
    expect(main.name).toBe('Hillside access · training')
    expect(await text('compare-roads')).toContain(contour.name)
  })

  it('compare-roads: lengths and steepest grades', async () => {
    const { project, main, contour } = training()
    const [a, b] = [analyse(project, main), analyse(project, contour)]
    const lesson = await text('compare-roads')
    expect(lesson).toContain(`${thousands(b.length)} m against ${thousands(a.length)} m`)
    const grade = (value: number) => Number(value.toFixed(1))
    expect(lesson).toContain(`${grade(b.maxGradePercent)}% against ${grade(a.maxGradePercent)}%`)
    expect([a.crossingEstimate?.complete, b.crossingEstimate?.complete]).toEqual([false, false])
  })

  it('sketch-road: the new road takes the next number', async () => {
    const { project } = training()
    expect(await text('sketch-road')).toContain(`Sketched road ${project.alignments.length + 1}`)
  })

  it('vertical-profile: PVI 1 shows 688, and raised to 688.1 the formation moves while the ground stays', async () => {
    const { project, main } = training()
    expect(Number(main.vertical[0].elevation.toFixed(6))).toBe(688)
    const raised = { ...main, vertical: main.vertical.map((v, i) => (i === 0 ? { ...v, elevation: 688.1 } : v)) }
    const start = at(analyse(project, raised), 0)
    const lesson = await text('vertical-profile')
    expect(lesson).toContain(`Fmn Z in the cross-section now reads ${start.designElevation!.toFixed(2)} m`)
    expect(lesson).toContain(`Grd Z stays ${start.groundElevation!.toFixed(2)} m`)
  })

  it('road-section: a 4 m left half-width reads 4.0 / 3.0 at 0+000', async () => {
    const { project, main } = training()
    expect(main.template.leftWidth).toBe(3)
    const start = at(analyse(project, { ...main, template: { ...main.template, leftWidth: 4 } }), 0)
    expect(await text('road-section')).toContain(
      `Width L/R reads ${start.leftWidth.toFixed(1)} / ${start.rightWidth.toFixed(1)}`,
    )
  })

  it('quantities-cost: cut, fill, coverage and the base estimate', async () => {
    const { project, main } = training()
    const analysis = analyse(project, main)
    const lesson = await text('quantities-cost')
    expect(lesson).toContain(`${thousands(analysis.cutVolumeM3)} m³ of cut`)
    expect(lesson).toContain(`${thousands(analysis.fillVolumeM3)} m³ of fill`)
    expect(lesson).toContain(`Complete sections, ${Math.round((100 * analysis.completeLength) / analysis.length)}%`)
    const cost = analysis.estimatedCost.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    expect(lesson).toContain(`$${cost}`)
  })

  it('stream-crossing: the detected crossing of Synthetic drainage', async () => {
    const { project, main } = training()
    const crossing = analyse(project, main).crossings.find((item) => item.name === 'Synthetic drainage')!
    expect(crossing).toBeTruthy()
    expect(await text('stream-crossing')).toContain(`Synthetic drainage at ${crossing.chainage.toFixed(1)} m`)
  })

  it('review-design: the counts, the fill shortfall and the design limits', async () => {
    const { project, main } = training()
    const { rows } = projectReadiness(project, main, analyse(project, main), { drainageStale: false, vehicle: null })
    const attention = readinessParts(rows).attention
    const limits = attention.filter((row) => row.severity === 'limit')
    const lesson = await text('review-design')
    expect(lesson).toContain(`${limits.length} outside a limit and ${attention.length - limits.length} to do`)
    const short = /Fill is short by ([\d,]+) m³/.exec(rows.find((row) => row.id === 'earthwork-balance')!.result)![1]
    expect(lesson).toContain(`${short} m³ short`)
    expect(rows.find((row) => row.id === 'standards')?.action).toBeTruthy()
    expect(lesson).toContain(`Grade limit (%) is ${project.settings.maxGradePercent}`)
    expect(lesson).toContain(`Minimum radius (m) is ${project.settings.minRadius}`)
  })

  it('terrain: the sample is 20 m cells in EPSG:32610', async () => {
    const bytes = readFileSync(new URL('../../../../public/help/terrain/training-slope.tif', import.meta.url))
    const tiff = await fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length))
    const image = await tiff.getImage()
    const [x, y] = image.getResolution()
    const epsg = image.getGeoKeys().ProjectedCSTypeGeoKey
    expect([x, Math.abs(y), epsg]).toEqual([20, 20, 32610])
    expect(await text('terrain')).toContain(`${x} m cells in EPSG:${epsg}`)
  })

  it('import-line: the sample line is named Training spur', async () => {
    const file = JSON.parse(
      readFileSync(new URL('../../../../public/help/import-line/training-spur.geojson', import.meta.url), 'utf8'),
    )
    const name = file.features?.[0]?.properties?.name ?? file.properties?.name
    expect(name).toBe('Training spur')
    expect(await text('import-line')).toContain(`reads ${name}`)
  })
})
