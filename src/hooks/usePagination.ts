import { useState } from 'react'

/** Bounded pages; changing a filter resets the view without a stale render. */
export function usePagination<T>(items: readonly T[], pageSize: number, resetKey: string) {
  const [position, setPosition] = useState({ key: resetKey, page: 0 })
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  const page = position.key === resetKey ? Math.min(position.page, pageCount - 1) : 0
  return {
    page,
    pageCount,
    items: items.slice(page * pageSize, (page + 1) * pageSize),
    start: items.length ? page * pageSize + 1 : 0,
    end: Math.min(items.length, (page + 1) * pageSize),
    setPage: (next: number) => setPosition({ key: resetKey, page: Math.max(0, Math.min(next, pageCount - 1)) }),
  }
}
