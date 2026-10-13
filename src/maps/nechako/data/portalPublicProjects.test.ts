import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkedPortalAttributes } from '@/lib/nechakoPortal'
import {
  OBSERVED_PORTAL_PROJECTS,
  collectionStats,
  collectionWorkspaceCandidate,
  exportCollection,
  parseCollectionFiles,
} from './portalCollections'
import { nativeMapfileUrl } from './nativeLayers'
import { importWorkspace } from './workspace'

type SourceLayer = {
  sourceType: 'XYZ' | 'WMS'
  checked: boolean
  legendName: string
  urls?: string[]
  params?: { LAYERS?: string | string[]; layers?: string | string[]; VERSION?: string }
  src?: unknown
  mapfile?: string
  mapfileName?: string
  portalSld?: string
}
type SourceAttributes = {
  projectId: string | number
  projectName: string
  projectDescription: string | null
  projectSaveTimestamp: string
  coordinates: [number, number]
  scale: number
  layers: SourceLayer[]
}
type SourceEnvelope = { success: boolean; status: string; loggedIn: boolean; attributes: SourceAttributes }
type IndexEntry = { id: number; name: string; file: string; layerCount: number; savedAt: string }
const base = path.resolve(__dirname, '../../../../public/data/nechako-showcase')
const index: { access: string; projects: IndexEntry[] } = JSON.parse(
  readFileSync(path.join(base, 'public-projects/index.json'), 'utf8'),
)
const captures = index.projects.map((entry) => {
  const text = readFileSync(path.join(base, entry.file), 'utf8')
  const envelope: SourceEnvelope = JSON.parse(text)
  return { entry, text, envelope }
})

describe('Actual anonymous Nechako project captures', () => {
  it('registers exactly the nine publicly observed projects, with source names and save dates', () => {
    expect(index.access).toBe('anonymous')
    expect(index.projects.map(({ id, name }) => [id, name])).toEqual(OBSERVED_PORTAL_PROJECTS)
    expect(new Set(index.projects.map(({ id }) => id)).size).toBe(9)
    for (const { entry, envelope } of captures) {
      expect(envelope).toMatchObject({ success: true, status: 'success', loggedIn: false })
      const attributes = checkedPortalAttributes(envelope) as SourceAttributes
      expect(String(attributes.projectId)).toBe(String(entry.id))
      expect(attributes.projectName).toBe(entry.name)
      expect(attributes.projectSaveTimestamp).toBe(entry.savedAt)
      expect(attributes.layers).toHaveLength(entry.layerCount)
    }
  })

  it.each(captures)(
    'preserves source camera and usable WMS references for public project $entry.id',
    ({ envelope }) => {
      const native = checkedPortalAttributes(envelope) as SourceAttributes
      const workspace = importWorkspace(envelope)
      expect(workspace.camera.center).toEqual(native.coordinates)
      expect(workspace.camera.zoom).toBeGreaterThan(0)
      expect(workspace.camera.zoom).toBeLessThanOrEqual(22)
      expect(workspace.vectors).toEqual([])
      const wms = native.layers.filter((layer) => layer.sourceType === 'WMS')
      const available = wms.filter(
        (layer) =>
          (layer.urls?.[0]?.startsWith('https:') && String(layer.params?.LAYERS || layer.params?.layers || '')) ||
          (layer.src && layer.mapfile && layer.mapfileName),
      )
      expect(workspace.layers).toHaveLength(available.length)
      for (const [position, source] of available.entries()) {
        const converted = workspace.layers[position]
        expect(converted.layer.name).toBe(
          source.src && !source.urls?.length
            ? source.mapfileName
            : String(source.params!.LAYERS || source.params!.layers),
        )
        expect(converted.layer.title).toBe(source.legendName)
        expect(converted.visible).toBe(source.checked)
        // Compare the parsed endpoint, including the source QGIS MAP selection.
        const expected = new URL(source.urls?.[0] ?? nativeMapfileUrl(source.mapfile))
        if (source.portalSld) expected.searchParams.set('SLD', source.portalSld)
        expect(new URL(converted.source.resource)).toEqual(expected)
        expect(workspace.warnings).toContain(
          `${source.legendName}: capabilities/identify support and native styling need service verification.`,
        )
      }
      for (const source of wms.filter((layer) => !layer.urls?.length)) {
        expect(workspace.warnings).toContain(
          `${source.legendName}: native mapfile and SLD references can expire; verify the service or refresh the authorized shared-layer reference.`,
        )
      }
      expect(workspace.sourceOrder).toEqual(native.layers.map((_, index) => `native-${index}`))
      for (const source of wms.filter(
        (layer) => layer.urls?.length && !String(layer.params?.LAYERS || layer.params?.layers || ''),
      )) {
        expect(workspace.warnings).toContain(`${source.legendName}: No WMS layer name.`)
      }
      expect(workspace.originalProject).toBe(envelope)
      expect(workspace.warnings.join(' ')).toContain('Native source order is preserved across layer types')
    },
  )

  it('converts the actual learning map scale to a finite zoom while preserving its source position', () => {
    const capture = captures.find(({ entry }) => entry.id === 27)!
    expect(capture.envelope.attributes.scale).toBe(5_000_000)
    expect(importWorkspace(capture.envelope).camera).toMatchObject({
      center: [-125.03139066271606, 54.463511194397654],
      zoom: expect.closeTo(5.886690429163932, 8),
      bearing: 0,
      pitch: 0,
    })
  })

  it.each(captures)(
    'keeps HTTPS XYZ templates and explicitly warns about source HTTP basemaps for $entry.id',
    ({ envelope }) => {
      const native = envelope.attributes
      const workspace = importWorkspace(envelope)
      const xyz = native.layers.filter((layer) => layer.sourceType === 'XYZ')
      const https = xyz.filter((layer) => layer.urls!.every((url) => new URL(url).protocol === 'https:'))
      expect(workspace.tiles.map((tile) => tile.urls)).toEqual(https.map((layer) => layer.urls))
      expect(workspace.tiles.map((tile) => tile.visible)).toEqual(https.map((layer) => layer.checked))
      for (const source of xyz.filter((layer) => layer.urls!.some((url) => new URL(url).protocol === 'http:'))) {
        expect(workspace.warnings).toContain(
          `${source.legendName}: Map sources must use HTTPS without credentials in the URL.`,
        )
        expect(workspace.tiles.some((tile) => tile.name === source.legendName)).toBe(false)
      }
      // Three actual saved projects select HTTP OpenStreetMap. The importer must
      // disclose that omission, rather than silently relabel another tile source.
      const selectedHttp = xyz.some((layer) => layer.checked && layer.urls![0].startsWith('http:'))
      if (selectedHttp) expect(workspace.tiles.every((tile) => !tile.visible)).toBe(true)
    },
  )

  it('reads all nine native envelopes as projects and round trips their exact original source text', () => {
    const files = captures.flatMap(({ entry, text, envelope }) => {
      const parsed = parseCollectionFiles(text, entry.file)
      expect(parsed).toHaveLength(1)
      const [record] = parsed[0].records
      expect(parsed[0].records).toHaveLength(1)
      expect(record.kind).toBe('project')
      expect(record.title).toBe(envelope.attributes.projectName)
      expect(record.sourceId).toBe(envelope.attributes.projectId)
      expect(record.description).toBe(envelope.attributes.projectDescription ?? '')
      expect(record.raw).toEqual(envelope)
      expect(collectionWorkspaceCandidate(record.raw)).toEqual(envelope.attributes)
      expect(importWorkspace(collectionWorkspaceCandidate(record.raw)).camera.center).toEqual(
        envelope.attributes.coordinates,
      )
      return parsed
    })
    expect(collectionStats(files)).toMatchObject({ files: 9, records: 9, jsonBytes: 6_253_465 })
    const restored = parseCollectionFiles(exportCollection(files), 'all-public-projects.json')
    expect(restored.map((file) => file.sourceText)).toEqual(captures.map(({ text }) => text))
    expect(restored.map((file) => file.records[0].sourceId)).toEqual(
      captures.map(({ envelope }) => envelope.attributes.projectId),
    )
  })
})
