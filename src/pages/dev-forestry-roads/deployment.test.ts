import { describe, expect, it } from 'vitest'
import { PUBLISHED_LIDAR_SAMPLE_BASE, readRoadDesignDeployment } from './deployment'

describe('readRoadDesignDeployment', () => {
  it("keeps PGMaps' own addresses when no variable is set", () => {
    expect(readRoadDesignDeployment({})).toEqual({
      designerPath: '/dev/forestry/road-design',
      blockSheetGallery: '/dev/forestry/block-sheets',
      lidarSampleMirror: PUBLISHED_LIDAR_SAMPLE_BASE,
    })
  })

  it('serves the designer from the root of a site of its own, with no gallery', () => {
    const deployment = readRoadDesignDeployment({
      VITE_ROAD_DESIGN_PATH: '/',
      VITE_ROAD_DESIGN_GALLERY_URL: '',
      VITE_ROAD_DESIGN_LIDAR_MIRROR: 'https://data.example.org/road-design/lidar/',
    })
    expect(deployment).toEqual({
      designerPath: '/',
      blockSheetGallery: null,
      lidarSampleMirror: 'https://data.example.org/road-design/lidar/',
    })
  })

  it('accepts a gallery on another site and drops a trailing slash from the path', () => {
    const deployment = readRoadDesignDeployment({
      VITE_ROAD_DESIGN_PATH: '/design/',
      VITE_ROAD_DESIGN_GALLERY_URL: 'https://pgmaps.example.org/dev/forestry/block-sheets',
    })
    expect(deployment.designerPath).toBe('/design')
    expect(deployment.blockSheetGallery).toBe('https://pgmaps.example.org/dev/forestry/block-sheets')
  })

  it('refuses values that would send the designer somewhere wrong', () => {
    expect(() => readRoadDesignDeployment({ VITE_ROAD_DESIGN_PATH: 'design' })).toThrow('VITE_ROAD_DESIGN_PATH')
    expect(() => readRoadDesignDeployment({ VITE_ROAD_DESIGN_GALLERY_URL: 'http://x.org/g' })).toThrow('GALLERY')
    expect(() => readRoadDesignDeployment({ VITE_ROAD_DESIGN_LIDAR_MIRROR: 'https://x.org/lidar' })).toThrow('MIRROR')
  })
})
