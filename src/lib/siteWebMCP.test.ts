import { describe, expect, it } from 'vitest'

import { findMapExperiences, MAP_EXPERIENCES } from './siteWebMCP'

describe('PGMaps experience discovery', () => {
  it('returns the complete curated catalog for an empty query', () => {
    expect(findMapExperiences()).toEqual(MAP_EXPERIENCES)
    expect(MAP_EXPERIENCES.some((experience) => experience.id === 'food-safety')).toBe(true)
  })

  it('searches titles, descriptions, tags, and maturity stage', () => {
    expect(findMapExperiences('restaurants').map((experience) => experience.id)).toEqual(['food-safety'])
    expect(findMapExperiences('health').map((experience) => experience.id)).toEqual(
      expect.arrayContaining([
        'projects',
        'food-safety',
        'air-quality',
        'index-lab',
        'boundary-explorer',
        'health-services',
      ]),
    )
    expect(findMapExperiences('fieldwork')).toEqual([expect.objectContaining({ id: 'outdoors-planner', stage: 'lab' })])
  })
})
