import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { useLayoutEffect } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { usePortalWorkspace } from './usePortalWorkspace'
import { EMPTY_WORKSPACE, type VectorData } from './workspace'

const mocks = vi.hoisted(() => ({
  onSessionChange: undefined as (() => void) | undefined,
  style: vi.fn(),
}))
vi.mock('./usePortalSession', () => ({
  usePortalSession: (onSessionChange: () => void) => {
    mocks.onSessionChange = onSessionChange
    return { canWrite: false, isAdmin: false, revision: 1 }
  },
}))
vi.mock('./styleLibrary', () => ({ applyLocalDefaultStyle: mocks.style }))

let tree: ReactTestRenderer | undefined
let current: ReturnType<typeof usePortalWorkspace>
function Harness() {
  const value = usePortalWorkspace()
  useLayoutEffect(() => {
    current = value
  })
  return null
}
beforeEach(() => {
  mocks.style.mockReset()
  mocks.style.mockImplementation(async (vector: VectorData) => ({ ...vector, color: '#123456' }))
  act(() => {
    tree = create(<Harness />)
  })
})
afterEach(() => {
  act(() => tree?.unmount())
})

const vector = (id: string): VectorData => ({
  id,
  name: id,
  visible: true,
  color: '#aaaaaa',
  data: { type: 'FeatureCollection', features: [] },
})

it('drops session-bound source data on a connection change while retaining the current camera', () => {
  const camera = { ...EMPTY_WORKSPACE.camera, center: [-122, 55] as [number, number], zoom: 9 }
  act(() =>
    current.setWorkspace({ ...EMPTY_WORKSPACE, camera, sessionBound: true, vectors: [vector('private-source')] }),
  )
  act(() => mocks.onSessionChange?.())
  expect(current.workspace.camera).toBe(camera)
  expect(current.workspace.vectors).toEqual([])
  expect(current.workspace.sessionBound).toBeUndefined()
  expect(current.workspace.warnings.join(' ')).toContain('Explicit browser saves remain available')
})

it('retains an explicitly loaded local workspace and a stable session callback', () => {
  const callback = mocks.onSessionChange
  const local = { ...EMPTY_WORKSPACE, vectors: [vector('browser-save')], warnings: ['Source caveat'] }
  act(() => current.setWorkspace(local))
  expect(mocks.onSessionChange).toBe(callback)
  act(() => mocks.onSessionChange?.())
  expect(current.workspace).toBe(local)
})

it('retains every imported vector when styling fails and appends to the latest workspace', async () => {
  let complete: ((value: VectorData) => void) | undefined
  mocks.style.mockImplementationOnce(
    () =>
      new Promise<VectorData>((resolve) => {
        complete = resolve
      }),
  )
  mocks.style.mockRejectedValueOnce(new Error('saved style is unavailable'))
  const first = vector('styled'),
    second = vector('unstyled')
  let addition = Promise.resolve()
  act(() => {
    addition = current.addLocalVectors([first, second])
  })
  act(() =>
    current.setWorkspace({ ...EMPTY_WORKSPACE, vectors: [vector('already-open')], warnings: ['Existing warning'] }),
  )
  await act(async () => {
    complete?.({ ...first, color: '#123456' })
    await addition
  })
  expect(current.workspace.vectors.map((item) => item.id)).toEqual(['already-open', 'styled', 'unstyled'])
  expect(current.workspace.vectors[1].color).toBe('#123456')
  expect(current.workspace.vectors[2]).toBe(second)
  expect(current.workspace.warnings).toEqual([
    'Existing warning',
    'Default style unavailable for unstyled: saved style is unavailable',
  ])
})
