import { useCallback, useRef, useState } from 'react'
import type { ComparisonSnapshot } from './comparison'
import { addComparisonSnapshot, removeComparisonSnapshot, renameComparisonSnapshot } from './comparisonCollection'

/** Page-local results are explicit snapshots; neither imports nor coordinates enter persistent storage. */
export function useComparisonSnapshots() {
  const records = useRef<readonly ComparisonSnapshot[]>([])
  const [snapshots, setSnapshots] = useState<readonly ComparisonSnapshot[]>([])
  const save = useCallback((value: ComparisonSnapshot) => {
    const next = addComparisonSnapshot(records.current, value)
    records.current = next
    setSnapshots(next)
  }, [])
  const remove = useCallback((id: string) => {
    const next = removeComparisonSnapshot(records.current, id)
    records.current = next
    setSnapshots(next)
  }, [])
  const rename = useCallback((id: string, label: string) => {
    const next = renameComparisonSnapshot(records.current, id, label)
    records.current = next
    setSnapshots(next)
  }, [])
  return { snapshots, save, remove, rename }
}
