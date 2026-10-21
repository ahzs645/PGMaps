import { useCallback, useEffect, useState } from 'react'
import {
  listLocalWorkbench,
  subscribeLocalWorkbench,
  type LocalWorkbenchKind,
  type LocalWorkbenchRecord,
} from './localWorkbench'

export function useLocalWorkbenchRecords(kind?: LocalWorkbenchKind) {
  const [records, setRecords] = useState<LocalWorkbenchRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const reload = useCallback(() => setRevision((value) => value + 1), [])
  useEffect(() => {
    let active = true
    let generation = 0
    const refresh = () => {
      const current = ++generation
      setLoading(true)
      void listLocalWorkbench(kind)
        .then((next) => {
          if (active && current === generation) {
            setRecords(next)
            setError('')
            setLoading(false)
          }
        })
        .catch((reason: unknown) => {
          if (active && current === generation) {
            setRecords([])
            setError(reason instanceof Error ? reason.message : String(reason))
            setLoading(false)
          }
        })
    }
    refresh()
    const unsubscribe = subscribeLocalWorkbench(refresh)
    return () => {
      active = false
      unsubscribe()
    }
  }, [kind, revision])
  return { records, loading, error, reload }
}
