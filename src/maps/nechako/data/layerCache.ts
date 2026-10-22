import { checkedLocalLayer, type LocalLayerAsset } from './localLayers'
import { getLocalWorkbench, saveLocalWorkbench, type LocalWorkbenchSource } from './localWorkbench'

export const localLayerCacheId = (asset: LocalLayerAsset) =>
  asset.kind === 'local' ? undefined : `layer:source:${asset.kind}:${asset.sourceId}`

/** Save geometry/provenance together; ordinary saves retain original-file metadata and source access. */
export async function saveLayerAsset({
  asset: input,
  id,
  blob,
  filename,
  access,
}: {
  asset: LocalLayerAsset
  id?: string
  blob?: Blob
  filename?: string
  access: 'public' | 'private' | 'unknown'
}) {
  const asset = checkedLocalLayer(input)
  const key = id ?? localLayerCacheId(asset)
  const previous = key ? await getLocalWorkbench(key) : undefined
  if (previous && asset.materialization.status === 'descriptor') {
    const existing = checkedLocalLayer(previous.data)
    if (existing.data) return previous
  }
  const original =
    asset.original && typeof asset.original === 'object' ? (asset.original as Record<string, unknown>) : undefined
  const wfs = original?.wfs && typeof original.wfs === 'object' ? (original.wfs as Record<string, unknown>) : undefined
  const source: LocalWorkbenchSource = {
    ...previous?.source,
    ...(asset.kind === 'local'
      ? typeof wfs?.url === 'string'
        ? { url: wfs.url }
        : {}
      : { portal: 'https://nechakowatershed-portal.ca/', recordId: asset.sourceId }),
    access:
      previous?.source?.access === 'private'
        ? 'private'
        : !blob && previous?.source?.access
          ? previous.source.access
          : access,
    importedAt: !blob && previous?.source?.importedAt ? previous.source.importedAt : new Date().toISOString(),
    notes: previous?.source?.notes ?? 'Explicit browser-local copy. Dataset coverage is recorded in materialization.',
  }
  return saveLocalWorkbench({
    id: key,
    kind: 'layer',
    name: asset.name,
    data: asset,
    source,
    ...(blob === undefined ? {} : { blob }),
    ...(filename === undefined ? {} : { filename }),
  })
}
