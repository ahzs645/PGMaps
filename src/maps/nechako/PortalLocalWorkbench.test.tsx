import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { PortalLocalWorkbench } from './PortalLocalWorkbench'
import { createLocalWorkbenchBundle, readLocalWorkbenchBundle } from './data/localWorkbenchBundle'
import type { LocalWorkbenchRecord } from './data/localWorkbench'
import { EMPTY_WORKSPACE } from './data/workspace'

const fixtures = vi.hoisted(() => ({ records: [] as LocalWorkbenchRecord[] }))
vi.mock('./data/useLocalWorkbench', () => ({
  useLocalWorkbenchRecords: () => ({ records: fixtures.records, loading: false, error: '', reload: vi.fn() }),
}))
vi.mock('./data/localWorkbench', async (original) => ({
  ...(await original<typeof import('./data/localWorkbench')>()),
  localWorkbenchStorage: async () => ({}),
}))
function text(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map(text).join('')
}
let tree: ReactTestRenderer | undefined
afterEach(() => {
  if (tree) act(() => tree!.unmount())
  tree = undefined
  fixtures.records = []
})

it('keeps malformed restored project history inspectable while valid saves still open', async () => {
  const raw = {
    schema: 'nechako-local-project-v1',
    workspace: EMPTY_WORKSPACE,
    history: [
      null,
      { savedAt: '2026-10-21T12:00:00Z', workspace: { schema: 'nechako-workspace-v1', camera: null } },
      { savedAt: { original: 'unrecognized date' }, workspace: { ...EMPTY_WORKSPACE, sessionBound: true } },
    ],
  }
  const record: LocalWorkbenchRecord = {
    id: 'restored-project',
    kind: 'project',
    name: 'Restored project fixture',
    createdAt: '2026-10-21T12:00:00Z',
    updatedAt: '2026-10-21T12:00:00Z',
    data: raw,
    bytes: 0,
    source: { access: 'private' },
  }
  const bundle = await createLocalWorkbenchBundle({ records: [record] })
  fixtures.records = (await readLocalWorkbenchBundle(bundle.blob)).records
  const open = vi.fn()
  await act(async () => {
    tree = create(<PortalLocalWorkbench workspace={EMPTY_WORKSPACE} onWorkspace={open} />)
  })
  act(() => tree!.root.findByProps({ 'aria-label': 'Local project' }).props.onChange({ target: { value: record.id } }))
  expect(text(tree!.root)).toContain('Save 3 cannot be opened')
  expect(text(tree!.root)).toContain('Save 2 cannot be opened')
  expect(text(tree!.root)).toContain('Its original entry is retained in Saved items and backups.')
  const validSave = tree!.root.findAllByType('button').find((node) => text(node).includes('Open save 1'))
  expect(validSave).toBeDefined()
  expect(text(validSave!)).toContain('Save date unavailable')
  act(() => validSave!.props.onClick())
  expect(open).toHaveBeenCalledWith({ ...EMPTY_WORKSPACE, sessionBound: false })
  expect(fixtures.records[0].data).toEqual(raw)
  expect(fixtures.records[0].source?.access).toBe('private')
})
