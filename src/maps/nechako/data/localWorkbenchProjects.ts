import { parseReviewForm } from './submissionReview'
import { importWorkspace, type Workspace } from './workspace'
import type { LocalWorkbenchRecord } from './localWorkbench'

export type LocalWorkbenchProject = {
  schema: 'nechako-local-project-v1'
  workspace: Workspace
  history: { savedAt: string; workspace: Workspace }[]
}
export function createLocalWorkbenchProject(
  workspace: Workspace,
  previous?: LocalWorkbenchRecord,
): LocalWorkbenchProject {
  const checked = importWorkspace(workspace)
  const old = previous?.data as Partial<LocalWorkbenchProject> | undefined
  const history =
    old?.schema === 'nechako-local-project-v1' && old.workspace && previous
      ? [
          { savedAt: previous.updatedAt, workspace: importWorkspace(old.workspace) },
          ...(Array.isArray(old.history) ? old.history : []),
        ].slice(0, 20)
      : []
  // An explicitly saved local copy is independent of the source login. The record keeps its private access label.
  return { schema: 'nechako-local-project-v1', workspace: { ...checked, sessionBound: false }, history }
}
export function openLocalWorkbenchProject(record: LocalWorkbenchRecord): Workspace {
  if (record.kind !== 'project') throw new Error('Select a local project.')
  const data = record.data as Partial<LocalWorkbenchProject> & Partial<Workspace>
  const workspace = data?.schema === 'nechako-workspace-v1' ? data : data?.workspace
  if (!workspace)
    throw new Error(
      'This record contains an original project file but no saved map workspace. Download its original file to use it in the source application.',
    )
  return { ...importWorkspace(workspace), sessionBound: false }
}
export const LOCAL_SCHEMA_TEMPLATE = {
  schema: 'nechako-local-schema-v1',
  name: 'Local observations',
  geometryType: 'Point',
  fields: [
    { id: 'site_name', name: 'Site name', type: 'text', required: true },
    { id: 'measurement', name: 'Measurement', type: 'number', required: false },
    { id: 'observed_on', name: 'Observed on', type: 'date', required: false },
  ],
}
/** Native definitions remain byte-for-value JSON; stricter types apply to newly authored local schemas. */
export function checkLocalWorkbenchSchema(input: unknown) {
  const form = parseReviewForm(input)
  const value = input as { schema?: unknown; geometryType?: unknown; name?: unknown }
  if (value?.schema === 'nechako-local-schema-v1') {
    if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 200)
      throw new Error('A local schema needs a name of 1–200 characters.')
    if (
      !['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'Any'].includes(
        String(value.geometryType),
      )
    )
      throw new Error('Choose Point, LineString, Polygon, their multi geometries, or Any for geometryType.')
    const supported = [
      'text',
      'string',
      'integer',
      'int',
      'bigint',
      'smallint',
      'number',
      'float',
      'double precision',
      'numeric',
      'real',
      'boolean',
      'bool',
      'checkbox',
      'date',
      'datetime',
      'timestamp',
      'json',
    ]
    for (const field of form.fields) {
      if (!field.id.trim() || !field.label.trim()) throw new Error('Every local schema field needs an ID and name.')
      if (!supported.includes(field.type.toLowerCase()))
        throw new Error(
          `Unsupported local field type ${field.type}. Use text, number, integer, boolean, date, datetime or json.`,
        )
    }
  }
  return form
}
