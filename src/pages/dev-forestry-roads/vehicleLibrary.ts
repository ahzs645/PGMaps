/**
 * Design vehicles read from a project file or a vehicle file, and the project's own vehicle
 * library: a contractor's fleet entered once and reused by every road's vehicle check. Pure: no
 * DOM or network access.
 *
 * Provenance: the idea of a user library of vehicles kept beside the standard ones follows the
 * functional specification of QuickTurn (clean-specs/quickturn.md §3.5, gap G8). Written from a
 * functional specification; no code from QuickTurn (GNU GPL v2) was used. Vehicle dimensions come
 * only from what the user enters or from the presets in `sweptPath.ts`.
 */
import { validateVehicleCheck, VEHICLE_LIMITS } from './sweptPath'
import type { DesignVehicle, LoadSpan, VehicleUnit } from './types'

/** Vehicles a project keeps in its library. */
export const MAX_LIBRARY_VEHICLES = 40
/** Largest vehicle file read. */
export const MAX_VEHICLE_FILE_BYTES = 1_000_000
export const VEHICLE_FILE_SCHEMA = 'pgmaps-vehicle-library-v1'

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`${label} must be an object.`)
  return value as Record<string, unknown>
}
function number(value: unknown, label: string, [min, max]: readonly [number, number]): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw Error(`${label} must be between ${min} and ${max}.`)
  return value
}
function list(value: unknown, label: string, max: number, min = 0): unknown[] {
  if (!Array.isArray(value) || value.length > max || value.length < min)
    throw Error(`${label} must contain ${min}–${max} entries.`)
  return value
}

/** Reads one design vehicle, keeping only known fields; throws on anything out of range. */
export function parseDesignVehicle(raw: unknown): DesignVehicle {
  const v = object(raw, 'Design vehicle')
  const units = list(v.units, 'Vehicle units', VEHICLE_LIMITS.units, 1).map((rawUnit): VehicleUnit => {
    const u = object(rawUnit, 'Vehicle unit')
    return {
      name: typeof u.name === 'string' ? u.name.slice(0, 100) : 'Unit',
      wheelbaseM: number(u.wheelbaseM, 'Unit wheelbase', VEHICLE_LIMITS.wheelbaseM),
      frontOverhangM: number(u.frontOverhangM, 'Unit front overhang', VEHICLE_LIMITS.overhangM),
      rearOverhangM: number(u.rearOverhangM, 'Unit rear overhang', VEHICLE_LIMITS.overhangM),
      hitchOffsetM: number(u.hitchOffsetM, 'Unit hitch offset', VEHICLE_LIMITS.hitchOffsetM),
    }
  })
  const vehicle: DesignVehicle = {
    name: typeof v.name === 'string' ? v.name.slice(0, 200) : 'Design vehicle',
    // An emptied source field is simply absent, not an invalid file.
    ...(typeof v.source === 'string' && v.source.trim() ? { source: v.source.slice(0, 2000) } : {}),
    widthM: number(v.widthM, 'Vehicle width', VEHICLE_LIMITS.widthM),
    units,
    ...(v.steeringLockDeg === undefined
      ? {}
      : { steeringLockDeg: number(v.steeringLockDeg, 'Steering lock', VEHICLE_LIMITS.steeringLockDeg) }),
    ...(v.loads === undefined
      ? {}
      : {
          loads: list(v.loads, 'Vehicle loads', VEHICLE_LIMITS.loads).map((rawLoad): LoadSpan => {
            const l = object(rawLoad, 'Vehicle load')
            const end = (rawEnd: unknown, label: string) => {
              const e = object(rawEnd, label)
              return {
                unit: number(e.unit, `${label} unit`, [0, units.length - 1]),
                behindPivotM: number(e.behindPivotM, `${label} position`, VEHICLE_LIMITS.loadBunkM),
              }
            }
            if (l.lengthMode !== undefined && l.lengthMode !== 'from-bunks' && l.lengthMode !== 'rigid')
              throw Error('A load’s length is rigid or measured from each bunk.')
            return {
              name: typeof l.name === 'string' ? l.name.slice(0, 100) : 'Load',
              front: end(l.front, 'Load front bunk'),
              rear: end(l.rear, 'Load rear bunk'),
              aheadOfFrontBunkM: number(l.aheadOfFrontBunkM, 'Load ahead of front bunk', VEHICLE_LIMITS.loadOverhangM),
              behindRearBunkM: number(l.behindRearBunkM, 'Load behind rear bunk', VEHICLE_LIMITS.loadOverhangM),
              ...(l.widthM === undefined ? {} : { widthM: number(l.widthM, 'Load width', VEHICLE_LIMITS.widthM) }),
              ...(l.lengthMode === 'rigid' ? { lengthMode: 'rigid' as const } : {}),
            }
          }),
        }),
  }
  validateVehicleCheck({ vehicle, direction: 'both', clearanceM: 0 })
  return vehicle
}

const nameKey = (name: string) => name.trim().toLocaleLowerCase('en-CA')

/** Reads a project's vehicle library: valid vehicles with distinct, non-empty names. */
export function parseVehicleLibrary(raw: unknown): DesignVehicle[] {
  const vehicles = list(raw, 'Vehicle library', MAX_LIBRARY_VEHICLES).map(parseDesignVehicle)
  const seen = new Set<string>()
  for (const vehicle of vehicles) {
    const key = nameKey(vehicle.name)
    if (!key) throw Error('Every vehicle in the library needs a name.')
    if (seen.has(key)) throw Error(`The vehicle library has two vehicles named “${vehicle.name.trim()}”.`)
    seen.add(key)
  }
  return vehicles
}

/** Adds a vehicle to the library, replacing the one of the same name. */
export function saveToLibrary(library: readonly DesignVehicle[], vehicle: DesignVehicle): DesignVehicle[] {
  const saved = parseDesignVehicle(structuredClone(vehicle))
  if (!nameKey(saved.name)) throw Error('Name the vehicle before saving it.')
  const index = library.findIndex((v) => nameKey(v.name) === nameKey(saved.name))
  if (index < 0 && library.length >= MAX_LIBRARY_VEHICLES)
    throw Error(`A project keeps at most ${MAX_LIBRARY_VEHICLES} vehicles; remove one first.`)
  return index < 0 ? [...library, saved] : library.map((v, i) => (i === index ? saved : v))
}

export function removeFromLibrary(library: readonly DesignVehicle[], name: string): DesignVehicle[] {
  return library.filter((v) => nameKey(v.name) !== nameKey(name))
}

/** The library as a vehicle file other projects can import. */
export function serializeVehicleFile(vehicles: readonly DesignVehicle[]): string {
  return JSON.stringify({ schema: VEHICLE_FILE_SCHEMA, vehicles: parseVehicleLibrary(vehicles) }, null, 2) + '\n'
}

/**
 * Merges a vehicle file into the library: a vehicle with a name already there replaces it. The
 * whole file is checked first, so a bad entry changes nothing.
 */
export function importVehicleFile(
  library: readonly DesignVehicle[],
  text: string,
): { library: DesignVehicle[]; added: number; replaced: number } {
  if (text.length > MAX_VEHICLE_FILE_BYTES) throw Error('A vehicle file must be at most 1 MB.')
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw Error('The vehicle file is not valid JSON.')
  }
  const file = object(raw, 'Vehicle file')
  if (file.schema !== VEHICLE_FILE_SCHEMA) throw Error(`Use a ${VEHICLE_FILE_SCHEMA} vehicle file.`)
  const incoming = parseVehicleLibrary(file.vehicles)
  let next = [...library],
    added = 0,
    replaced = 0
  for (const vehicle of incoming) {
    if (next.some((v) => nameKey(v.name) === nameKey(vehicle.name))) replaced++
    else added++
    next = saveToLibrary(next, vehicle)
  }
  return { library: next, added, replaced }
}
