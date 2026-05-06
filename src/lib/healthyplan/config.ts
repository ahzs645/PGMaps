import type { HealthyPlanColourRamp, HealthyPlanVariableScale } from './types'

export const HEALTHYPLAN_EQUITY_PRIORITY_RAMP: readonly string[] = [
  '#ffecbf',
  '#fce4ae',
  '#fada9b',
  '#f7d18b',
  '#f5ca7a',
  '#d4967a',
  '#b36666',
  '#913959',
  '#73004d',
]

export const HEALTHYPLAN_COLOUR_RAMPS: readonly HealthyPlanColourRamp[] = [
  {
    id: 'default',
    stops: HEALTHYPLAN_EQUITY_PRIORITY_RAMP,
  },
  {
    id: 'tcc',
    stops: [
      '#e64c00',
      '#e64c00',
      '#f06e29',
      '#fa914b',
      '#ffb370',
      '#ffd899',
      '#62c4a4',
      '#5bb595',
      '#53a689',
      '#4d997d',
      '#458a6f',
    ],
  },
  {
    id: 'lst',
    stops: [
      '#6699cc',
      '#6699cc',
      '#78a9d6',
      '#8dbbe3',
      '#a1cced',
      '#b6e0fa',
      '#e1d69c',
      '#e1a973',
      '#fc7d4e',
      '#f5502f',
      '#e81014',
    ],
  },
  {
    id: 'pollution',
    stops: [
      '#218291',
      '#589d9d',
      '#89b8a8',
      '#b6d3b1',
      '#e9f2ba',
      '#f5e9a8',
      '#e0c080',
      '#c8975b',
      '#b4763c',
      '#9e561f',
    ],
  },
  {
    id: 'fsi',
    stops: [
      '#697FCF',
      '#697FCF',
      '#97A1CC',
      '#BFC3C7',
      '#ECEDC2',
      '#FAE7AC',
      '#F0BC8B',
      '#E3926D',
      '#D66C51',
      '#C44539',
    ],
  },
  {
    id: 'demographic',
    stops: ['#47a7c9', '#a1d8ed', '#bbf0f0', '#ffebbf', '#ffd37f', '#ffaa00', '#e64c00'],
  },
]

export const HEALTHYPLAN_VARIABLE_SCALES: readonly HealthyPlanVariableScale[] = [
  {
    variableId: 'tcc',
    label: 'Tree canopy cover',
    kind: 'environment',
    colourRampId: 'tcc',
    stops: [0, 0.8, 4, 8, 11, 16, 21, 26, 33, 44],
    format: 'percent',
    benefitDirection: 'higherIsBetter',
  },
  {
    variableId: 'lstmax',
    label: 'Summer land surface temperature',
    kind: 'environment',
    colourRampId: 'lst',
    stops: [1, 23, 25, 26, 27, 28, 29, 30, 31, 33, 43],
    format: 'temperatureC',
    benefitDirection: 'lowerIsBetter',
  },
  {
    variableId: 'annno2',
    label: 'NO2 air pollution',
    kind: 'environment',
    colourRampId: 'pollution',
    stops: [0, 3.87, 4.75, 5.41, 6.05, 6.69, 7.31, 7.9, 8.53, 9.37],
    format: 'ppb',
    benefitDirection: 'lowerIsBetter',
  },
  {
    variableId: 'fsi',
    label: 'Flood susceptibility',
    kind: 'environment',
    colourRampId: 'fsi',
    stops: [0, 5, 8, 12, 18, 24, 31, 40, 53, 74, 100],
    format: 'index',
    benefitDirection: 'lowerIsBetter',
  },
  {
    variableId: 'vismin',
    label: 'Visible minority',
    kind: 'demographic',
    colourRampId: 'demographic',
    stops: [0, 0.1, 0.22, 0.35, 0.5, 0.66, 0.82],
    format: 'ratio',
    benefitDirection: 'lowerIsBetter',
  },
]

export function getHealthyPlanColourRamp(id: string): HealthyPlanColourRamp | undefined {
  return HEALTHYPLAN_COLOUR_RAMPS.find((ramp) => ramp.id === id)
}

export function getHealthyPlanVariableScale(variableId: string): HealthyPlanVariableScale | undefined {
  return HEALTHYPLAN_VARIABLE_SCALES.find((scale) => scale.variableId === variableId)
}
