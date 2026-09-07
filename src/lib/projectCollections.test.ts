import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ProjectPackage } from './projectPackages'
import {
  PROJECT_COLLECTIONS,
  collectionHref,
  collectionMembers,
  getCollectionForProject,
  getProjectCollection,
  summarizeCollections,
} from './projectCollections'

const packages = readdirSync('public/data/projects')
  .filter((name) => name.endsWith('.json') && name !== 'index.json')
  .map((name) => JSON.parse(readFileSync(`public/data/projects/${name}`, 'utf8')) as ProjectPackage)

describe('project collections', () => {
  it('has unique, valid folder slugs and existing members with one parent each', () => {
    const slugs = PROJECT_COLLECTIONS.map((c) => c.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    const allMembers = PROJECT_COLLECTIONS.flatMap((c) => [...c.projectSlugs])
    expect(new Set(allMembers).size).toBe(allMembers.length)
    for (const collection of PROJECT_COLLECTIONS) {
      expect(collection.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      expect(collection.title.trim()).not.toBe('')
      expect(collectionMembers(collection, packages)).toHaveLength(collection.projectSlugs.length)
    }
  })

  it('includes every climate category, Northern Health, and EchoScreen', () => {
    const climate = getProjectCollection('bc-climate-health')!
    const expected = packages.filter(
      (p) =>
        p.slug.startsWith('bc-climate-') ||
        ['northern-health-climate-resilience', 'echoscreen-climate-health'].includes(p.slug),
    )
    expect([...climate.projectSlugs].sort()).toEqual(expected.map((p) => p.slug).sort())
    expect(climate.projectSlugs).toHaveLength(20)
    expect(climate.projectSlugs[0]).toBe('northern-health-climate-resilience')
  })

  it('orders members without copying, loading, or changing their packages', () => {
    const climate = getProjectCollection('bc-climate-health')!
    const members = collectionMembers(climate, [...packages].reverse())
    expect(members.map((p) => p.slug)).toEqual(climate.projectSlugs)
    expect(members[0]).toBe(packages.find((p) => p.slug === climate.projectSlugs[0]))
    expect(getCollectionForProject('bc-climate-wettest-day')).toBe(climate)
    expect(getCollectionForProject('bc-big-tree-registry')).toBeUndefined()
  })

  it('counts only loaded and matching packages, hides empty folders', () => {
    const match = packages.filter((p) => p.slug === 'bc-climate-wettest-day')
    expect(summarizeCollections(packages, match)).toMatchObject([{ count: 1, total: 20 }])
    expect(summarizeCollections([], [])).toEqual([])
    expect(summarizeCollections(packages, [])).toEqual([])
    expect(collectionMembers(PROJECT_COLLECTIONS[0], match)).toEqual(match)
  })

  it('uses shareable folder URLs and treats unknown folders explicitly', () => {
    expect(collectionHref('bc-climate-health')).toBe('/dev/projects?collection=bc-climate-health')
    expect(getProjectCollection('unknown')).toBeUndefined()
    expect(getProjectCollection(null)).toBeUndefined()
  })
})
