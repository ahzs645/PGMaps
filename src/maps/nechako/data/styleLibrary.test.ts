import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { clearLocalWorkbench, getLocalWorkbench, saveLocalWorkbench } from './localWorkbench'
import {
  applyLocalDefaultStyle,
  applyStyleRecord,
  checkedLocalStyleData,
  deleteLocalStyle,
  localStyleDataForVector,
  setLocalStyleDefault,
  STYLE_DEFAULTS_ID,
  type StyleDefaults,
} from './styleLibrary'
import { DEFAULT_STYLE_SYMBOL, type VectorStyle } from './vectorRules'
import type { VectorData } from './workspace'

const style: VectorStyle = {
  schema: 'nechako-vector-style-v1',
  geometry: 'point',
  mode: 'single',
  base: { ...DEFAULT_STYLE_SYMBOL, fillColor: '#ff0000', pointOpacity: 0 },
}
const vector: VectorData = {
  id: 'source-id',
  name: 'Imported',
  color: '#000000',
  visible: true,
  data: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 0,
        properties: { value: 0, text: '0', missing: null, active: false },
        geometry: { type: 'Point', coordinates: [-124, 54] },
      },
    ],
  },
}
beforeEach(() => clearLocalWorkbench())
describe('browser-local style persistence and defaults', () => {
  it('applies saved styles without changing IDs/geometry/properties and retains original SLD', async () => {
    const original = '<retained>✓</retained>'
    const record = await saveLocalWorkbench({
      kind: 'style',
      name: 'Map style',
      data: { schema: 'nechako-local-style-v1', style, originalSld: original, diagnostics: [] },
      blob: new Blob([original]),
    })
    const applied = applyStyleRecord(vector, record)
    expect(applied.data).toBe(vector.data)
    expect(applied.id).toBe(vector.id)
    expect(applied.style).toEqual(style)
    expect(applied.styleSource?.original).toBe(original)
    expect(await (await getLocalWorkbench(record.id))!.blob!.text()).toBe(original)
    const edited = { ...style, base: { ...style.base, fillColor: '#00ff00' } }
    const saved = localStyleDataForVector(applied, edited)
    expect(saved.originalSld).toBe(original)
    expect(saved.style).toEqual(edited)
    expect(saved.diagnostics.some((item) => item.message.includes('may include edits'))).toBe(true)
  })
  it('uses schema defaults before geometry defaults and keeps explicit styling intact', async () => {
    const point = await saveLocalWorkbench({
      kind: 'style',
      name: 'Points',
      data: { schema: 'nechako-local-style-v1', style, diagnostics: [] },
    })
    const schemaStyle = { ...style, base: { ...style.base, fillColor: '#00ff00' } }
    const schema = await saveLocalWorkbench({
      kind: 'style',
      name: 'Schema',
      data: { schema: 'nechako-local-style-v1', style: schemaStyle, diagnostics: [] },
    })
    await setLocalStyleDefault('point', point.id)
    await setLocalStyleDefault('schema:12', schema.id)
    expect((await applyLocalDefaultStyle(vector)).style).toEqual(style)
    expect((await applyLocalDefaultStyle(vector, '12')).style).toEqual(schemaStyle)
    const styled = { ...vector, style }
    expect(await applyLocalDefaultStyle(styled, '12')).toBe(styled)
    expect(
      await applyLocalDefaultStyle({ ...vector, categories: { property: 'v', fallback: '#000000', rules: [] } }, '12'),
    ).toHaveProperty('categories')
    await expect(setLocalStyleDefault('polygon', point.id)).rejects.toThrow('geometry')
  })
  it('deletes default assignments with the saved style but never modifies applied layers', async () => {
    const record = await saveLocalWorkbench({
      kind: 'style',
      name: 'One',
      data: { schema: 'nechako-local-style-v1', style, diagnostics: [] },
    })
    await setLocalStyleDefault('point', record.id)
    const applied = await applyLocalDefaultStyle(vector)
    await deleteLocalStyle(record.id)
    expect(await getLocalWorkbench(record.id)).toBeUndefined()
    expect((await getLocalWorkbench<StyleDefaults>(STYLE_DEFAULTS_ID))?.data.assignments).toEqual({})
    expect(applied.style).toEqual(style)
    expect(await applyLocalDefaultStyle(vector)).toBe(vector)
  })
  it('keeps unsupported SLD originals exportable while refusing application/default assignment', async () => {
    const data = checkedLocalStyleData({
      schema: 'nechako-local-style-v1',
      originalSld: '<TextSymbolizer/>',
      diagnostics: [{ severity: 'error', message: 'Text unsupported' }],
    })
    const record = await saveLocalWorkbench({ kind: 'style', name: 'Unsupported original', data })
    expect(() => applyStyleRecord(vector, record)).toThrow('unsupported')
    await expect(setLocalStyleDefault('point', record.id)).rejects.toThrow('supported')
    expect((await getLocalWorkbench(record.id))?.data).toEqual(data)
    expect(() => checkedLocalStyleData({ ...data, style })).toThrow('unresolved')
  })
})
