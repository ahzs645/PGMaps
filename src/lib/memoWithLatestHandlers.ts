import { createElement, memo, useRef, type ComponentType } from 'react'

/**
 * `React.memo` for a component whose parent rebuilds its props on every render: inline handlers,
 * object literals and a spread workspace. Two changes make the memo hold:
 *
 * - Every top-level function prop, and every function directly on a `bags` prop (an object the
 *   parent builds afresh each render, such as a spread workspace), is replaced by a stable proxy
 *   that calls the caller's latest function, so a skipped render never leaves a stale handler.
 * - Props are compared by content: a top-level plain object or array is equal when its entries are,
 *   to `SAME_SHAPE_DEPTH` levels. A bag's fields are compared by identity, except small records of
 *   plain values. Unequal anywhere means render, so the comparison errs towards rendering.
 *
 * Nothing else is copied: every object the component receives is the caller's own, so identity
 * checks and identity-keyed caches (`layoutKey`, a template candidate's terrain) still hold. A
 * value the component shows has to arrive as data, never through a function's identity; a
 * function it calls while rendering reads the latest props, recorded before it renders.
 */
export const SAME_SHAPE_DEPTH = 2

const plain = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || '$$typeof' in value) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Whether two values draw the same, compared to `depth` levels of plain objects and arrays. */
export function sameShape(a: unknown, b: unknown, depth = SAME_SHAPE_DEPTH): boolean {
  if (Object.is(a, b)) return true
  if (depth <= 0) return false
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((value, index) => sameShape(value, b[index], depth - 1))
  if (!plain(a) || !plain(b)) return false
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && sameShape(a[key], b[key], depth - 1))
}

const primitive = (value: unknown) => value === null || (typeof value !== 'object' && typeof value !== 'function')
/** A small record of plain values, such as `{ at, current }`: equal by content, never keyed by identity. */
const record = (value: unknown) => plain(value) && Object.values(value).every(primitive)

/** A bag's fields by identity (its functions are already stable proxies), small records by content. */
export function sameBag(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (!plain(a) || !plain(b)) return false
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(b, key) &&
      (Object.is(a[key], b[key]) || (record(a[key]) && record(b[key]) && sameShape(a[key], b[key], 1))),
  )
}

type Fn = (...args: unknown[]) => unknown

export function memoWithLatestHandlers<P extends object>(
  Component: ComponentType<P>,
  options: { bags?: readonly (keyof P & string)[] } = {},
): ComponentType<P> {
  const bags = new Set<string>(options.bags ?? [])
  const same = (previous: object, next: object) => {
    const a = previous as Record<string, unknown>
    const b = next as Record<string, unknown>
    const keys = Object.keys(a)
    if (keys.length !== Object.keys(b).length) return false
    return keys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(b, key) &&
        (bags.has(key) ? sameBag(a[key], b[key]) : sameShape(a[key], b[key], SAME_SHAPE_DEPTH)),
    )
  }
  const Inner = memo(Component as unknown as ComponentType<object>, same)
  function LatestHandlers(props: P) {
    const latest = useRef<Record<string, unknown>>({})
    // Recorded while rendering, not in an effect: a function the component calls as it renders
    // must see these props, and the component renders before any effect of this render runs.
    // eslint-disable-next-line react-hooks/refs
    latest.current = props as Record<string, unknown>
    const proxies = useRef(new Map<string, Fn>())
    const proxy = (key: string, read: () => unknown) => {
      let fn = proxies.current.get(key)
      if (!fn) {
        fn = (...args: unknown[]) => {
          const target = read()
          return typeof target === 'function' ? (target as Fn)(...args) : undefined
        }
        proxies.current.set(key, fn)
      }
      return fn
    }
    const stable: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(props)) {
      if (typeof value === 'function') stable[key] = proxy(key, () => latest.current[key])
      else if (bags.has(key) && plain(value)) {
        // The bag itself is new each render; its functions become proxies, everything else is kept.
        const bag: Record<string, unknown> = {}
        for (const [field, entry] of Object.entries(value))
          bag[field] =
            typeof entry === 'function'
              ? proxy(
                  `${key}\u0000${field}`,
                  () => (latest.current[key] as Record<string, unknown> | undefined)?.[field],
                )
              : entry
        stable[key] = bag
      } else stable[key] = value
    }
    return createElement(Inner, stable)
  }
  LatestHandlers.displayName = `LatestHandlers(${Component.displayName ?? Component.name ?? 'Component'})`
  return LatestHandlers
}
