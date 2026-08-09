import { describe, expect, it } from 'vitest'
import { buildUpdateReloadUrl } from './useAppUpdate'

describe('buildUpdateReloadUrl', () => {
  it('adds a cache-busting update token without losing the route state', () => {
    const result = new URL(buildUpdateReloadUrl('https://pgmaps.example/dev/projects?filter=maps#details', 1234))

    expect(result.pathname).toBe('/dev/projects')
    expect(result.searchParams.get('filter')).toBe('maps')
    expect(result.searchParams.get('_update')).toBe('1234')
    expect(result.hash).toBe('#details')
  })

  it('replaces an earlier update token', () => {
    const result = new URL(buildUpdateReloadUrl('https://pgmaps.example/?_update=old', 5678))
    expect(result.searchParams.getAll('_update')).toEqual(['5678'])
  })
})
