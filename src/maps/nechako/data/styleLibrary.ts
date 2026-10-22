import type { VectorData } from './workspace'
import {
  getLocalWorkbench,
  saveLocalWorkbench,
  deleteLocalWorkbench,
  type LocalWorkbenchRecord,
} from './localWorkbench'
import { checkedVectorStyle, vectorGeometryTypes, vectorStyleFor, type VectorStyle } from './vectorRules'
import type { StyleDiagnostic } from './sldStyle'

export type LocalStyleData = {
  schema: 'nechako-local-style-v1'
  style?: VectorStyle
  originalSld?: string
  diagnostics: StyleDiagnostic[]
}
export type StyleDefaults = { schema: 'nechako-style-defaults-v1'; assignments: Record<string, string> }
export const STYLE_DEFAULTS_ID = 'nechako-style-defaults-v1'
/** Saving an edited import preserves its source XML separately from the current typed definition. */
export function localStyleDataForVector(vector: VectorData, style = vectorStyleFor(vector)): LocalStyleData {
  return checkedLocalStyleData({
    schema: 'nechako-local-style-v1',
    style: checkedVectorStyle(style),
    ...(vector.styleSource && { originalSld: vector.styleSource.original }),
    diagnostics: vector.styleSource
      ? [
          ...vector.styleSource.diagnostics.map((message) => ({ severity: 'warning' as const, message })),
          {
            severity: 'warning',
            message:
              'The original SLD is retained as import provenance. The typed definition describes the current local style and may include edits.',
          },
        ]
      : [],
  })
}
export function checkedLocalStyleData(input: unknown): LocalStyleData {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected a local style document.')
  const source = input as Record<string, unknown>
  if (source.schema === 'nechako-vector-style-v1')
    return { schema: 'nechako-local-style-v1', style: checkedVectorStyle(source), diagnostics: [] }
  if (
    source.schema !== 'nechako-local-style-v1' ||
    !Array.isArray(source.diagnostics) ||
    source.diagnostics.length > 100
  )
    throw new Error('Unsupported local style document version.')
  if (Object.keys(source).some((key) => !['schema', 'style', 'originalSld', 'diagnostics'].includes(key)))
    throw new Error(
      'The local style contains unknown fields; preserve the original file instead of silently dropping them.',
    )
  if (
    source.originalSld !== undefined &&
    (typeof source.originalSld !== 'string' || new TextEncoder().encode(source.originalSld).length > 2 * 1024 * 1024)
  )
    throw new Error('An original SLD must be text no larger than 2 MiB.')
  const diagnostics = source.diagnostics.map((value): StyleDiagnostic => {
    const item = value as StyleDiagnostic
    if (
      !item ||
      !['warning', 'error'].includes(item.severity) ||
      typeof item.message !== 'string' ||
      item.message.length > 4000
    )
      throw new Error('Invalid style import diagnostics.')
    return { severity: item.severity, message: item.message }
  })
  const style = source.style === undefined ? undefined : checkedVectorStyle(source.style)
  if (!style && !source.originalSld)
    throw new Error('A style document needs a supported style or a retained original SLD.')
  if (style && diagnostics.some((item) => item.severity === 'error'))
    throw new Error('A style with unresolved import errors cannot be applied.')
  return {
    schema: 'nechako-local-style-v1',
    ...(style && { style }),
    ...(source.originalSld !== undefined && { originalSld: source.originalSld as string }),
    diagnostics,
  }
}
export function checkedStyleDefaults(input: unknown): StyleDefaults {
  const value = input as StyleDefaults
  if (
    !value ||
    value.schema !== 'nechako-style-defaults-v1' ||
    !value.assignments ||
    typeof value.assignments !== 'object' ||
    Array.isArray(value.assignments)
  )
    throw new Error('Invalid local style defaults.')
  const assignments: Record<string, string> = Object.create(null)
  const entries = Object.entries(value.assignments)
  if (entries.length > 200) throw new Error('At most 200 local style default assignments are supported.')
  for (const [key, id] of entries) {
    if (!['point', 'line', 'polygon'].includes(key) && !/^schema:[A-Za-z0-9_.:-]{1,100}$/.test(key))
      throw new Error('Defaults need a geometry or explicit schema ID.')
    if (typeof id !== 'string' || !id || id.length > 250) throw new Error('A default must reference a local style ID.')
    assignments[key] = id
  }
  return { schema: 'nechako-style-defaults-v1', assignments }
}
export function applyStyleRecord(vector: VectorData, record: LocalWorkbenchRecord): VectorData {
  if (record.kind !== 'style') throw new Error('Choose a saved style.')
  const data = checkedLocalStyleData(record.data)
  if (!data.style)
    throw new Error(
      'This SLD contains unsupported features. Its original is available for download; it cannot be applied.',
    )
  const types = vectorGeometryTypes(vector.data)
  if (data.style.geometry !== 'any' && !types.includes(data.style.geometry))
    throw new Error('The selected style does not match this layer geometry.')
  return {
    ...vector,
    style: checkedVectorStyle(data.style),
    ...(data.originalSld
      ? {
          styleSource: {
            format: 'sld' as const,
            original: data.originalSld,
            diagnostics: data.diagnostics.map((item) => item.message),
          },
        }
      : { styleSource: undefined }),
  }
}
export async function setLocalStyleDefault(target: string, styleId?: string): Promise<void> {
  if (styleId) {
    const record = await getLocalWorkbench(styleId)
    if (!record || record.kind !== 'style' || !checkedLocalStyleData(record.data).style)
      throw new Error('Only a supported saved style can be a default.')
    const style = checkedLocalStyleData(record.data).style!
    if (['point', 'line', 'polygon'].includes(target) && style.geometry !== 'any' && style.geometry !== target)
      throw new Error('The saved style geometry does not match this default.')
  }
  const previous = await getLocalWorkbench<StyleDefaults>(STYLE_DEFAULTS_ID)
  const defaults = previous
    ? checkedStyleDefaults(previous.data)
    : { schema: 'nechako-style-defaults-v1' as const, assignments: {} as Record<string, string> }
  const assignments = { ...defaults.assignments }
  if (styleId) assignments[target] = styleId
  else delete assignments[target]
  await saveLocalWorkbench({
    id: STYLE_DEFAULTS_ID,
    kind: 'style-defaults',
    name: 'Default vector styles',
    data: checkedStyleDefaults({ ...defaults, assignments }),
  })
}
/** Explicit map-add callers can use a cached default. Existing explicit styles and original data are unchanged. */
export async function applyLocalDefaultStyle(vector: VectorData, schemaId?: string): Promise<VectorData> {
  if (vector.style || vector.categories) return vector
  const saved = await getLocalWorkbench<StyleDefaults>(STYLE_DEFAULTS_ID)
  if (!saved) return vector
  const defaults = checkedStyleDefaults(saved.data)
  const types = vectorGeometryTypes(vector.data)
  const id =
    (schemaId && defaults.assignments['schema:' + schemaId]) ||
    (types.length === 1 ? defaults.assignments[types[0]] : undefined)
  if (!id) return vector
  const style = await getLocalWorkbench(id)
  // Deleted defaults never cause another style to be silently substituted.
  return style ? applyStyleRecord(vector, style) : vector
}
export async function deleteLocalStyle(id: string): Promise<void> {
  const record = await getLocalWorkbench(id)
  if (!record || record.kind !== 'style') throw new Error('The selected style no longer exists.')
  const saved = await getLocalWorkbench<StyleDefaults>(STYLE_DEFAULTS_ID)
  if (saved) {
    const defaults = checkedStyleDefaults(saved.data)
    const assignments = Object.fromEntries(Object.entries(defaults.assignments).filter(([, value]) => value !== id))
    await saveLocalWorkbench({ ...saved, data: { ...defaults, assignments } })
  }
  await deleteLocalWorkbench(id)
}
