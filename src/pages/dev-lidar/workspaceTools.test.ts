import { describe, expect, it } from 'vitest'
import { ANALYSIS_MODES } from './analysisWorkflows'
import { LIDAR_TOOLS, resolveLidarRoute, toolPath } from './workspaceTools'

describe('focused LiDAR routes', () => {
  it('assigns every existing analysis to exactly one workspace', () => {
    const modes = LIDAR_TOOLS.flatMap((t) => t.modes)
    expect([...modes].sort()).toEqual(ANALYSIS_MODES.map((m) => m.id).sort())
    expect(new Set(modes).size).toBe(modes.length)
    for (const tool of LIDAR_TOOLS) {
      const route = resolveLidarRoute(toolPath(tool.id), '')
      expect(route.valid).toBe(true)
      expect(route.tool?.id).toBe(tool.id)
      expect(route.mode).toBe(tool.defaultMode)
      expect(route.canonical).toBe(toolPath(tool.id))
    }
  })
  it('preserves every legacy analysis link and roof inspection entry', () => {
    for (const mode of ANALYSIS_MODES) {
      const route = resolveLidarRoute('/', `?view=${mode.id}`)
      expect(route.mode).toBe(mode.id)
      const parsed = new URL(route.canonical, 'https://example.test')
      expect(resolveLidarRoute(parsed.pathname, parsed.search).canonical).toBe(route.canonical)
    }
    expect(resolveLidarRoute('/', '?view=context').tool?.id).toBe('canopy')
    expect(resolveLidarRoute('/', '?view=analysis').tool?.id).toBe('forestry')
    expect(resolveLidarRoute('/dev/lidar', '?view=inspection').canonical).toBe('/dev/lidar/buildings/?panel=roofs')
  })
  it('preserves valid comparison family links during canonical navigation', () => {
    expect(resolveLidarRoute('/dev/lidar/compare/', '?family=neural&inspect=trees').canonical).toBe(
      '/dev/lidar/compare/?family=neural&inspect=trees',
    )
    expect(resolveLidarRoute('/dev/lidar/compare/', '?family=rgb&inspect=trees').canonical).toBe(
      '/dev/lidar/compare/?family=rgb',
    )
    expect(resolveLidarRoute('/dev/lidar/compare/', '?family=neural').canonical).toBe(
      '/dev/lidar/compare/?family=neural',
    )
    expect(resolveLidarRoute('/dev/lidar/compare/', '?family=unknown').canonical).toBe('/dev/lidar/compare/')
    expect(resolveLidarRoute('/dev/lidar/trees/', '?family=neural').canonical).toBe('/dev/lidar/trees/')
  })
  it('scopes analysis parameters to the tool and rejects unknown/nested paths', () => {
    expect(resolveLidarRoute('/dev/lidar/canopy/', '?view=models').mode).toBe('canopy-height')
    expect(resolveLidarRoute('/dev/lidar/forestry/', '?view=plots').canonical).toBe('/dev/lidar/forestry/?view=plots')
    expect(resolveLidarRoute('/dev/lidar/unknown/', '').valid).toBe(false)
    expect(resolveLidarRoute('/dev/lidar/trees/anything/', '').valid).toBe(false)
    expect(resolveLidarRoute('/dev/lidar/', '').tool).toBeUndefined()
  })
})
