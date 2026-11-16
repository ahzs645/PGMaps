import { roadTourSnapshot, type RoadTourSnapshotInput } from './roadTour'

/** The training project as it opens in Guided mode at 0+000, for tests of lessons and the snapshot. */
export const TRAINING_SNAPSHOT_INPUT: RoadTourSnapshotInput = {
  training: true,
  interfaceId: 'workbench',
  roadName: 'Hillside access',
  roadLength: 1429.44,
  station: 0,
  visiblePanes: ['plan', 'profile', 'detail'],
  detail: 'section',
  workflow: { editor: 'design', shown: true },
  toolMode: 'inspect',
  roadId: 'demo-main',
  roadCount: 2,
  groundShare: 100,
  pviLevels: [688, 712.5],
  template: { leftWidth: 3, rightWidth: 3 },
  section: { formationZ: 688, groundZ: 688, widthLeft: 3, widthRight: 3 },
  terrain: { name: 'Synthetic training slope', kind: 'demo', cellM: 5, epsg: null, verticalReference: '' },
  importDatum: '',
  busy: false,
  layoutPreset: 'linked',
  dialog: null,
  filesOutput: 'project',
  fileSaved: false,
  lastExport: null,
  openedFromFile: false,
  openSections: [],
  crossingRecords: 0,
}

export const trainingSnapshot = (change: Partial<RoadTourSnapshotInput> = {}) =>
  roadTourSnapshot({ ...TRAINING_SNAPSHOT_INPUT, ...change })
