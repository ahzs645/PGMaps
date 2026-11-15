/**
 * sql.js loaded once per page, with its WASM file resolved by Vite. Loaded on first use, so the
 * 600 kB WASM stays out of routes that never read or write SQLite. A failed load is not cached.
 */
import type { SqlJsStatic } from 'sql.js'

let sql: Promise<SqlJsStatic> | undefined
export function loadSqlJs(): Promise<SqlJsStatic> {
  sql ??= Promise.all([import('sql.js'), import('sql.js/dist/sql-wasm.wasm?url')])
    .then(([module, wasm]) => module.default({ locateFile: () => wasm.default }))
    .catch((error) => {
      sql = undefined
      throw error
    })
  return sql
}
