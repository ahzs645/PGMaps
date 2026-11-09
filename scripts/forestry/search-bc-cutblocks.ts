/** Read-only bounded discovery. Prints source identities and envelopes, never writes a feature snapshot. */
import { searchBcCutblocks, type BcCutblockSearchFilters } from '../../src/pages/dev-forestry-roads/bcAccessSearch'
import { installBcSourcePythonTransport } from './bc-access-transport'

const arguments_ = process.argv.slice(2)
if (arguments_.includes('--help')) {
  console.log(
    'Usage: node --import tsx scripts/forestry/search-bc-cutblocks.ts [--opening-id ID] [--licence CODE] [--cutting-permit CODE] [--timber-mark CODE] [--block CODE] [--bounds west,south,east,north] [--limit 1..50] [--python-transport]\nAt least one identifier or a small bounds filter is required. Identifiers match exactly. A capped result is a discovery page, not an exhaustive count. Harvest completion may be actual or estimated.',
  )
  process.exit(0)
}
const filters: BcCutblockSearchFilters = {}
const names = {
  '--opening-id': 'openingId',
  '--licence': 'forestFileId',
  '--cutting-permit': 'cuttingPermitId',
  '--timber-mark': 'timberMark',
  '--block': 'cutBlockId',
} as const
const seen = new Set<string>()
let pythonTransport = false
for (let index = 0; index < arguments_.length; index += 1) {
  const argument = arguments_[index]
  if (seen.has(argument)) throw Error(`Repeated option ${argument}.`)
  seen.add(argument)
  if (argument === '--python-transport') {
    pythonTransport = true
    continue
  }
  const value = arguments_[++index]
  if (!value || value.startsWith('--')) throw Error(`Missing value for ${argument}.`)
  if (argument in names) filters[names[argument as keyof typeof names]] = value
  else if (argument === '--limit') filters.limit = Number(value)
  else if (argument === '--bounds') filters.bounds = value.split(',').map(Number) as [number, number, number, number]
  else throw Error(`Unknown option ${argument}. Use --help for syntax.`)
}
if (pythonTransport) installBcSourcePythonTransport()
const result = await searchBcCutblocks(filters)
console.log(
  JSON.stringify(
    { transport: pythonTransport ? 'Python urllib with configured environment proxies' : 'native fetch', ...result },
    null,
    2,
  ),
)
