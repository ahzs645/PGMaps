/** Regenerate only invented teaching inputs; this command performs no ministry queries. */
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { accessHistoryBundle, accessHistoryReport } from '../../src/pages/dev-forestry-roads/AccessHistoryIO'
import { historicalSharedUsage, traceHistoricalAccess } from '../../src/pages/dev-forestry-roads/accessHistory'
import { serializeProject } from '../../src/pages/dev-forestry-roads/project'
import { createTrainingScenario } from '../../src/pages/dev-forestry-roads/scenarios'
import { ACCESS_HISTORY_TRAINING_IDS as ids } from '../../src/pages/dev-forestry-roads/trainingAccessHistoryScenario'
import { accessHistoryDiagram } from './access-history-diagram'

const output = new URL('../../examples/forestry/access-history/', import.meta.url)
const project = createTrainingScenario('training-access-history')
const state = project.accessHistory!
const outcome = (date: string) => {
  const result = traceHistoricalAccess({
    context: project.context,
    state,
    blockId: ids.blockA,
    settings: { asOf: date },
  })
  return {
    date,
    paths: result.paths.map((path) => ({
      id: path.id,
      relationship: path.relationship,
      lengthM: path.lengthM,
      roadIds: path.roadIds,
      structureIds: path.structureIds,
      assumptions: path.assumptions,
    })),
    excludedRoads: result.excludedRoads,
    structures: result.structures,
    unresolved: result.unresolved,
  }
}
await mkdir(output, { recursive: true })
await Promise.all([
  writeFile(new URL('access-history-comparison.svg', output), accessHistoryDiagram(project)),
  writeFile(new URL('synthetic-access-history.road.json', output), serializeProject(project)),
  writeFile(
    new URL('synthetic-access-history.bundle.json', output),
    accessHistoryBundle(project.context, state) + '\n',
  ),
  writeFile(
    new URL('synthetic-access-history-report.md', output),
    accessHistoryReport(project.name, project.context, state),
  ),
  writeFile(
    new URL('expected-outcomes.json', output),
    JSON.stringify(
      {
        synthetic: true,
        purpose: 'Deterministic example outputs, not validation against actual BC road use.',
        scenarios: [outcome('2010-06-30'), outcome('2022-08-01')],
        shared2010: historicalSharedUsage(state.paths, state),
      },
      null,
      2,
    ) + '\n',
  ),
])
console.log(`Wrote the synthetic access-history example to ${fileURLToPath(output)}`)
