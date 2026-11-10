import { describe, expect, it } from 'vitest'
import config from '@/config/data-hosts.json'
import { dataHostOrigins, parseDataHosts, remoteDataUrl, type DataHost } from './dataHosts'

const HOSTS: DataHost[] = [
  {
    name: 'bcdatamapper',
    baseUrl: 'https://data.example.org/bcdatamapper/data',
    folders: ['census', 'canada/cell-sites', 'restaurants.json'],
  },
  { name: 'r2', baseUrl: 'https://r2.example.org/pgmaps', folders: ['boundaries'] },
]

describe('the checked-in data-hosts config', () => {
  it('parses', () => {
    expect(() => parseDataHosts(config)).not.toThrow()
  })
})

describe('remoteDataUrl', () => {
  it('sends a listed folder to its host, keeping the layout below /data', () => {
    expect(remoteDataUrl('/data/census/catalog.json', HOSTS)).toBe(
      'https://data.example.org/bcdatamapper/data/census/catalog.json',
    )
    expect(remoteDataUrl('/data/boundaries/BCMoH/simplified/health_authorities.json', HOSTS)).toBe(
      'https://r2.example.org/pgmaps/boundaries/BCMoH/simplified/health_authorities.json',
    )
  })

  it('matches sub-folders and single files', () => {
    expect(remoteDataUrl('/data/canada/cell-sites/index.json', HOSTS)).toBe(
      'https://data.example.org/bcdatamapper/data/canada/cell-sites/index.json',
    )
    expect(remoteDataUrl('/data/canada/admin/x.json', HOSTS)).toBeNull()
    expect(remoteDataUrl('/data/restaurants.json', HOSTS)).toBe(
      'https://data.example.org/bcdatamapper/data/restaurants.json',
    )
  })

  it('matches whole path segments only', () => {
    expect(remoteDataUrl('/data/census-old/a.json', HOSTS)).toBeNull()
    expect(remoteDataUrl('/data/restaurants.json.gz', HOSTS)).toBeNull()
  })

  it('keeps tile templates, queries and fragments', () => {
    expect(remoteDataUrl('/data/census/tiles/{z}/{x}/{y}.png', HOSTS)).toBe(
      'https://data.example.org/bcdatamapper/data/census/tiles/{z}/{x}/{y}.png',
    )
    expect(remoteDataUrl('/data/census/a.json?v=3#top', HOSTS)).toBe(
      'https://data.example.org/bcdatamapper/data/census/a.json?v=3#top',
    )
    expect(remoteDataUrl('/data/census?v=3', HOSTS)).toBe('https://data.example.org/bcdatamapper/data/census?v=3')
  })

  it('leaves unlisted folders and non-data paths on this site', () => {
    expect(remoteDataUrl('/data/projects/index.json', HOSTS)).toBeNull()
    expect(remoteDataUrl('/assets/census/a.js', HOSTS)).toBeNull()
    expect(remoteDataUrl('/data/census/a.json', [])).toBeNull()
  })
})

describe('parseDataHosts', () => {
  it('trims a trailing slash from baseUrl', () => {
    expect(parseDataHosts({ hosts: [{ name: 'a', baseUrl: 'https://x.org/data/', folders: [] }] })[0].baseUrl).toBe(
      'https://x.org/data',
    )
  })

  it('rejects a relative or non-http baseUrl', () => {
    expect(() => parseDataHosts({ hosts: [{ name: 'a', baseUrl: '/data', folders: [] }] })).toThrow(/absolute/)
    expect(() => parseDataHosts({ hosts: [{ name: 'a', baseUrl: 'ftp://x.org', folders: [] }] })).toThrow(/absolute/)
  })

  it('rejects folders that are not plain paths below /data', () => {
    for (const folder of ['/census', 'census/', '../secrets', 'a/../b', '', 'a b']) {
      expect(() => parseDataHosts({ hosts: [{ name: 'a', baseUrl: 'https://x.org', folders: [folder] }] })).toThrow(
        /invalid folder/,
      )
    }
  })

  it('rejects a folder claimed twice, or nested inside another host’s folder', () => {
    const twice = { hosts: [{ name: 'a', baseUrl: 'https://x.org', folders: ['census', 'census'] }] }
    expect(() => parseDataHosts(twice)).toThrow(/overlaps/)
    const nested = {
      hosts: [
        { name: 'a', baseUrl: 'https://x.org', folders: ['canada'] },
        { name: 'b', baseUrl: 'https://y.org', folders: ['canada/cell-sites'] },
      ],
    }
    expect(() => parseDataHosts(nested)).toThrow(/overlaps/)
  })

  it('rejects a missing hosts array', () => {
    expect(() => parseDataHosts({})).toThrow(/hosts/)
  })
})

describe('dataHostOrigins', () => {
  it('lists each origin once and skips hosts with no folders', () => {
    expect(
      dataHostOrigins([...HOSTS, { name: 'idle', baseUrl: 'https://idle.example.org/data', folders: [] }]),
    ).toEqual(['https://data.example.org', 'https://r2.example.org'])
  })
})
