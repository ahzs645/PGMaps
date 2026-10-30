import { describe, expect, it } from 'vitest'
import { createSurfacingSupply, deliveredSurfacingRate, surfacingSupplyCost } from './gravel'
import { parseEngineering } from './engineeringProject'
import { createEngineeringDesign } from './engineeringTypes'
import { analyzeRoad } from './engine'
import { createDemoProject, demoTerrain } from './terrain'
import { parseProject, projectReportHtml, serializeProject } from './project'

describe('surfacing aggregate scenarios', () => {
  it('preserves source inputs in project JSON and escapes source evidence in reports', () => {
    const project = createDemoProject()
    const alignment = project.alignments.find((a) => a.id === project.activeAlignmentId)!
    alignment.engineering ??= createEngineeringDesign()
    alignment.engineering.surfacingSupply = {
      ...createSurfacingSupply(),
      enabled: true,
      sourceNotes: '<script>source</script>',
      name: 'Pit <A>',
    }
    const restored = parseProject(serializeProject(project))
    expect(restored.alignments.find((a) => a.id === project.activeAlignmentId)!.engineering!.surfacingSupply).toEqual(
      alignment.engineering.surfacingSupply,
    )
    const report = projectReportHtml(project, analyzeRoad(alignment, demoTerrain, project.settings))
    expect(report).toContain('Pit &lt;A&gt;')
    expect(report).toContain('&lt;script&gt;source&lt;/script&gt;')
    expect(report).not.toContain('<script>source</script>')
  })
  it('keeps loading, processing, haul and placement when acquisition is free', () => {
    const source = {
      ...createSurfacingSupply(),
      enabled: true,
      processingRate: 3,
      loadingRate: 2,
      haulDistanceKm: 4,
      haulRate: 1.5,
      placementRate: 5,
      capacityM3: 60,
    }
    expect(deliveredSurfacingRate(source)).toBe(16)
    expect(surfacingSupplyCost(100, 25, source)).toEqual({ suppliedM3: 60, fallbackM3: 40, rate: 16, cost: 1960 })
    expect(surfacingSupplyCost(100, 25, { ...source, enabled: false }).cost).toBe(2500)
    expect(surfacingSupplyCost(100, 25, { ...source, capacityM3: 0 }).cost).toBe(2500)
  })

  it('round-trips enabled states, source notes and compacted supply inputs; rejects invalid flags', () => {
    const engineering = {
      ...createEngineeringDesign(),
      haul: { ...createEngineeringDesign().haul, siteSelection: 'delivered-cost' as const },
      sites: [
        {
          id: 'source',
          name: 'Source',
          kind: 'borrow' as const,
          enabled: false,
          sourceNotes: 'Supplier confirmed access; grading pending.',
          chainage: 0,
          accessDistanceM: 500,
          capacityM3: 100,
          unitRate: 0,
          fixedCost: 10,
        },
      ],
      surfacingSupply: { ...createSurfacingSupply(), enabled: true },
    }
    expect(
      parseEngineering(JSON.parse(JSON.stringify(engineering)), () => {
        throw Error('No templates')
      }),
    ).toEqual(engineering)
    expect(() =>
      parseEngineering({ ...engineering, sites: [{ ...engineering.sites[0], enabled: 'yes' }] }, () => {
        throw Error('No templates')
      }),
    ).toThrow(/enabled must be a boolean/)
    expect(() =>
      parseEngineering(
        { ...engineering, surfacingSupply: { ...engineering.surfacingSupply, haulDistanceKm: -1 } },
        () => {
          throw Error('No templates')
        },
      ),
    ).toThrow(/haul distance/)
  })
})
