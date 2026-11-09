/**
 * The design standards as one editable set: the record in `project.standards` together with the two
 * limits that live in `project.settings`. Pure, with no DOM or network access.
 */
import { DEFAULT_DESIGN_STANDARDS, parseDesignStandards, type DesignStandards } from './designStandards'
import { isoDate } from './projectIssue'
import { DEFAULT_VEHICLE_CHECK, VEHICLE_PRESETS } from './sweptPath'
import type { Alignment, RoadProject, RoadSettings, VehicleCheck } from './types'

export interface JobStandards {
  /** `settings.maxGradePercent`: the sustained limit, and the favourable one when an adverse limit is set. */
  maxGradePercent: number
  /** `settings.minRadius`. */
  minRadius: number
  standards: DesignStandards
}

export const jobStandardsOf = (project: Pick<RoadProject, 'settings' | 'standards'>): JobStandards => ({
  maxGradePercent: project.settings.maxGradePercent,
  minRadius: project.settings.minRadius,
  standards: project.standards ?? DEFAULT_DESIGN_STANDARDS,
})

/** The starting set for a new project, from the workspace defaults and the starting template. */
export const startingJobStandards = (
  settings: Pick<RoadSettings, 'maxGradePercent' | 'minRadius'>,
  runningSurfaceWidthM: number,
): JobStandards => ({
  maxGradePercent: settings.maxGradePercent,
  minRadius: settings.minRadius,
  standards: { ...DEFAULT_DESIGN_STANDARDS, runningSurfaceWidthM },
})

/**
 * Keeps the record one the project file accepts while it is being typed: a short-pitch allowance
 * has both its numbers or neither, and an adverse limit never sits above the sustained one.
 */
export function settleJobStandards(next: JobStandards, previous: JobStandards): JobStandards {
  const s = { ...next.standards }
  const hadPitch = previous.standards.shortPitchGradePercent !== null
  if ((s.shortPitchGradePercent === null) !== (s.shortPitchMaxLengthM === null)) {
    if (hadPitch) {
      // One of a pair was cleared: the allowance is off.
      s.shortPitchGradePercent = null
      s.shortPitchMaxLengthM = null
    } else {
      s.shortPitchGradePercent ??= Math.min(100, next.maxGradePercent + 6)
      s.shortPitchMaxLengthM ??= 100
    }
  }
  if (s.adverseGradePercent !== null && s.adverseGradePercent > next.maxGradePercent)
    s.adverseGradePercent = next.maxGradePercent
  return { ...next, standards: s }
}

export const vehiclePreset = (id: string | null) => VEHICLE_PRESETS.find((preset) => preset.id === id)

/** The swept-path check a road gets from the standards' design vehicle, or null when none is a preset. */
export function standardVehicleCheck(standards: DesignStandards | undefined): VehicleCheck | null {
  const preset = vehiclePreset(standards?.designVehicle ?? null)
  return preset ? { ...DEFAULT_VEHICLE_CHECK, vehicle: structuredClone(preset.vehicle) } : null
}

/** Writes the set back to a project: the two limits into `settings`, the rest into `standards`. */
export function withJobStandards<P extends Pick<RoadProject, 'settings' | 'standards'>>(
  project: P,
  job: JobStandards,
): P {
  return {
    ...project,
    settings: { ...project.settings, maxGradePercent: job.maxGradePercent, minRadius: job.minRadius },
    standards: parseDesignStandards(job.standards),
  }
}

/**
 * A new project takes the standards its creator entered: the limits, and on each starting road the
 * running-surface width and the design vehicle's swept-path check. Confirmed on the day it is made.
 */
export function applyJobStandardsToNewProject<P extends Pick<RoadProject, 'settings' | 'standards' | 'alignments'>>(
  project: P,
  job: JobStandards,
  today: Date = new Date(),
): P {
  const width = job.standards.runningSurfaceWidthM
  const check = standardVehicleCheck(job.standards)
  const road = (alignment: Alignment): Alignment =>
    alignment.mappedRoad
      ? alignment
      : {
          ...alignment,
          ...(width === null
            ? {}
            : { template: { ...alignment.template, leftWidth: width / 2, rightWidth: width / 2 } }),
          ...(check && !alignment.vehicleCheck ? { vehicleCheck: check } : {}),
        }
  return {
    ...withJobStandards(project, { ...job, standards: { ...job.standards, confirmedOn: isoDate(today) } }),
    alignments: project.alignments.map(road),
  }
}
