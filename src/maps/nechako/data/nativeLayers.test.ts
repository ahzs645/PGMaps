import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { nativeMapfileUrl, nativeWmsResource, refreshSharedLayer, workspaceRenderOrder } from './nativeLayers'
import { nativeProjectSave } from './projectManager'
import { EMPTY_WORKSPACE, importWorkspace } from './workspace'

describe('verified native MapServer references', () => {
  it('recovers all nineteen native-src WMS references from actual anonymous payloads and retains HTTPS SLDs', () => {
    let recovered = 0
    for (const id of [4, 6, 9, 10, 12, 14, 15, 21, 27]) {
      const source = JSON.parse(
        readFileSync(`public/data/nechako-showcase/public-projects/project-${id}.json`, 'utf8'),
      ).attributes
      const workspace = importWorkspace(source)
      for (const [index, layer] of source.layers.entries()) {
        if (layer.sourceType !== 'WMS' || layer.urls?.length) continue
        const converted = workspace.layers.find((item) => item.id === `native-${index}`)!
        expect(converted).toBeDefined()
        const resource = new URL(converted.source.resource)
        expect(resource.origin + resource.pathname).toBe('https://nechakowatershed-portal.ca/cgi-bin/mapserv')
        expect(resource.searchParams.get('map')).toBe(layer.mapfile)
        expect(converted.layer.name).toBe(layer.mapfileName)
        expect(resource.searchParams.get('SLD')).toBe(layer.portalSld ?? null)
        expect(converted.visible).toBe(layer.checked)
        recovered++
      }
    }
    expect(recovered).toBe(19)
  })
  it('counts 130 usable WMS references out of131 supplied and writes reviewed refreshed native mapfile/SLD references correctly', () => {
    let supplied = 0,
      usable = 0
    for (const id of [4, 6, 9, 10, 12, 14, 15, 21, 27]) {
      const source = JSON.parse(
        readFileSync(`public/data/nechako-showcase/public-projects/project-${id}.json`, 'utf8'),
      ).attributes
      supplied += source.layers.filter((layer: { sourceType: string }) => layer.sourceType === 'WMS').length
      usable += importWorkspace(source).layers.length
    }
    expect({ supplied, usable }).toEqual({ supplied: 131, usable: 130 })
    const source = JSON.parse(readFileSync('public/data/nechako-showcase/public-projects/project-10.json', 'utf8'))
    const workspace = importWorkspace(source)
    const native = workspace.layers.find((item) => item.id === 'native-4')!
    native.source.resource =
      nativeMapfileUrl('/var/www/tmp/refreshed.map') +
      '&SLD=' +
      encodeURIComponent('https://nechakowatershed-portal.ca/tmp/sld/refreshed.sld')
    native.layer.name = 'refreshed-layer'
    const payload = JSON.parse(nativeProjectSave(workspace).projectJson)
    expect(payload.layers[4]).toMatchObject({
      mapfile: '/var/www/tmp/refreshed.map',
      mapfileName: 'refreshed-layer',
      portalSld: 'https://nechakowatershed-portal.ca/tmp/sld/refreshed.sld',
    })
    expect(source.attributes.layers[4].mapfile).not.toBe('/var/www/tmp/refreshed.map')
  })
  it('does not invent mapfile paths or rewrite supplied external HTTP URLs', () => {
    for (const path of [undefined, '', 'https://example.org/file.map', '/tmp/not-a-map.txt', '/tmp/evil\n.map'])
      expect(() => nativeMapfileUrl(path)).toThrow()
    expect(() => nativeWmsResource({ src: { directDb: true, layerId: 9 } })).toThrow('authorized')
    const workspace = importWorkspace({
      coordinates: [-124, 54],
      layers: [
        { sourceType: 'WMS', legendName: 'HTTP source', urls: ['http://example.org/wms'], params: { LAYERS: 'river' } },
      ],
    })
    expect(workspace.layers).toHaveLength(0)
    expect(workspace.warnings.join(' ')).toContain('HTTPS')
  })
  it('refreshes only the verified permission-checked shared-layer endpoint and never generates a default style', async () => {
    const read = vi.fn().mockResolvedValue({
      layerId: 9,
      name: 'watershed',
      title: 'Nechako',
      mapfileName: 'native-layer',
      mapfile: '/var/www/tmp/new.map',
    })
    const result = await refreshSharedLayer({ directDb: true, layerId: '9', mapfileName: 'old', temporary: true }, read)
    expect(read).toHaveBeenCalledExactlyOnceWith(
      'rest/portal/admin/getLayerSharedLayersManager.php',
      { layerId: '9' },
      undefined,
    )
    expect(new URL(result.resource).searchParams.get('map')).toBe('/var/www/tmp/new.map')
    expect(result.name).toBe('native-layer')
    read.mockResolvedValueOnce({
      layerId: 10,
      name: 'other',
      title: 'Other',
      mapfileName: 'wrong',
      mapfile: '/var/www/tmp/wrong.map',
    })
    await expect(
      refreshSharedLayer({ directDb: true, layerId: '9', mapfileName: 'old', temporary: true }, read),
    ).rejects.toThrow('match')
    await expect(refreshSharedLayer({ mapfileName: 'portal-layer', temporary: true }, read)).rejects.toThrow(
      'lookup ID',
    )
    expect(read).toHaveBeenCalledTimes(2)
  })
})
describe('cross-type native source order', () => {
  const original = {
    coordinates: [-124, 54],
    layers: [
      { sourceType: 'WMS', urls: ['https://example.org/wms'], params: { LAYERS: 'bottom' } },
      { sourceType: 'XYZ', urls: ['https://example.org/{z}/{x}/{y}.png'] },
      { sourceType: 'Vector', layerData: JSON.stringify({ type: 'FeatureCollection', features: [] }) },
      { sourceType: 'WMS', urls: ['https://example.org/wms'], params: { LAYERS: 'top' } },
    ],
  }
  it('preserves WMS/tile/vector interleaving and its export roundtrip', () => {
    const workspace = importWorkspace(original)
    expect(workspaceRenderOrder(workspace)).toEqual([
      { kind: 'wms', id: 'native-0' },
      { kind: 'tile', id: 'native-1' },
      { kind: 'vector', id: 'native-2' },
      { kind: 'wms', id: 'native-3' },
    ])
    expect(importWorkspace(JSON.parse(JSON.stringify(workspace))).sourceOrder).toEqual(workspace.sourceOrder)
  })
  it('keeps cross-type slots while respecting raises within the WMS list; deleted and added sources remain consistent', () => {
    const workspace = importWorkspace(original)
    workspace.layers.reverse()
    expect(workspaceRenderOrder(workspace).map((item) => item.id)).toEqual([
      'native-3',
      'native-1',
      'native-2',
      'native-0',
    ])
    workspace.tiles = []
    workspace.layers.push({ ...workspace.layers[0], id: 'added' })
    expect(workspaceRenderOrder(workspace).map((item) => item.id)).toEqual([
      'native-3',
      'native-2',
      'native-0',
      'added',
    ])
    expect(workspaceRenderOrder(EMPTY_WORKSPACE)).toEqual([])
    expect(() => importWorkspace({ ...workspace, sourceOrder: ['x', 'x'] })).toThrow('source layer order')
  })
})
