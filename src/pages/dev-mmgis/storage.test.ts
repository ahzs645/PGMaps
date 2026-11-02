import { describe, expect, it } from 'vitest'
import { demoMission } from './demo'
import { MAX_TEXT, readMissionJson, STORAGE_KEY, UNREADABLE_BACKUP_KEY } from './missionCodec'
import { copyLabel, makeLayer } from './model'
import { captureSite } from './sites'
import { loadStoredMission } from './useMission'

const memory = (entries: Record<string, string> = {}) => {
  const data = new Map(Object.entries(entries))
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  }
}

describe('values the workbench creates survive a save and reload', () => {
  it('keeps cameras MapLibre can reach below zoom 0, on the mission and on saved sites', () => {
    const mission = demoMission()
    mission.camera = { center: [-122.75, 53.92], zoom: -0.39, bearing: 0, pitch: 0 }
    mission.bookmarks = [captureSite(mission, 'World', { ...mission.camera, zoom: -2 })]
    const restored = readMissionJson(JSON.stringify(mission))
    expect(restored.camera.zoom).toBe(-0.39)
    expect(restored.bookmarks[0].camera.zoom).toBe(-2)
    expect(() => readMissionJson(JSON.stringify({ ...mission, camera: { ...mission.camera, zoom: -3 } }))).toThrow()
  })

  it('shortens long file-name and copy labels where they are created', () => {
    const mission = demoMission()
    const layer = makeLayer(`${'survey-'.repeat(40)}final`, { type: 'FeatureCollection', features: [] })
    expect(layer.label.length).toBeLessThanOrEqual(MAX_TEXT)
    const copy = { ...layer, id: 'copy', label: copyLabel(layer.label) }
    expect(copy.label.length).toBeLessThanOrEqual(MAX_TEXT)
    expect(copy.label.endsWith(' copy')).toBe(true)
    mission.layers.push(layer, copy)
    expect(
      readMissionJson(JSON.stringify(mission))
        .layers.slice(-2)
        .map((l) => l.label),
    ).toEqual([layer.label, copy.label])
    // A surrogate pair is not split at the limit.
    expect(makeLayer(`${'a'.repeat(MAX_TEXT - 1)}🗺️`, mission.layers[0].data).label).toBe('a'.repeat(MAX_TEXT - 1))
  })

  it('re-imports missions saved before labels were shortened', () => {
    const mission = demoMission()
    mission.layers[0].label = 'x'.repeat(230)
    mission.name = 'y'.repeat(230)
    const restored = readMissionJson(JSON.stringify(mission))
    expect(restored.layers[0].label).toBe('x'.repeat(MAX_TEXT))
    expect(restored.name).toBe('y'.repeat(MAX_TEXT))
  })

  it('keeps long attribute names chosen as time, name, style and filter fields', () => {
    const key = `measured_${'k'.repeat(300)}`
    const mission = demoMission()
    Object.assign(mission.layers[0], {
      timeProperty: key,
      nameKey: key,
      style: { type: 'simple', color: '#336699' },
      filter: { column: key, values: ['a'] },
    })
    mission.layers[1].style = {
      type: 'categories',
      column: key,
      categories: [{ value: 'a', color: '#336699' }],
      otherColor: null,
    }
    const [first, second] = readMissionJson(JSON.stringify(mission)).layers
    expect([first.timeProperty, first.nameKey, first.filter?.column]).toEqual([key, key, key])
    expect(second.style?.type === 'categories' && second.style.column).toBe(key)
  })
})

describe('an unreadable saved workspace', () => {
  it('is backed up and left in place while the example opens', () => {
    const raw = JSON.stringify({ ...demoMission(), name: 'My survey', camera: { center: [0, 0], zoom: -9 } })
    const storage = memory({ [STORAGE_KEY]: raw })
    const loaded = loadStoredMission(storage)
    expect(loaded.mission.name).toBe(demoMission().name)
    expect(loaded.preserveStored).toBe(true)
    expect(loaded.error).toMatch(/could not be read/)
    expect(loaded.error).toMatch(/kept on this device until you make a change/)
    expect(storage.data.get(STORAGE_KEY)).toBe(raw)
    expect(storage.data.get(UNREADABLE_BACKUP_KEY)).toBe(raw)
  })

  it('opens readable and missing workspaces normally', () => {
    const mission = { ...demoMission(), name: 'My survey' }
    const readable = loadStoredMission(memory({ [STORAGE_KEY]: JSON.stringify(mission) }))
    expect([readable.mission.name, readable.preserveStored, readable.error]).toEqual(['My survey', false, ''])
    const empty = loadStoredMission(memory())
    expect([empty.mission.name, empty.preserveStored, empty.error]).toEqual([demoMission().name, false, ''])
  })

  it('still opens the example when storage cannot be read or written', () => {
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    const loaded = loadStoredMission(blocked)
    expect(loaded.mission.layers.length).toBeGreaterThan(0)
    const unreadable = loadStoredMission({ getItem: () => '{', setItem: blocked.setItem })
    expect(unreadable.preserveStored).toBe(true)
  })
})
