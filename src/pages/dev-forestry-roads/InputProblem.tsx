import { InlineAlert } from '@/components/ui/map-panels'
import type { EngineeringInputList, InvalidInput } from './inputErrors'

/**
 * The message for an invalid entry, shown inside that entry's block. A failure on a field the
 * block marks itself (`inlineFields`) is left to that field, so the message appears once.
 */
export function EntryProblem({
  problem,
  list,
  id,
  inlineFields = [],
}: {
  problem: InvalidInput | undefined
  list: EngineeringInputList
  id?: string
  inlineFields?: readonly string[]
}) {
  const target = problem?.target
  if (!target || target.list !== list || target.id !== id) return null
  if (target.field && inlineFields.includes(target.field)) return null
  return (
    <div data-testid="road-entry-problem">
      <InlineAlert tone="error">{problem.message}</InlineAlert>
    </div>
  )
}
