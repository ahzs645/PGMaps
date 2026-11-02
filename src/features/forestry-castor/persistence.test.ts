import { describe, expect, it } from 'vitest'
import { runCastor } from './engine'
import { castorConfig, createExampleProject } from './inputs'
import {
  clearCastorDraft,
  loadCastorDraft,
  parseCastorSession,
  saveCastorDraft,
  serializeCastorSession,
} from './persistence'
import { CASTOR_MODEL_VERSION } from './types'

describe('Castor scenario and session recovery', () => {
  it('round-trips the exact inputs and overridden settings, retaining outputs only in the file', () => {
    const project = createExampleProject()
    project.provenance.notes.push('سيناريو توضيحي — reviewed locally')
    const config = castorConfig(project, {
      scenario: 'A reviewed alternative — 2035',
      periods: 4,
      stepYears: 10,
      startYear: 2035,
      targetMultiplier: 0.75,
      blockPriority: [{ field: 'volume', direction: 'asc' }],
      uncertainty: { enabled: true, replicates: 25, coefficientOfVariation: 0.2, seed: 671 },
    })
    const result = runCastor(project, config)
    const saved = serializeCastorSession(project, config, result)
    const serialized = JSON.parse(saved)
    expect(serialized.schema).toBe('pgmaps-castor-session-v1')
    expect(serialized.modelVersion).toBe(CASTOR_MODEL_VERSION)
    expect(serialized.result.snapshots).toEqual(result.snapshots)
    const restored = parseCastorSession(saved)
    expect(restored.project).toEqual(JSON.parse(JSON.stringify(project)))
    expect(restored.config).toEqual(config)
    expect(restored.result).toBeUndefined()
    expect(restored.resultOmitted).toBe(true)
    const rerun = runCastor(restored.project, restored.config)
    expect(rerun.summary).toEqual(result.summary)
    expect(rerun.snapshots).toEqual(result.snapshots)
    expect(rerun.uncertainty).toEqual(result.uncertainty)
  })

  it('keeps a standalone project recoverable with its configured defaults', () => {
    const project = createExampleProject()
    const restored = parseCastorSession(JSON.stringify(project))
    expect(restored.project.name).toBe(project.name)
    expect(restored.config).toEqual(castorConfig(project))
    expect(restored.result).toBeUndefined()
    expect(restored.resultOmitted).toBeUndefined()
  })

  it('does not trust or render a supplied result as if it were verified computation', () => {
    const project = createExampleProject()
    const untrusted = {
      schema: 'pgmaps-castor-session-v1',
      modelVersion: CASTOR_MODEL_VERSION,
      project,
      config: castorConfig(project),
      result: { modelVersion: 'unknown-model', snapshots: 'corrupt', summary: { harvestedM3: 1e300 } },
    }
    const restored = parseCastorSession(JSON.stringify(untrusted))
    expect(restored.result).toBeUndefined()
    expect(restored.resultOmitted).toBe(true)
    expect(restored.config.scenario).toBe(project.config?.scenario)
  })

  it('rejects malformed sessions, missing projects and invalid restored configuration', () => {
    const project = createExampleProject()
    for (const source of [
      '',
      '[]',
      'null',
      '{"schema":"other-v1"}',
      JSON.stringify({ schema: 'pgmaps-castor-session-v1', project, config: [] }),
    ])
      expect(() => parseCastorSession(source)).toThrow()
    const invalid = { schema: 'pgmaps-castor-session-v1', project, config: { ...castorConfig(project), periods: -1 } }
    expect(() => parseCastorSession(JSON.stringify(invalid))).toThrow(/periods/)
    expect(() => parseCastorSession(JSON.stringify({ ...invalid, project: null }))).toThrow(/project/i)
  })

  it('reports unavailable local storage with an actionable session-export fallback', async () => {
    expect(typeof indexedDB).toBe('undefined')
    const project = createExampleProject()
    await expect(saveCastorDraft(project, castorConfig(project))).rejects.toThrow(/Export a session JSON/)
    await expect(loadCastorDraft()).rejects.toThrow(/Export a session JSON/)
    await expect(clearCastorDraft()).rejects.toThrow(/Export a session JSON/)
  })
})
