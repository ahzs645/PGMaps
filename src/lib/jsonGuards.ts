/**
 * Small guards for parsing untrusted JSON (served configuration, browser storage) in the house
 * style: each check names the field it rejects and throws a readable Error. No DOM access.
 *
 * `src/pages/dev-forestry-roads/project.ts` and `vehicleLibrary.ts` keep their own copies of the
 * same shape; they predate this module.
 */
export type JsonObject = Record<string, unknown>

export function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`${label} must be an object.`)
  return value as JsonObject
}

/** Rejects keys outside `allowed`, so a misspelt option fails loudly instead of being ignored. */
export function strictObject(value: unknown, label: string, allowed: readonly string[]): JsonObject {
  const result = object(value, label)
  const unknown = Object.keys(result).filter((key) => !allowed.includes(key))
  if (unknown.length) throw Error(`${label} has unknown ${unknown.length > 1 ? 'keys' : 'key'}: ${unknown.join(', ')}.`)
  return result
}

export function text(value: unknown, label: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw Error(`${label} must contain 1–${max} characters.`)
  return value.trim()
}

export function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw Error(`${label} must be true or false.`)
  return value
}

export function int(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
    throw Error(`${label} must be a whole number between ${min} and ${max}.`)
  return value
}

export function oneOf<T extends string | number>(value: unknown, label: string, allowed: readonly T[]): T {
  if (!allowed.includes(value as T)) throw Error(`${label} must be one of ${allowed.join(', ')}.`)
  return value as T
}

export function list(value: unknown, label: string, max = 1000, min = 0): unknown[] {
  if (!Array.isArray(value) || value.length > max || value.length < min)
    throw Error(`${label} must contain ${min}–${max} entries.`)
  return value
}

/** Parse `value[key]` with `parse` when present; absent or `undefined` stays `undefined`. */
export function optional<T>(source: JsonObject, key: string, parse: (value: unknown) => T): T | undefined {
  return source[key] === undefined ? undefined : parse(source[key])
}

export function distinct(values: readonly unknown[], message: string) {
  if (new Set(values).size !== values.length) throw Error(message)
}
