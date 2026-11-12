/** The detail picker and ribbon open the same set of road views. */
export const roadDetailViews = [
  {
    value: 'section',
    label: 'Section',
    title: 'Cross-section',
    command: 'crossSection',
  },
  { value: 'terrain', label: '3D', title: '3D terrain', command: 'terrain3d' },
  {
    value: 'mass',
    label: 'Mass haul',
    title: 'Mass haul',
    command: 'massHaul',
    roadOnly: true,
  },
  {
    value: 'table',
    label: 'Stations',
    title: 'Station schedule',
    command: 'stations',
  },
  {
    value: 'compare',
    label: 'Compare',
    title: 'Compare alternatives',
    command: 'compare',
  },
  {
    value: 'cable',
    label: 'D-line',
    title: 'D-line clearance',
    command: 'cableProfile',
  },
  {
    value: 'pegs',
    label: 'Pegs',
    title: 'Pegging data',
    command: 'peggingData',
    roadOnly: true,
  },
  {
    value: 'engineering',
    label: 'Quantities',
    title: 'Engineering quantities',
    command: 'quantities',
    roadOnly: true,
  },
  {
    value: 'landing',
    label: 'Landing',
    title: 'Landing deflection explorer',
    command: 'landing',
  },
  {
    value: 'drainage',
    label: 'Drainage',
    title: 'Drainage · existing vs design surface',
    command: 'drainage',
    roadOnly: true,
  },
  {
    value: 'swept',
    label: 'Swept path',
    title: 'Design vehicle swept path',
    command: 'sweptPath',
    roadOnly: true,
  },
] as const

export type DetailView = (typeof roadDetailViews)[number]['value']

export const detailTitle = (view: DetailView) => roadDetailViews.find((item) => item.value === view)!.title
