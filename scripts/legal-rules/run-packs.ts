import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { authoringSchema, parsePack, factSetSchema } from '../../packages/legal-rules/src/contract'
import { assess } from '../../packages/legal-rules/engine/evaluate'

const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'))
try {
  const { values } = parseArgs({
    options: {
      schema: { type: 'boolean' },
      date: { type: 'string' },
      pack: { type: 'string', multiple: true },
      facts: { type: 'string', multiple: true },
    },
  })
  if (values.schema) console.log(JSON.stringify(authoringSchema(), null, 2))
  else {
    if (!values.date || !values.pack?.length)
      throw Error('Supply --date YYYY-MM-DD and at least one --pack FILE. Repeat --pack or --facts FILE as needed.')
    const packs = values.pack.map((path) => parsePack(read(path)))
    const facts = (values.facts ?? []).map((path) => factSetSchema.parse(read(path)))
    console.log(JSON.stringify(assess(values.date, packs, facts), null, 2))
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
