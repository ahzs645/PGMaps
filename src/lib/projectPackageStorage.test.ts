import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { exportProjectJson } from '@pgmaps/geo-toolkit/projects'
import {
  createLocalProjectRepository,
  importProjectPackageFile,
  loadLocalProjectPackages,
  normalizeProjectPackage,
  projectPackageCodec,
  removeLocalProjectPackage,
  saveLocalProjectPackage,
} from './projectPackages'
const fixture = () =>
  normalizeProjectPackage(JSON.parse(readFileSync('public/data/projects/where-is-north-bc.json', 'utf8')))!
afterEach(() => vi.unstubAllGlobals())
function mountStorage() {
  const values = new Map<string, string>()
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  })
  return values
}
describe('PGMaps host project repository adapter', () => {
  it('preserves the storage key, normalized schema, local flags and portable exports', async () => {
    const values = mountStorage()
    const project = fixture()
    saveLocalProjectPackage(project)
    expect(values.has('pgmaps.projects.local')).toBe(true)
    expect(loadLocalProjectPackages()[0]).toMatchObject({ slug: project.slug, local: true })
    const repository = createLocalProjectRepository()
    expect(await repository.get(project.slug)).toMatchObject({ title: project.title, local: true })
    const artifact = exportProjectJson(project, projectPackageCodec)
    expect(JSON.parse(artifact.content).local).toBeUndefined()
    removeLocalProjectPackage(project.slug)
    expect(loadLocalProjectPackages()).toEqual([])
    const imported = await importProjectPackageFile({ text: async () => artifact.content } as File)
    expect(imported).toMatchObject({ slug: project.slug, local: true })
  })
  it('preserves legacy synchronous fallback while async callers receive storage failure', async () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error('Quota exceeded')
        },
      },
    })
    expect(saveLocalProjectPackage(fixture())).toHaveLength(1)
    await expect(createLocalProjectRepository().save(fixture())).rejects.toThrow('Quota exceeded')
  })
})
