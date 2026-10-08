import type { ProjectSceneDef, ProjectStoryLayerDef } from '@pgmaps/geo-toolkit/projects'
import { calculateIndex, habitatCategories, scoreScale, scoreLegend } from './data'

export interface AtlasProject {
  id: string
  title: string
  summary: string
  scenes: ProjectSceneDef[]
  layers: ProjectStoryLayerDef[]
}

const paint = {
  idProperty: 'id',
  labelProperty: 'label',
  fillColor: '#21918c',
  fillOpacity: 0.75,
  lineColor: '#153445',
  lineOpacity: 0.7,
  lineWidth: 1,
}

export const initialProject: AtlasProject = {
  id: 'willow-bay-outdoor-story',
  title: 'An outdoor atlas in three scenes',
  summary: 'Two different observations help us ask different questions about outdoor space.',
  layers: [
    {
      id: 'districts',
      data: 'local:districts',
      ...paint,
      attribution: 'Fictional example districts',
      category: {
        property: 'id',
        colors: Object.fromEntries(
          calculateIndex(60).map((result) => [result.record.id, scoreScale.colorForValue(result.score)]),
        ),
        fallback: scoreScale.missingColor,
      },
    },
    {
      id: 'habitats',
      data: 'local:habitats',
      ...paint,
      attribution: 'Fictional example classified grid',
      category: {
        property: 'value',
        colors: {
          ...Object.fromEntries(habitatCategories.map((category, value) => [String(value), category.color])),
          '-2': '#df91b9',
          '-1': '#667085',
        },
        fallback: '#a0a0a0',
      },
    },
  ],
  scenes: [
    {
      label: 'District access',
      title: 'Start with access',
      text: 'An index combines park access with tree shade.',
      focus: 'Access and shade',
      visibleLayerIds: ['districts'],
      camera: { center: [-2.75, 50.95], zoom: 6.2 },
      legend: scoreLegend.bins.map((bin) => ({
        label: `${bin.min.toFixed(2)}–${bin.max.toFixed(2)}`,
        color: bin.color,
      })),
    },
    {
      label: 'Habitat mosaic',
      title: 'Look at habitat',
      text: 'These source cells show categories, including uncertainty and missing observations.',
      focus: 'Habitat categories',
      visibleLayerIds: ['habitats'],
      camera: { center: [-2.8, 50.7], zoom: 5.8 },
      legend: [
        { label: 'Woodland', color: '#21918c' },
        { label: 'Meadow', color: '#f4c46b' },
        { label: 'Wetland', color: '#7387dc' },
        { label: 'Uncertain observation', color: '#df91b9' },
        { label: 'No observation', color: '#667085' },
      ],
    },
    {
      label: 'Shared view',
      title: 'Bring the observations together',
      text: 'Seeing the two sources together does not change the meaning of either measurement.',
      focus: 'A shared map',
      visibleLayerIds: ['districts', 'habitats'],
      camera: { center: [-2.75, 50.95], zoom: 5.8 },
    },
  ],
}
