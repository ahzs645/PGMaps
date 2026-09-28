import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const folder = 'public/data/story-documents/prague'
const document = JSON.parse(readFileSync(`${folder}/story.json`, 'utf8'))
const manifest = JSON.parse(readFileSync(`${folder}/manifest.json`, 'utf8'))
type CapturedNode = {
  type: string
  children?: string[]
  data?: {
    type?: string
    subtype?: string
    links?: { nodeId: string }[]
    places?: unknown[]
  }
}
type CapturedResource = { type: string; data: { url?: string; webmapUrl?: string } }
const nodes = Object.values(document.nodes) as CapturedNode[]
const resources = Object.values(document.resources) as CapturedResource[]
const nodesOfType = (type: string) => nodes.filter((node) => node.type === type)

function inspectForCredentials(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(inspectForCredentials)
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      expect(key).not.toMatch(
        /^(gaid|gaconsentmessage|analytics|googleanalytics|telemetry|tracking|token|access_token|refresh_token|api[_-]?key|client[_-]?secret|authorization|cookie|cookies|headers|sessionid|useridentity|useremail)$/i,
      )
      inspectForCredentials(child)
    }
  }
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
    const url = new URL(value)
    for (const key of url.searchParams.keys()) {
      expect(key).not.toMatch(/token|key|secret|session|auth|^utm_|^fbclid$|^gclid$/i)
    }
  }
}

describe('imported Prague reference integrity', () => {
  it('retains the complete authored navigation, sidecars, swipes, tours and actions', () => {
    expect(nodes).toHaveLength(257)
    expect(resources).toHaveLength(59)
    expect(nodesOfType('navigation')).toHaveLength(1)
    expect(nodesOfType('navigation')[0].data?.links).toHaveLength(7)
    expect(nodesOfType('immersive')).toHaveLength(3)
    expect(nodesOfType('immersive').map((node) => node.children?.length)).toEqual([7, 4, 7])
    expect(nodesOfType('immersive-slide')).toHaveLength(18)
    expect(nodesOfType('swipe')).toHaveLength(4)
    expect(nodesOfType('tour')).toHaveLength(4)
    expect(nodesOfType('tour').map((node) => node.data?.places?.length)).toEqual([4, 6, 3, 2])
    expect(document.actions).toHaveLength(15)
    for (const node of nodes) {
      for (const child of node.children ?? []) expect(document.nodes[child]).toBeDefined()
      for (const link of node.data?.links ?? []) expect(document.nodes[link.nodeId]).toBeDefined()
    }
  })

  it('distinguishes seven referenced map actions from eight retained stale records', () => {
    const active = document.actions.filter(
      (action: { target: string; origin: string; data: { actionId: string } }) =>
        document.nodes[action.target] && document.nodes[action.origin]?.data?.text?.includes(action.data.actionId),
    )
    expect(active).toHaveLength(7)
    expect(manifest.actionInventory.activeCount).toBe(7)
    expect(manifest.actionInventory.staleCount).toBe(8)
    expect(manifest.actionInventory.retainedCount).toBe(15)
    expect(manifest.actionInventory.activeActionIds).toEqual(
      active.map((action: { data: { actionId: string } }) => action.data.actionId),
    )
    expect(manifest.actionInventory.staleActionIds).toHaveLength(8)
  })

  it('resolves every captured media asset and verifies its recorded bytes and hash', () => {
    expect(manifest.media).toHaveLength(40)
    expect(manifest.omissions).toEqual([])
    for (const asset of manifest.media) {
      expect(asset.url).toMatch(/^\/data\/story-documents\/prague\/assets\//)
      const bytes = readFileSync(`public${asset.url}`)
      expect(bytes.length).toBe(asset.bytes)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256)
    }
    expect(manifest.fonts).toHaveLength(6)
    for (const font of manifest.fonts) expect(readFileSync(`public${font.url}`).length).toBe(font.bytes)
    const theme = Object.values(document.resources).find(
      (resource) => (resource as { type: string }).type === 'story-theme',
    ) as { data: { theme: { localFonts: { url: string }[] } } }
    expect(theme.data.theme.localFonts.map((font) => font.url)).toEqual(
      manifest.fonts.map((font: { url: string }) => font.url),
    )
    for (const resource of resources.filter((resource) => ['image', 'video'].includes(resource.type))) {
      expect(resource.data.url).toBeTruthy()
      expect(existsSync(`public${resource.data.url}`)).toBe(true)
    }
    const video = manifest.media.find((asset: { type: string }) => asset.type === 'video')
    expect(video.bytes).toBe(14_862_950)
  })

  it('keeps all nineteen map definitions readable with their original operational layers', () => {
    expect(manifest.webmaps).toHaveLength(19)
    for (const resource of resources.filter((resource) => resource.type === 'webmap')) {
      expect(resource.data.webmapUrl).toMatch(/^\/data\/story-documents\/prague\/maps\//)
      const map = JSON.parse(readFileSync(`public${resource.data.webmapUrl}`, 'utf8'))
      expect(Array.isArray(map.operationalLayers)).toBe(true)
      inspectForCredentials(map)
    }
  })

  it('records original service failures separately from the complete local media', () => {
    const failures = manifest.sourceAvailability.unavailableServices
    expect(failures).toHaveLength(3)
    expect(failures.map((failure: { serviceCode: number | null }) => failure.serviceCode)).toEqual([404, 500, null])
    expect(failures.flatMap((failure: { affectedItemIds: string[] }) => failure.affectedItemIds)).toHaveLength(4)
    expect(manifest.omissions).toEqual([])
  })

  it('preserves publisher attribution without importing analytics or transport credentials', () => {
    expect(document.source.itemId).toBe('3ed83ef359d346618510764c6222ac01')
    expect(document.source.title).toBe('The Diverse Prague')
    expect(document.source.publisher).toContain('IPR Prague')
    expect(nodesOfType('credits')).toHaveLength(1)
    expect(nodesOfType('attribution')).toHaveLength(4)
    inspectForCredentials(document)
    inspectForCredentials(manifest)
  })
})
