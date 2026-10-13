import type { ProjectRead } from './projectManager'
import type { Workspace } from './workspace'
import { checkedSldUrl } from './vectorStyle'
/** Original page build6268M inline config: Global.addGlobal("MapServerUrl", "/cgi-bin/mapserv?map=").
 * MapPanel.js addWMS uses mapfileName as LAYERS; Project.js preserves saved native mapfile/SLD references.
 */
export const NATIVE_MAPSERVER = 'https://nechakowatershed-portal.ca/cgi-bin/mapserv'
export function nativeMapfileUrl(mapfile: unknown): string {
  if (
    typeof mapfile !== 'string' ||
    !mapfile.startsWith('/') ||
    !mapfile.endsWith('.map') ||
    [...mapfile].some((character) => character.charCodeAt(0) < 32)
  )
    throw new Error('The native source did not supply a valid absolute mapfile reference.')
  const url = new URL(NATIVE_MAPSERVER)
  url.searchParams.set('map', mapfile)
  return url.href
}
export type NativeWmsReference = { directDb?: boolean; layerId?: string; mapfileName: string; temporary: true }
export function nativeWmsResource(layer: Record<string, unknown>): {
  resource: string
  name: string
  reference?: NativeWmsReference
} {
  const src = layer.src as { directDb?: boolean; layerId?: unknown } | undefined
  if (!src || typeof layer.mapfileName !== 'string' || !layer.mapfileName)
    throw new Error('Portal-native source needs its authorized layer endpoint; no URL in this file.')
  return {
    resource: nativeMapfileUrl(layer.mapfile),
    name: layer.mapfileName,
    reference: {
      directDb: src.directDb === true,
      layerId: src.layerId === undefined ? undefined : String(src.layerId),
      mapfileName: layer.mapfileName,
      temporary: true,
    },
  }
}
export async function refreshSharedLayer(reference: NativeWmsReference, read: ProjectRead, signal?: AbortSignal) {
  if (!reference.directDb || !reference.layerId || !/^\d+$/.test(reference.layerId))
    throw new Error('This native layer has no verified shared-layer lookup ID.')
  const value = (await read(
    'rest/portal/admin/getLayerSharedLayersManager.php',
    { layerId: reference.layerId },
    signal,
  )) as Record<string, unknown>
  if (
    !value ||
    String(value.layerId) !== reference.layerId ||
    typeof value.mapfileName !== 'string' ||
    !value.mapfileName ||
    typeof value.name !== 'string' ||
    typeof value.title !== 'string'
  )
    throw new Error('The shared-layer response does not match the requested native layer.')
  const resource = nativeMapfileUrl(value.mapfile)
  // Native lookup does not promise a default SLD. Only use an actual supplied HTTPS reference.
  const url = new URL(resource)
  if (typeof value.portalSld === 'string') url.searchParams.set('SLD', checkedSldUrl(value.portalSld))
  return {
    resource: url.href,
    name: value.mapfileName,
    title: value.title,
    reference: { ...reference, mapfileName: value.mapfileName },
  }
}
export function workspaceRenderOrder(workspace: Workspace): { kind: 'tile' | 'wms' | 'vector'; id: string }[] {
  const items = [
    ...workspace.tiles.map((item) => ({ kind: 'tile' as const, id: item.id })),
    ...workspace.layers.map((item) => ({ kind: 'wms' as const, id: item.id })),
    ...workspace.vectors.map((item) => ({ kind: 'vector' as const, id: item.id })),
  ]
  if (!workspace.sourceOrder?.length) return items
  // Preserve cross-type slots while respecting the user's current order within each layer list.
  const queues = {
    tile: items.filter((item) => item.kind === 'tile'),
    wms: items.filter((item) => item.kind === 'wms'),
    vector: items.filter((item) => item.kind === 'vector'),
  }
  const result: typeof items = []
  for (const id of workspace.sourceOrder) {
    const saved = items.find((item) => item.id === id)
    if (saved) {
      const next = queues[saved.kind].shift()
      if (next) result.push(next)
    }
  }
  return [...result, ...items.filter((item) => !result.some((value) => value.id === item.id))]
}
