import { describe, expect, it } from 'vitest'
import { parseProject, serializeProject } from './project'
import { VEHICLE_PRESETS } from './sweptPath'
import { createDemoProject } from './terrain'
import type { DesignVehicle } from './types'
import {
  importVehicleFile,
  MAX_LIBRARY_VEHICLES,
  parseDesignVehicle,
  parseVehicleLibrary,
  removeFromLibrary,
  saveToLibrary,
  serializeVehicleFile,
} from './vehicleLibrary'

const unit = (name: string, wheelbaseM: number, hitchOffsetM = 0) => ({
  name,
  wheelbaseM,
  frontOverhangM: 0.5,
  rearOverhangM: 0.5,
  hitchOffsetM,
})
/** A lowbed with jeep, booster and dollies: six units. */
const lowbed: DesignVehicle = {
  name: 'Lowbed with jeep and booster',
  source: 'Contractor fleet sheet, unit 12',
  widthM: 3.2,
  units: [
    unit('Tractor', 6.2, -0.3),
    unit('Jeep', 3.5, -0.2),
    unit('Lowbed', 9, 0),
    unit('Dolly', 2.5, 0),
    unit('Booster', 4, 0),
    unit('Rear dolly', 2),
  ],
  steeringLockDeg: 32,
}

describe('design vehicles', () => {
  it('reads up to six units and refuses a seventh', () => {
    expect(parseDesignVehicle(lowbed)).toEqual(lowbed)
    expect(() => parseDesignVehicle({ ...lowbed, units: [...lowbed.units, unit('Extra', 3)] })).toThrow(/1–6 entries/)
  })

  it('keeps a rigid load mode and refuses an unknown one', () => {
    const lg5 = structuredClone(VEHICLE_PRESETS.find((p) => p.id === 'bc-moti-lg5')!.vehicle)
    lg5.loads![0].lengthMode = 'rigid'
    expect(parseDesignVehicle(lg5).loads![0].lengthMode).toBe('rigid')
    expect(() => parseDesignVehicle({ ...lg5, loads: [{ ...lg5.loads![0], lengthMode: 'stretchy' }] })).toThrow(
      /rigid or measured/,
    )
    // A load bunk may sit on any of the six units.
    const loaded = {
      ...lowbed,
      loads: [{ ...lg5.loads![0], front: { unit: 2, behindPivotM: 1 }, rear: { unit: 5, behindPivotM: 1 } }],
    }
    expect(parseDesignVehicle(loaded).loads![0].rear.unit).toBe(5)
  })
})

describe('the project’s vehicle library', () => {
  it('saves, replaces by name and removes', () => {
    let library = saveToLibrary([], lowbed)
    library = saveToLibrary(library, { ...lowbed, name: ' lowbed WITH jeep and booster ', widthM: 3 })
    expect(library).toHaveLength(1)
    expect(library[0].widthM).toBe(3)
    library = saveToLibrary(library, VEHICLE_PRESETS[0].vehicle)
    expect(library).toHaveLength(2)
    expect(removeFromLibrary(library, 'LOWBED with jeep and booster ')).toHaveLength(1)
    expect(() => saveToLibrary([], { ...lowbed, name: '  ' })).toThrow(/Name the vehicle/)
    const full = Array.from({ length: MAX_LIBRARY_VEHICLES }, (_, i) => ({ ...lowbed, name: `Truck ${i}` }))
    expect(() => saveToLibrary(full, { ...lowbed, name: 'One more' })).toThrow(/at most 40/)
  })

  it('is saved in the project file, validated, and older files still open without it', () => {
    const project = createDemoProject()
    const restored = parseProject(serializeProject({ ...project, vehicleLibrary: [lowbed] }))
    expect(restored.vehicleLibrary).toEqual([lowbed])
    expect(parseProject(serializeProject(project)).vehicleLibrary).toBeUndefined()
    expect(() => parseProject({ ...project, vehicleLibrary: [lowbed, { ...lowbed }] })).toThrow(/two vehicles named/)
    expect(() => parseProject({ ...project, vehicleLibrary: [{ ...lowbed, widthM: 9 }] })).toThrow(/Vehicle width/)
  })

  it('exports and imports a vehicle file, merging by name', () => {
    const text = serializeVehicleFile([lowbed, VEHICLE_PRESETS[0].vehicle])
    expect(parseVehicleLibrary(JSON.parse(text).vehicles)).toHaveLength(2)
    const merged = importVehicleFile([{ ...lowbed, widthM: 2.9 }], text)
    expect(merged).toMatchObject({ added: 1, replaced: 1 })
    expect(merged.library[0].widthM).toBe(3.2)
    expect(() => importVehicleFile([], '{')).toThrow(/not valid JSON/)
    expect(() => importVehicleFile([], JSON.stringify({ schema: 'other', vehicles: [] }))).toThrow(/vehicle file/)
    // A bad entry changes nothing.
    expect(() =>
      importVehicleFile(
        [],
        JSON.stringify({
          schema: 'pgmaps-vehicle-library-v1',
          vehicles: [lowbed, { ...lowbed, name: 'Bad', units: [] }],
        }),
      ),
    ).toThrow(/Vehicle units/)
  })
})
