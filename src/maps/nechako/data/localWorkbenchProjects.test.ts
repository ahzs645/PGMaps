import { describe, expect, it } from 'vitest'
import {
  checkLocalWorkbenchSchema,
  createLocalWorkbenchProject,
  LOCAL_SCHEMA_TEMPLATE,
  openLocalWorkbenchProject,
} from './localWorkbenchProjects'
import { EMPTY_WORKSPACE } from './workspace'
import type { LocalWorkbenchRecord } from './localWorkbench'

describe('explicit local projects and schema definitions', () => {
  it('restores saved private content independently of source logout and retains original source IDs', () => {
    const workspace = { ...EMPTY_WORKSPACE, sessionBound: true, originalProject: { source_id: 'native-005' } }
    const data = createLocalWorkbenchProject(workspace)
    const record: LocalWorkbenchRecord = {
      id: 'local-project',
      kind: 'project',
      name: 'Private local copy',
      data,
      createdAt: '2026-10-21T00:00:00Z',
      updatedAt: '2026-10-21T00:00:00Z',
      bytes: 0,
      source: { access: 'private' },
    }
    expect(data.workspace.sessionBound).toBe(false)
    expect(openLocalWorkbenchProject(record)).toMatchObject({
      sessionBound: false,
      originalProject: { source_id: 'native-005' },
    })
    const next = createLocalWorkbenchProject({ ...workspace, camera: { ...workspace.camera, zoom: 9 } }, record)
    expect(next.history).toHaveLength(1)
    expect(next.history[0].workspace.camera.zoom).toBe(workspace.camera.zoom)
    expect(record.source?.access).toBe('private')
  })
  it('accepts typed local schemas and unchanged source-native field definitions', () => {
    expect(checkLocalWorkbenchSchema(LOCAL_SCHEMA_TEMPLATE).fields.map((field) => field.id)).toEqual([
      'site_name',
      'measurement',
      'observed_on',
    ])
    const native = [
      { attr_id: 456, attr_name: 'Area', attr_type: 'double precision', source_extra: { untouched: false } },
    ]
    expect(checkLocalWorkbenchSchema(native).fields[0]).toMatchObject({
      id: '456',
      type: 'double precision',
      source: native[0],
    })
    expect(() =>
      checkLocalWorkbenchSchema({
        ...LOCAL_SCHEMA_TEMPLATE,
        fields: [
          { id: 'duplicate', name: 'First', type: 'text' },
          { id: 'duplicate', name: 'Second', type: 'text' },
        ],
      }),
    ).toThrow('unique')
    expect(() =>
      checkLocalWorkbenchSchema({
        ...LOCAL_SCHEMA_TEMPLATE,
        fields: [{ id: 'field', name: 'Field', type: 'unverified-widget' }],
      }),
    ).toThrow('Unsupported local field type')
    expect(() => checkLocalWorkbenchSchema({ ...LOCAL_SCHEMA_TEMPLATE, geometryType: 'Invented' })).toThrow(
      'geometryType',
    )
  })
})
