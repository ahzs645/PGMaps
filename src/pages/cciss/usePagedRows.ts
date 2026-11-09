import { useState } from 'react'

/**
 * One page of `rows`. The page returns to the first whenever `resetKey` changes, so a new
 * filter never leaves the reader on a page past the end.
 */
export function usePagedRows<T>(rows: readonly T[], pageSize: number, resetKey: string) {
  const [state, setState] = useState({ key: resetKey, index: 0 })
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const page = Math.min(state.key === resetKey ? state.index : 0, pageCount - 1)
  return {
    page,
    pageCount,
    visible: rows.slice(page * pageSize, (page + 1) * pageSize),
    /** 1-based bounds of the shown rows for "Showing 41–80 of 120"; 0 and 0 when empty. */
    first: rows.length ? page * pageSize + 1 : 0,
    last: Math.min((page + 1) * pageSize, rows.length),
    setPage: (index: number) => setState({ key: resetKey, index }),
  }
}
