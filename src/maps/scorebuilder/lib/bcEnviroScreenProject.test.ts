import { describe, expect, it } from 'vitest'
import projectDocument from '../../../../public/data/projects/scorebuilder/preset-bc-enviro-screen-reconstruction.json'
import { buildProjectLabParams, normalizeProjectPackage, projectLabWeights } from '@/lib/projectPackages'
import { getScoreDataSourcesForWeights } from '../constants'
import { createInitialScoreBuilderState } from '../hooks/scoreBuilderReducer'

describe('BC EnviroScreen project handoff', () => {
  it('opens Index Lab with the LHA boundary, dedicated method, source, and component weights', () => {
    const project = normalizeProjectPackage(projectDocument)
    expect(project).not.toBeNull()
    const params = buildProjectLabParams(project!)
    expect(params?.get('src')).toBe('bcHealth')
    expect(params?.get('level')).toBe('lha')
    expect(params?.get('agg')).toBe('bcEnviroScreenProduct')
    expect(params?.get('ds')).toBe('bcEnviroScreen')
    expect(params?.get('bcExp')).toBe('1')
    expect(params?.get('bcEff')).toBe('0.5')
    expect(params?.get('bcSens')).toBe('1')
    expect(params?.get('bcSoc')).toBe('1')
    expect(params?.get('bcFormulaMode')).toBe('reconstruction')
    const state = createInitialScoreBuilderState(params!)
    expect(state.enabledDataSources).toContain('bcEnviroScreen')
    expect(state.methodSettings.bcEnviroScreenFormula).toEqual({
      mode: 'reconstruction',
      expression: 'landscape_burden * population_characteristics',
    })
  })

  it('derives the release source from the preset weights', () => {
    const project = normalizeProjectPackage(projectDocument)
    expect(getScoreDataSourcesForWeights(projectLabWeights(project!.lab!))).toEqual(['bcEnviroScreen'])
  })

  it('round-trips an advanced formula through the project handoff URL', () => {
    const customDocument = structuredClone(projectDocument)
    customDocument.lab.bcEnviroScreenFormula = { mode: 'custom', expression: 'pm25 * 100' }
    const project = normalizeProjectPackage(customDocument)
    const params = buildProjectLabParams(project!)
    expect(params?.get('bcFormulaMode')).toBe('custom')
    expect(params?.get('bcFormula')).toBe('pm25 * 100')
    expect(createInitialScoreBuilderState(params!).methodSettings.bcEnviroScreenFormula).toEqual({
      mode: 'custom',
      expression: 'pm25 * 100',
    })
  })
})
