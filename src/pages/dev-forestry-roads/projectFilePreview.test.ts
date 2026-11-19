import { describe, expect, it } from 'vitest'
import { createDemoProject } from './terrain'
import { projectFilePreviewHtml, projectFileRows } from './projectFilePreview'

describe('projectFilePreview', () => {
  it('counts what the project holds without its text', () => {
    const project = createDemoProject()
    const rows = projectFileRows(project)
    expect(rows[0].label).toBe('Roads')
    expect(rows[0].value).toContain(project.alignments[0].name)
    expect(rows.find((row) => row.label === 'Terrain')?.value).toContain(project.terrain.name)
    // A part the project does not hold is left out, never printed as none.
    if (!project.notes?.length) expect(rows.some((row) => row.label === 'Map notes')).toBe(false)
    const html = projectFilePreviewHtml(project, 'Job.road.json')
    expect(html).toContain('Job.road.json')
    expect(html).not.toContain('pgmaps-road-project-v1')
  })

  it('states a stored grid by its size', () => {
    const project = createDemoProject()
    const raster = {
      id: 'g',
      name: 'Grid',
      kind: 'terrain' as const,
      epsg: 3005,
      origin: [0, 0] as [number, number],
      pixelSize: [1, -1] as [number, number],
      width: 1200,
      height: 800,
      values: [],
      acquired: '2026-11-18',
      verticalReference: 'CGVD2013',
      sha256: '',
    }
    const rows = projectFileRows({ ...project, terrain: { ...project.terrain, raster } })
    expect(rows.find((row) => row.label === 'Terrain')?.value).toContain('1,200 × 800 cells stored in the file')
  })
})
