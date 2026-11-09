/** Manual, bounded live review. Prints an evidence summary; never writes a provincial snapshot into PGMaps. */
import { BC_ACCESS_PILOT_RECIPE, loadBcAccessPilot } from '../../src/pages/dev-forestry-roads/bcAccessPilot'
import { ACCESS_HISTORY_SOURCES } from '../../src/pages/dev-forestry-roads/accessHistorySources'
import { spawn } from 'node:child_process'
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

// An explicit CLI transport for managed networks whose Node fetch does not honor their proxy configuration.
// The application keeps native browser fetch. Source URLs, record/byte/time budgets and parsers are unchanged.
if (pythonTransport) {
  const program =
    'import sys,urllib.request\nwith urllib.request.urlopen(sys.argv[1],timeout=25) as r:\n b=r.read(10485761)\n if len(b)>10485760:raise ValueError("Source response exceeds 10 MiB")\n sys.stdout.buffer.write(b)'
  globalThis.fetch = (input, options = {}) =>
    new Promise<Response>((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(options.signal.reason ?? new DOMException('Source request cancelled.', 'AbortError'))
        return
      }
      if ((typeof input !== 'string' && !(input instanceof URL)) || (options.method && options.method !== 'GET')) {
        reject(new Error('The source-review transport supports only the generated GET source URLs.'))
        return
      }
      const child = spawn(process.env.CODEX_PRIMARY_RUNTIME_PYTHON ?? 'python3', ['-c', program, String(input)])
      const chunks: Buffer[] = [],
        errors: Buffer[] = []
      const abort = () => {
        child.kill('SIGTERM')
        reject(options.signal?.reason ?? new DOMException('Source request cancelled.', 'AbortError'))
      }
      options.signal?.addEventListener('abort', abort, { once: true })
      child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
      child.stderr.on('data', (chunk: Buffer) => errors.push(chunk))
      child.on('error', reject)
      child.on('close', (code) => {
        options.signal?.removeEventListener('abort', abort)
        if (code === 0) resolve(new Response(Uint8Array.from(Buffer.concat(chunks))))
        else reject(new Error(Buffer.concat(errors).toString().trim() || `Source transport exited with code ${code}.`))
      })
      if (options.signal?.aborted) abort()
    })
}

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
      recipe: BC_ACCESS_PILOT_RECIPE.id,
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
