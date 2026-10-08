import { describe, expect, it, vi } from 'vitest'
import {
  createProjectCodec,
  createProjectCollectionStore,
  createMemoryProjectRepository,
  createWebStorageProjectRepository,
  exportProject,
  exportProjectJson,
  importProjectFile,
  parseProjectJson,
  shareProject,
} from './projectRepository.js'
interface Example {
  id: string
  title: string
  local?: boolean
}
const codec = createProjectCodec<Example>(
  (value) => {
    if (
      !value ||
      typeof value !== 'object' ||
      !('id' in value) ||
      typeof value.id !== 'string' ||
      !('title' in value) ||
      typeof value.title !== 'string'
    )
      throw new Error('Invalid example project')
    return value as Example
  },
  { id: (project) => project.id, prepareExport: ({ local: _local, ...project }) => project },
)
const storage = () => {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  }
}

describe('portable project storage and transport', () => {
  it('isolates memory snapshots and updates by stable identity', async () => {
    const project = { id: 'one', title: 'First' }
    const repository = createMemoryProjectRepository(codec, [project])
    project.title = 'Mutation after construction'
    expect((await repository.get('one'))?.title).toBe('First')
    const loaded = (await repository.get('one'))!
    loaded.title = 'Mutation after reading'
    await repository.save({ id: 'one', title: 'Updated' })
    expect(await repository.list()).toEqual([{ id: 'one', title: 'Updated' }])
    await repository.remove('one')
    expect(await repository.get('one')).toBeNull()
  })
  it('reopens persisted collections, retains valid siblings and enforces bounded storage', async () => {
    const port = storage()
    port.setItem('projects', JSON.stringify([{ id: 'old', title: 'Old' }, null]))
    const repository = createWebStorageProjectRepository(codec, port, 'projects', { limit: 2 })
    await repository.save({ id: 'one', title: 'One' })
    await repository.save({ id: 'two', title: 'Two' })
    expect(await createWebStorageProjectRepository(codec, port, 'projects').list()).toEqual([
      { id: 'two', title: 'Two' },
      { id: 'one', title: 'One' },
    ])
    expect(() => createProjectCollectionStore(codec, port, 'projects', { limit: -1 })).toThrow()
  })
  it('does not persist invalid imports or imports cancelled while reading', async () => {
    const repository = createMemoryProjectRepository(codec)
    await expect(importProjectFile({ text: async () => '{bad' }, codec, repository)).rejects.toThrow(
      'Not a valid JSON file.',
    )
    await expect(importProjectFile({ text: async () => '{"id":"bad"}' }, codec, repository)).rejects.toThrow(
      'Invalid example project',
    )
    const cancellation = new AbortController()
    const imported = importProjectFile(
      {
        text: async () => {
          cancellation.abort()
          return '{"id":"one","title":"One"}'
        },
      },
      codec,
      repository,
      { signal: cancellation.signal },
    )
    await expect(imported).rejects.toThrow()
    expect(await repository.list()).toEqual([])
  })
  it('reports storage failures rather than claiming successful persistence', async () => {
    const repository = createWebStorageProjectRepository(
      codec,
      {
        getItem: () => null,
        setItem: () => {
          throw Error('Quota exceeded')
        },
      },
      'projects',
    )
    await expect(repository.save({ id: 'one', title: 'One' })).rejects.toThrow('Quota exceeded')
    expect(await repository.list()).toEqual([])
  })
  it('round-trips exports, strips host runtime fields and injects export/share destinations', async () => {
    const artifact = exportProjectJson({ id: '../one', title: 'One', local: true }, codec)
    expect(artifact.filename).toBe('.._one.json')
    expect(parseProjectJson(artifact.content, codec)).toEqual({ id: '../one', title: 'One' })
    const write = vi.fn(async () => {})
    await exportProject({ id: 'one', title: 'One' }, codec, { write })
    expect(write).toHaveBeenCalledOnce()
    expect(
      await shareProject({ id: 'one', title: 'One' }, codec, {
        share: async (value) => ({ url: `https://example.org/${value.filename}` }),
      }),
    ).toEqual({ url: 'https://example.org/one.json' })
    await expect(
      shareProject({ id: 'one', title: 'One' }, codec, {
        share: async () => {
          throw new Error('Offline')
        },
      }),
    ).rejects.toThrow('Offline')
  })
})
