import { fieldComparison, fieldPriorities, type FieldInput, type PriorityInput } from './fieldComparison'

self.onmessage = ({ data }: MessageEvent<FieldInput | PriorityInput>) => {
  try {
    self.postMessage(
      'tolerance' in data ? { priorities: fieldPriorities(data) } : { comparison: fieldComparison(data) },
    )
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Could not compare the field assumption.' })
  }
}
