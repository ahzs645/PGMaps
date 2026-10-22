import { importLocalWorkbench, listLocalWorkbench, type LocalWorkbenchRecord } from './localWorkbench'
import { sha256Bytes, importFilename } from './importValues'
import { gpapLayers, gpapReviewJson, type GpapProject } from './geopaparazzi'
import type { GisImportResult } from './conversion'
import type { DraftReview } from './submissionReview'
import type { MonitoringMapping } from './monitoring'
import { normalizeMonitoring } from './monitoring'

export type LocalRelationship = { kind: string; id: string; role?: string }
export type LocalAttachmentData = {
  schema: 'nechako-local-attachment-v1'
  originalName: string
  lastModified?: number
  sha256: string
  description: string
  tags: string[]
  relationships: LocalRelationship[]
}
export function ingestionRecord<T>(
  kind: string,
  id: string,
  name: string,
  data: T,
  binary?: { blob: Blob; filename: string; mime?: string },
): LocalWorkbenchRecord<T> {
  const now = new Date().toISOString()
  return {
    id,
    kind,
    name: name.slice(0, 200) || kind,
    data,
    createdAt: now,
    updatedAt: now,
    bytes: 0,
    ...(binary ? { ...binary, mime: binary.mime || binary.blob.type || 'application/octet-stream' } : {}),
    source: {
      importedAt: now,
      access: 'unknown',
      notes: 'Explicitly imported into this browser. No portal publication.',
    },
  }
}
export async function attachmentRecord(
  file: File,
  options: { description?: string; tags?: string[]; relationships?: LocalRelationship[]; id?: string } = {},
): Promise<LocalWorkbenchRecord<LocalAttachmentData>> {
  if (file.size > 100 * 1024 * 1024) throw new Error('Stage attachments up to 100 MiB each.')
  const sha256 = await sha256Bytes(file)
  const nameHash = await sha256Bytes(new TextEncoder().encode(file.name))
  return ingestionRecord(
    'attachment',
    options.id ?? `attachment:${sha256}:${nameHash.slice(0, 16)}`,
    importFilename(file.name),
    {
      schema: 'nechako-local-attachment-v1',
      originalName: file.name,
      lastModified: file.lastModified,
      sha256,
      description: options.description ?? '',
      tags: options.tags ?? [],
      relationships: options.relationships ?? [],
    },
    { blob: file, filename: importFilename(file.name), mime: file.type },
  )
}
export async function cacheGisImport(files: File[], result: GisImportResult): Promise<number> {
  const sourceFiles = await Promise.all(files.map((file) => attachmentRecord(file)))
  const fingerprint = await sha256Bytes(
    new TextEncoder().encode(
      JSON.stringify({
        sources: sourceFiles.map((item) => [item.data.originalName, item.data.sha256]),
        layers: result.layers.map((layer) => [layer.name, layer.data]),
      }),
    ),
  )
  const existing = new Set((await listLocalWorkbench()).map((item) => item.id))
  const originals = [...new Map(sourceFiles.map((item) => [item.id, item])).values()].filter(
    (item) => !existing.has(item.id),
  )
  const layers = result.layers.map((layer, index) =>
    ingestionRecord('layer', `gis:${fingerprint}:${index}`, layer.name, {
      schema: 'nechako-local-layer-v1',
      kind: 'local',
      name: layer.name,
      data: layer.data,
      materialization: {
        status: 'complete',
        basis: 'imported-file',
        featureCount: layer.data.features.length,
        countVerified: false,
        notes: ['Every feature in this imported file is cached. No source dataset total was verified.'],
      },
      original: { sourceFile: layer.sourceFile, sourceCrs: layer.sourceCrs, warnings: result.warnings },
      relationships: sourceFiles.map((item) => ({ kind: 'attachment', id: item.id, role: 'original-source' })),
    }),
  )
  return importLocalWorkbench([...originals, ...layers])
}

export function gpapProjectIdentity(project: GpapProject): string {
  const metadata = new Map(project.metadata.map((item) => [String(item.key), String(item.value)]))
  const device = metadata.get('deviceid'),
    creation = metadata.get('creationts')
  return device && creation ? `device:${device}:created:${creation}` : `filename:${project.name}`
}
export type GpapImportConflict = {
  noteId: string
  localId: string
  localName: string
  kind: 'duplicate' | 'conflict'
  basis: string
}
export async function gpapLocalRecords(
  project: GpapProject,
  original: File,
  selectedNoteIndexes: number[],
): Promise<LocalWorkbenchRecord[]> {
  const selected = new Set(selectedNoteIndexes)
  if ([...selected].some((index) => !Number.isInteger(index) || index < 0 || index >= project.notes.length))
    throw new Error('The GPAP note selection is invalid.')
  const packageId = `gpap:${project.sha256}`
  const projectIdentity = gpapProjectIdentity(project)
  const attachments = await Promise.all(
    project.images.map(async (image, index) => {
      if (!image.bytes) return undefined
      const file = new File([new Uint8Array(image.bytes)], image.filename, { type: image.mime })
      const localId = `${packageId}:image:${index}`
      return attachmentRecord(file, {
        id: localId,
        description: String(image.row.text ?? ''),
        relationships: [
          { kind: 'geopaparazzi', id: packageId, role: 'source-project' },
          ...project.notes.flatMap((note, noteIndex) =>
            selected.has(noteIndex) && note.imageIds.includes(image.id)
              ? [{ kind: 'submission', id: `${packageId}:note:${noteIndex}`, role: 'note-media' }]
              : [],
          ),
        ],
      }).then((record) => ({
        ...record,
        data: { ...record.data, sourceImageId: image.id, sourceImageDataId: image.imageDataId, original: image.row },
      }))
    }),
  )
  const media = attachments.filter((record): record is NonNullable<typeof record> => !!record)
  const notes = await Promise.all(
    project.notes
      .flatMap((note, index) => (selected.has(index) ? [{ note, index }] : []))
      .map(async ({ note, index }) => {
        const attachmentIds = project.images.flatMap((image, imageIndex) =>
          note.imageIds.includes(image.id) && image.bytes ? [`${packageId}:image:${imageIndex}`] : [],
        )
        const sourceFingerprint = await sha256Bytes(
          new TextEncoder().encode(
            JSON.stringify({
              row: note.row,
              form: note.formRaw,
              extension: note.extension,
              media: media.filter((item) => attachmentIds.includes(item.id)).map((item) => item.data.sha256),
            }),
          ),
        )
        return ingestionRecord(
          'submission',
          `${packageId}:note:${index}`,
          String(note.row.text ?? `GPAP note ${note.id}`) || `GPAP note ${note.id}`,
          {
            schema: 'nechako-local-submission-v1',
            status: 'draft',
            sourceType: 'geopaparazzi',
            sourcePackageId: packageId,
            sourceNoteId: note.id,
            projectIdentity,
            sourceFingerprint,
            original: note.row,
            formRaw: note.formRaw,
            form: note.form,
            formName: note.formName,
            values: Object.fromEntries(note.fields.map((field) => [field.path, field.value])),
            geometry: note.feature.geometry,
            sourceFeature: note.feature,
            attachmentIds,
            issues: note.issues,
            relationships: [
              { kind: 'geopaparazzi', id: packageId, role: 'source-project' },
              ...attachmentIds.map((id) => ({ kind: 'attachment', id, role: 'note-media' })),
            ],
          },
        )
      }),
  )
  const layers = gpapLayers(project).map((layer, index) =>
    ingestionRecord('layer', `${packageId}:layer:${index}`, layer.name, {
      schema: 'nechako-local-layer-v1',
      kind: 'local',
      name: layer.name,
      data: layer.data,
      materialization: {
        status: 'complete',
        basis: 'imported-file',
        featureCount: layer.data.features.length,
        countVerified: false,
        notes: ['Every parsed GPAP record is retained; records without valid coordinates have null geometry.'],
      },
      original: { sourcePackageId: packageId, issues: project.issues },
      relationships: [{ kind: 'geopaparazzi', id: packageId, role: 'source-project' }],
    }),
  )
  const packageRecord = ingestionRecord(
    'geopaparazzi',
    packageId,
    project.name,
    {
      ...(gpapReviewJson(project) as Record<string, unknown>),
      selectedNoteIndexes: [...selected],
      projectIdentity,
      relationships: [...notes, ...media, ...layers].map((record) => ({
        kind: record.kind,
        id: record.id,
        role: 'imported-record',
      })),
    },
    { blob: original, filename: importFilename(original.name), mime: 'application/vnd.geopaparazzi' },
  )
  return [packageRecord, ...notes, ...media, ...layers]
}
export function gpapConflicts(
  incoming: LocalWorkbenchRecord[],
  existing: LocalWorkbenchRecord[],
): GpapImportConflict[] {
  const conflicts: GpapImportConflict[] = []
  type Identity = { projectIdentity?: string; sourceNoteId?: string; sourceFingerprint?: string }
  const matching = new Map<string, LocalWorkbenchRecord[]>()
  const key = (data: Identity) => JSON.stringify([data.projectIdentity, data.sourceNoteId])
  for (const saved of existing) {
    if (saved.kind !== 'submission') continue
    const data = saved.data as Identity
    if (!data.projectIdentity) continue
    const identity = key(data)
    const records = matching.get(identity) ?? []
    records.push(saved)
    matching.set(identity, records)
  }
  for (const candidate of incoming.filter((record) => record.kind === 'submission')) {
    const data = candidate.data as Identity
    if (!data.projectIdentity) continue
    for (const saved of matching.get(key(data)) ?? []) {
      const prior = saved.data as typeof data
      conflicts.push({
        noteId: data.sourceNoteId ?? '',
        localId: saved.id,
        localName: saved.name,
        kind: data.sourceFingerprint === prior.sourceFingerprint ? 'duplicate' : 'conflict',
        basis: data.projectIdentity.startsWith('filename:')
          ? 'matching filename and note ID; project identity unverified'
          : 'matching source device, project creation timestamp and note ID',
      })
    }
  }
  return conflicts
}

export function mappedDraftRecords(
  review: DraftReview,
  selectedIds: string[],
  geometry?: GeoJSON.FeatureCollection,
): LocalWorkbenchRecord[] {
  const selected = new Set(selectedIds)
  if (
    selected.size !== selectedIds.length ||
    selectedIds.some((id) => !review.drafts.some((draft) => draft.localId === id))
  )
    throw new Error('The selected draft rows are invalid.')
  return review.drafts
    .filter((draft) => selected.has(draft.localId))
    .map((draft) => {
      if (draft.issues.length) throw new Error('Resolve declared-rule issues before caching selected mapped drafts.')
      return ingestionRecord('submission', crypto.randomUUID(), `${review.sourceName} — row ${draft.sourceRow}`, {
        schema: 'nechako-local-submission-v1',
        status: 'draft',
        sourceType: geometry ? 'gis' : 'csv',
        formId: review.formId,
        formTitle: review.formTitle,
        formOriginal: review.formOriginal,
        mapping: review.mapping,
        sourceName: review.sourceName,
        sourceRow: draft.sourceRow,
        original: draft.source,
        values: draft.values,
        ...(geometry
          ? {
              sourceFeature: geometry.features[draft.sourceRow - 1],
              geometry: geometry.features[draft.sourceRow - 1]?.geometry,
            }
          : {}),
        issues: draft.issues,
        relationships: [],
      })
    })
}
export async function cacheMonitoringCsv(
  file: File,
  headers: string[],
  records: Record<string, string>[],
  mapping: MonitoringMapping,
): Promise<LocalWorkbenchRecord> {
  const normalized = normalizeMonitoring(records, mapping)
  const sha256 = await sha256Bytes(file)
  const fingerprint = await sha256Bytes(new TextEncoder().encode(JSON.stringify([sha256, mapping])))
  const record = ingestionRecord(
    'monitoring',
    `monitoring:${fingerprint}`,
    file.name,
    {
      schema: 'nechako-local-monitoring-v1',
      headers,
      records,
      mapping,
      observations: normalized.observations,
      validation: { errors: normalized.errors, duplicates: normalized.duplicates },
      sourceFile: { name: file.name, sha256, bytes: file.size },
      publication: 'local-only',
      relationships: [],
    },
    { blob: file, filename: importFilename(file.name), mime: 'text/csv' },
  )
  await importLocalWorkbench([record])
  return record
}
