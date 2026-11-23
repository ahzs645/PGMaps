import { parseProject, scenarios } from './project'
import { analyze } from './analysis'
import { patchFacts } from './legalEvidence'
import { z } from 'zod'
// Releases of the editor before the pack framework saved only the inputs and derived GIS outputs.
export function legacyPatchFacts(raw: unknown) {
  const data = z
    .object({
      method: z.literal('pg-2005-buffer-v1'),
      project: z.unknown(),
      displayed: z.object({ year: z.int(), scenario: z.enum(scenarios) }),
    })
    .parse(raw)
  const project = parseProject(data.project),
    { year, scenario } = data.displayed
  return patchFacts(project, analyze(project, year, scenario), year, scenario)
}
