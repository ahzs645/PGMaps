/** Manual, bounded live review. Prints an evidence summary; never writes a provincial snapshot into PGMaps. */
import { BC_ACCESS_PILOT_RECIPE, loadBcAccessPilot } from '../../src/pages/dev-forestry-roads/bcAccessPilot'
import { ACCESS_HISTORY_SOURCES } from '../../src/pages/dev-forestry-roads/accessHistorySources'
import { installBcSourcePythonTransport } from './bc-access-transport'
import { createAccessHistoryState, parseAccessHistoryState } from '../../src/pages/dev-forestry-roads/accessHistory'

const arguments_ = process.argv.slice(2)
if (arguments_.includes('--help')) {
  console.log(
    'Usage: node --import tsx scripts/forestry/inspect-bc-access-pilot.ts [openingId] [--python-transport]\nThe optional Python 3 urllib transport uses configured environment proxies. This command prints a bounded summary and writes no source snapshot.',
  )
  process.exit(0)
}
const pythonTransport = arguments_.includes('--python-transport')
const ids = arguments_.filter((value) => value !== '--python-transport')
if (ids.length > 1 || ids.some((value) => !/^\d{1,15}$/.test(value)))
  throw Error('Pass one numeric opening ID and optionally --python-transport. Use --help for the command syntax.')

if (pythonTransport) installBcSourcePythonTransport()

const openingId = ids[0] ?? BC_ACCESS_PILOT_RECIPE.openingId
const pilot = await loadBcAccessPilot(openingId)
const retained = parseAccessHistoryState({ ...createAccessHistoryState(), sources: pilot.sources }, [
  ...pilot.blocks,
  ...pilot.roads,
])
const roadById = new Map(pilot.roads.map((road) => [road.id, road]))
console.log(
  JSON.stringify(
    {
      recipe: `bc-opening-${pilot.openingId}-v1`,
      transport: pythonTransport ? 'Python urllib with configured environment proxies' : 'native fetch',
      openingId: pilot.openingId,
      retrievedAt: pilot.retrievedAt,
      status: pilot.status,
      bounds: pilot.bounds,
      licensing: ACCESS_HISTORY_SOURCES.filter((source) => source.use === 'bounded-live-query').map((source) => ({
        id: source.id,
        catalogueUrl: source.catalogueUrl,
        licence: source.licence,
      })),
      queries: pilot.queries,
      identity: pilot.identity,
      footprintParts: pilot.blocks.length,
      roadParts: pilot.roads.length,
      retainedSourceRecords: retained.sources.length,
      importedRoadHistoryEvents: retained.events.length,
      importedAccessAnchors: retained.anchors.length,
      roadCandidateCount: pilot.roadCandidates.length,
      nearestRoadCandidates: pilot.roadCandidates.slice(0, 5).map((candidate) => {
        const road = roadById.get(candidate.roadId)!
        return {
          ...candidate,
          name: road.name,
          forestFileId: road.roadEvidence?.forestFileId,
          roadSectionId: road.roadEvidence?.roadSectionId,
          clientNumber: road.roadEvidence?.clientNumber,
          timberMark: road.roadEvidence?.timberMark,
          lifecycleStatus: road.roadEvidence?.lifecycleStatus,
        }
      }),
      additionalCandidateCount: Math.max(0, pilot.roadCandidates.length - 5),
      findings: pilot.findings,
    },
    null,
    2,
  ),
)
