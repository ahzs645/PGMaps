/**
 * The road workspace's detail pane views, defined once: the pane's title and the tab label come
 * from here, so a new view is one entry rather than another branch in the page. No DOM access.
 */
export const DETAIL_VIEWS = {
  section: { title: 'Cross-section' },
  terrain: { title: '3D terrain' },
  mass: { title: 'Mass haul' },
  table: { title: 'Station schedule' },
  compare: { title: 'Compare alternatives' },
  cable: { title: 'D-line clearance' },
  pegs: { title: 'Pegging data' },
  engineering: { title: 'Engineering quantities' },
  landing: { title: 'Landing deflection explorer' },
  drainage: { title: 'Drainage · existing vs design surface' },
  swept: { title: 'Design vehicle swept path' },
} as const satisfies Record<string, { title: string }>

export type DetailView = keyof typeof DETAIL_VIEWS
export const detailTitle = (view: DetailView) => DETAIL_VIEWS[view].title
