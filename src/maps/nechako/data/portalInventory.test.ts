import { describe, expect, it } from 'vitest'
import manifestJson from '../../../../public/data/nechako-showcase/manifest.json'
import type { ShowcaseManifest } from './showcase'
import { buildPortalInventory, bundledBytesForKinds, filterPortalInventory } from './portalInventory'

const manifest = manifestJson as ShowcaseManifest

describe('Nechako inventory source coverage', () => {
  it('keeps original source storage unknown while reporting exact listed-file measurements', () => {
    const entries = buildPortalInventory(manifest)
    expect(entries.every((entry) => entry.sourceBytes === null)).toBe(true)
    expect(manifest.files.reduce((sum, file) => sum + file.bytes, 0)).toBe(manifest.snapshot_file_bytes)
    expect(bundledBytesForKinds(manifest, ['research'])).toBe(manifest.research_bytes)
    expect(bundledBytesForKinds(undefined, ['research'])).toBeNull()
    expect(entries.find((entry) => entry.id === 'monitoring')?.bundledBytes).toBeNull()
  })

  it('does not substitute saved-map counts for title-filtered project submissions or story totals', () => {
    const entries = buildPortalInventory(manifest)
    expect(entries.find((entry) => entry.id === 'saved-maps')?.measures[0]).toMatchObject({
      value: 19,
      unit: 'saved map projects',
    })
    expect(entries.find((entry) => entry.id === 'saved-maps')?.measures[1]).toMatchObject({
      value: 9,
      unit: 'visible projects',
    })
    expect(entries.find((entry) => entry.id === 'projects')?.measures[0]).toMatchObject({
      value: 8,
      label: 'Title matches: nechako_projects',
    })
    expect(entries.find((entry) => entry.id === 'stories')?.measures[0].value).toBeNull()
    expect(entries.find((entry) => entry.id === 'research')?.measures.map((measure) => measure.value)).toEqual([
      1408, 767, 51, 1411,
    ])
    expect(entries.find((entry) => entry.id === 'monitoring')?.measures).toEqual([
      expect.objectContaining({ label: 'Earlier native table view', value: 77799 }),
      expect.objectContaining({ label: 'Layer 386 / record 1 live read', value: 25933 }),
      expect.objectContaining({ label: 'Loaded live page', value: 500, unit: 'rows' }),
      expect.objectContaining({ label: 'Decoded page response', value: 197276, unit: 'bytes' }),
      expect.objectContaining({ label: 'Whole monitoring collection', value: null }),
    ])
  })

  it('searches source and coverage evidence and filters local metadata independently from source availability', () => {
    const entries = buildPortalInventory(manifest)
    expect(filterPortalInventory(entries, 'QGIS water', 'all').map((entry) => entry.id)).toEqual(['spatial'])
    expect(filterPortalInventory(entries, 'PDF', 'bundled').map((entry) => entry.id)).toEqual(['media'])
    expect(filterPortalInventory(entries, 'monitoring', 'bundled')).toHaveLength(0)
    expect(filterPortalInventory(entries, 'saved', 'original').some((entry) => entry.id === 'saved-maps')).toBe(true)
  })
})
