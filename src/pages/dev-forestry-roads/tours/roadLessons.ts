/**
 * The road designer's lessons, in the order the help lists them (`/help`). Each is a Tourkit
 * manifest (`lessons/<id>.json`) that both runs live over the designer (`?tour=<id>`) and is the text
 * of its illustrated guide (`/help/<id>`): the guide prints each step's title and body, so the two
 * cannot drift. What a manifest cannot hold lives here: the guide's pictures (Tourkit only embeds
 * image data) and the sample files a learner downloads. Add a lesson here and its JSON under
 * `lessons/`; `roadLessons.test.ts` checks it against the designer's vocabulary (`roadTour.ts`).
 * Keep this file free of DOM access, and free of any static import of a lesson: the designer reads
 * the IDs, and the lessons load only when a lesson or the help opens.
 */
export type RoadLessonTopic = 'start' | 'setup' | 'edit' | 'review' | 'save'

export const ROAD_LESSON_TOPICS: readonly { id: RoadLessonTopic; title: string }[] = [
  { id: 'start', title: 'Get started' },
  { id: 'setup', title: 'Set up the design' },
  { id: 'edit', title: 'Inspect and edit a road' },
  { id: 'review', title: 'Compare and review' },
  { id: 'save', title: 'Save and share' },
]

/** A picture in the guide, beside the step it illustrates. `src` is under `public/help/`. */
export interface RoadLessonFigure {
  src: string
  width: number
  height: number
  alt: string
  caption?: string
}

export interface RoadLesson {
  id: string
  topic: RoadLessonTopic
  /** Guide pictures by manifest step ID. */
  figures: Readonly<Record<string, RoadLessonFigure>>
  /** Files the learner downloads to do the lesson by hand (Watch fetches them itself). */
  downloads?: readonly { label: string; src: string }[]
  load: () => Promise<unknown>
}

const BASEMAP = 'Basemap © OpenStreetMap contributors, © CARTO'

export const ROAD_LESSONS: readonly RoadLesson[] = [
  {
    id: 'open-hillside',
    topic: 'start',
    figures: {
      basis: {
        src: 'open-hillside/header.png',
        width: 1372,
        height: 44,
        alt: 'Guided mode header with the training badge, road selector, Guided mode switcher, Linked overview, Open, and Save.',
      },
      station: {
        src: 'station-200/plan.webp',
        width: 648,
        height: 435,
        alt: 'The orange road with its start marked and the selected station 0+200.0 highlighted in red.',
        caption: `Plan view of the training road · ${BASEMAP}`,
      },
      'guided-map': {
        src: 'open-hillside/workspaces.png',
        width: 1158,
        height: 446,
        alt: 'Ribbon, Guided map and Guided mode cards in the recorded training example.',
      },
    },
    load: () => import('./lessons/open-hillside.json').then((module) => module.default),
  },
  {
    id: 'sketch-road',
    topic: 'setup',
    figures: {
      sketch: {
        src: 'sketch-road/sketch.webp',
        width: 740,
        height: 372,
        alt: 'The Sketch button sits beside Peg road in the Design controls.',
      },
      stroke: {
        src: 'sketch-road/gesture.webp',
        width: 960,
        height: 518,
        alt: 'A single teal road sketch curves across open hillside contours.',
        caption: `${BASEMAP}`,
      },
      done: {
        src: 'sketch-road/done.webp',
        width: 608,
        height: 372,
        alt: 'The sketch instruction bar includes the Done sketching button.',
      },
      road: {
        src: 'sketch-road/road.webp',
        width: 740,
        height: 372,
        alt: 'The active road has changed to Sketched road 3.',
      },
    },
    load: () => import('./lessons/sketch-road.json').then((module) => module.default),
  },
  {
    id: 'terrain',
    topic: 'setup',
    figures: {
      'terrain-tab': {
        src: 'terrain/terrain-tab.webp',
        width: 395,
        height: 238,
        alt: 'The Terrain tab is the first workflow tab in the Guided mode.',
      },
      datum: {
        src: 'terrain/datum.webp',
        width: 405,
        height: 263,
        alt: 'The import options show the synthetic vertical reference entered in the datum field.',
      },
      import: {
        src: 'terrain/import.webp',
        width: 405,
        height: 283,
        alt: 'The terrain source controls include the GeoTIFF, LAS or LAZ import button.',
      },
      source: {
        src: 'terrain/source.webp',
        width: 405,
        height: 271,
        alt: 'The active source is training-slope.tif, with 20 m cells in EPSG:32610.',
      },
    },
    downloads: [{ label: 'training-slope.tif (synthetic slope, metres)', src: 'terrain/training-slope.tif' }],
    load: () => import('./lessons/terrain.json').then((module) => module.default),
  },
  {
    id: 'import-line',
    topic: 'setup',
    figures: {
      import: {
        src: 'import-line/import.webp',
        width: 405,
        height: 281,
        alt: 'The Design tab has an Import line button below the tools for editing a road.',
      },
      road: {
        src: 'import-line/road.webp',
        width: 388,
        height: 256,
        alt: 'The active road and Road name both show Training spur.',
      },
      profile: {
        src: 'import-line/profile.webp',
        width: 545,
        height: 379,
        alt: 'A ground and formation profile is drawn for the imported Training spur.',
      },
    },
    downloads: [{ label: 'training-spur.geojson (one line)', src: 'import-line/training-spur.geojson' }],
    load: () => import('./lessons/import-line.json').then((module) => module.default),
  },
  {
    id: 'station-200',
    topic: 'edit',
    figures: {
      station: {
        src: 'station-200/plan.webp',
        width: 648,
        height: 435,
        alt: 'A red point on the training road marks 0+200.0 between the start and the 0+500 label.',
        caption: `Plan at 0+200.0 · ${BASEMAP}`,
      },
      profile: {
        src: 'station-200/profile.webp',
        width: 633,
        height: 420,
        alt: 'The profile cursor at 0+200.0 crosses the rising formation line on the 7.3% grade.',
      },
      section: {
        src: 'station-200/section.webp',
        width: 633,
        height: 380,
        alt: 'Cross-section at 0+200.0. The ground crosses above the road template. The values below show cut depth 2.03 metres.',
      },
    },
    load: () => import('./lessons/station-200.json').then((module) => module.default),
  },
  {
    id: 'vertical-profile',
    topic: 'edit',
    figures: {
      vertical: {
        src: 'vertical-profile/vertical.webp',
        width: 394,
        height: 248,
        alt: 'The Design sidebar includes a folded Vertical alignment section.',
      },
      level: {
        src: 'vertical-profile/level.webp',
        width: 390,
        height: 256,
        alt: 'The PVI table shows the starting elevation for the first point.',
      },
      formation: {
        src: 'vertical-profile/formation.webp',
        width: 530,
        height: 256,
        alt: 'The cross-section measurements show formation elevation 688.10 m.',
      },
    },
    load: () => import('./lessons/vertical-profile.json').then((module) => module.default),
  },
  {
    id: 'road-section',
    topic: 'edit',
    figures: {
      'template-tab': {
        src: 'road-section/section-tab.webp',
        width: 390,
        height: 231,
        alt: 'Section is the middle tab in the sidebar.',
      },
      width: {
        src: 'road-section/width.webp',
        width: 390,
        height: 275,
        alt: 'The left and right half-width controls sit next to each other in Road cross-section.',
      },
      widths: {
        src: 'road-section/widths.webp',
        width: 538,
        height: 240,
        alt: 'The cross-section readout shows 4.0 m on the left and 3.0 m on the right.',
      },
    },
    load: () => import('./lessons/road-section.json').then((module) => module.default),
  },
  {
    id: 'compare-roads',
    topic: 'review',
    figures: {
      compare: {
        src: 'compare-roads/compare.webp',
        width: 568,
        height: 193,
        alt: 'Compare all sits between the active road selector and the workspace switcher.',
      },
      baseline: {
        src: 'compare-roads/baseline.webp',
        width: 563,
        height: 275,
        alt: 'The comparison pane shows Hillside access in the baseline selector.',
      },
      metrics: {
        src: 'compare-roads/metrics.webp',
        width: 688,
        height: 238,
        alt: 'The comparison table shows road lengths and maximum grades side by side.',
      },
      alternative: {
        src: 'compare-roads/alternative.webp',
        width: 481,
        height: 200,
        alt: 'Two named rows in the comparison table identify the roads.',
      },
      selected: {
        src: 'compare-roads/selected.webp',
        width: 390,
        height: 238,
        alt: 'The Design controls show Contour alternative as the active road.',
      },
    },
    load: () => import('./lessons/compare-roads.json').then((module) => module.default),
  },
  {
    id: 'quantities-cost',
    topic: 'review',
    figures: {
      'engineering-tab': {
        src: 'quantities-cost/engineering.webp',
        width: 388,
        height: 228,
        alt: 'Engineering is the fourth workflow tab in the left-hand controls.',
      },
      breakdown: {
        src: 'quantities-cost/breakdown.webp',
        width: 394,
        height: 260,
        alt: 'The breakdown command appears below the engineering tool groups.',
      },
      volumes: {
        src: 'quantities-cost/volumes.webp',
        width: 400,
        height: 269,
        alt: 'Road summary lists cut and fill volumes for Hillside access.',
      },
      total: {
        src: 'quantities-cost/total.webp',
        width: 540,
        height: 294,
        alt: 'The cost table totals excavation, fill placement, surfacing and clearing.',
      },
    },
    load: () => import('./lessons/quantities-cost.json').then((module) => module.default),
  },
  {
    id: 'stream-crossing',
    topic: 'review',
    figures: {
      'engineering-tab': {
        src: 'stream-crossing/engineering.webp',
        width: 388,
        height: 228,
        alt: 'The Engineering tab is available in the sidebar.',
      },
      crossings: {
        src: 'stream-crossing/crossings.webp',
        width: 394,
        height: 244,
        alt: 'Stream crossing estimates shows one crossing and an incomplete or unpriced status.',
      },
      record: {
        src: 'stream-crossing/record.webp',
        width: 390,
        height: 256,
        alt: 'The panel offers to record the detected road and stream intersection.',
      },
      options: {
        src: 'stream-crossing/options.webp',
        width: 390,
        height: 256,
        alt: 'The new record identifies the crossing and shows an unselected planning structure option.',
      },
    },
    load: () => import('./lessons/stream-crossing.json').then((module) => module.default),
  },
  {
    id: 'review-design',
    topic: 'review',
    figures: {
      'review-tab': {
        src: 'review-design/review.webp',
        width: 388,
        height: 225,
        alt: 'Review is the rightmost workflow tab in the sidebar.',
      },
      readiness: {
        src: 'review-design/readiness.webp',
        width: 390,
        height: 283,
        alt: 'The readiness panel lists three items outside a limit and eight to do.',
      },
      standards: {
        src: 'review-design/standard.webp',
        width: 390,
        height: 244,
        alt: 'The starting-values check shows a 12% grade and 25 m minimum radius.',
      },
      limits: {
        src: 'review-design/limits.webp',
        width: 388,
        height: 250,
        alt: 'The design standards editor exposes grade, radius and other job limits.',
      },
    },
    load: () => import('./lessons/review-design.json').then((module) => module.default),
  },
  {
    id: 'save-project',
    topic: 'save',
    figures: {
      save: {
        src: 'save-project/save.webp',
        width: 481,
        height: 196,
        alt: 'The workspace header contains Open and Save.',
      },
      project: {
        src: 'save-project/project.webp',
        width: 956,
        height: 225,
        alt: 'The Project file preview offers a Save button for the editable project.',
      },
      open: {
        src: 'save-project/open.webp',
        width: 481,
        height: 196,
        alt: 'The Open button in the header opens the project file picker.',
      },
      reopened: {
        src: 'save-project/reopened.webp',
        width: 388,
        height: 228,
        alt: 'The reopened project retains Hillside access as its active road.',
      },
    },
    load: () => import('./lessons/save-project.json').then((module) => module.default),
  },
  {
    id: 'export-stations',
    topic: 'save',
    figures: {
      save: {
        src: 'export-stations/save.webp',
        width: 481,
        height: 196,
        alt: 'The top-right header contains the Save button.',
      },
      format: {
        src: 'export-stations/format.webp',
        width: 481,
        height: 290,
        alt: 'Station CSV is listed below Shapefile in the GIS data group.',
      },
      download: {
        src: 'export-stations/download.webp',
        width: 978,
        height: 288,
        alt: 'The Station CSV pane shows the download control and a preview of its tabular data.',
      },
    },
    load: () => import('./lessons/export-stations.json').then((module) => module.default),
  },
]

export const ROAD_LESSON_IDS: readonly string[] = ROAD_LESSONS.map((lesson) => lesson.id)
export const roadLesson = (id: string) => ROAD_LESSONS.find((lesson) => lesson.id === id)
