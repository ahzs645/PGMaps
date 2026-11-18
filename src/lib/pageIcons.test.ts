import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import config from '@/config/page-icons.json'
import { iconType, pageIconFor, parsePageIcons } from './pageIcons'

const icons = parsePageIcons(config)

describe('page icons', () => {
  it('gives the road designer and its help the DDC Access tile', () => {
    expect(pageIconFor(icons, '/dev/forestry/road-design')).toBe('brand/access.svg')
    expect(pageIconFor(icons, '/dev/forestry/road-design/')).toBe('brand/access.svg')
    expect(pageIconFor(icons, '/help')).toBe('brand/access.svg')
    expect(pageIconFor(icons, '/help/first-road')).toBe('brand/access.svg')
  })

  it('keeps every other page on the default', () => {
    expect(pageIconFor(icons, '/')).toBe('favicon.svg')
    expect(pageIconFor(icons, '/dev/forestry')).toBe('favicon.svg')
    expect(pageIconFor(icons, '/dev/forestry/visual-quality')).toBe('favicon.svg')
    expect(pageIconFor(icons, '/helpers')).toBe('favicon.svg')
  })

  it('lets the longest listed path win', () => {
    const nested = parsePageIcons({
      default: 'favicon.svg',
      routes: [
        { path: '/dev', icon: 'a.svg' },
        { path: '/dev/forestry', icon: 'b.svg' },
      ],
    })
    expect(pageIconFor(nested, '/dev/forestry/castor')).toBe('b.svg')
    expect(pageIconFor(nested, '/dev/gov')).toBe('a.svg')
  })

  it('names only files that exist in public/', () => {
    for (const icon of [icons.default, ...icons.routes.map((route) => route.icon)])
      expect(existsSync(join(__dirname, '..', '..', 'public', icon)), icon).toBe(true)
  })

  it('refuses paths and files it cannot use', () => {
    expect(() => parsePageIcons({ default: '../x.svg', routes: [] })).toThrow()
    expect(() => parsePageIcons({ default: 'favicon.svg', routes: [{ path: 'help', icon: 'a.svg' }] })).toThrow()
    expect(() => parsePageIcons({ default: 'favicon.svg', routes: [{ path: '/help/', icon: 'a.svg' }] })).toThrow()
    expect(() => parsePageIcons({ default: 'favicon.svg', routes: [{ path: '/help', icon: 'a.gif' }] })).toThrow()
  })

  it('states the file type', () => {
    expect(iconType('brand/access.svg')).toBe('image/svg+xml')
    expect(iconType('icons/x.png')).toBe('image/png')
  })
})
