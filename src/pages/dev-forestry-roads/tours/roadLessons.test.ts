import { describe, expect, it } from 'vitest'
import { parseTutorialManifest, readTutorialStatePath, type TutorialManifest } from 'tourkit/core'
import { validateTutorialLesson } from 'tourkit/validation'
import { workspaceCommands } from '@/components/interfaces/workspaceCommands'
import { analyzeRoad } from '../engine'
import { createDemoProject, demoTerrain } from '../terrain'
import { ROAD_LESSONS, roadLesson } from './roadLessons'
import { trainingSnapshot as trainingSnapshotFor } from './trainingSnapshot.testSupport'
import { ROAD_LESSON_FIXTURES, fixtureLaunchSearch } from './roadLessonFixtures'
import { EXPORT_ITEMS } from '../exportCatalog'
import {
  ROAD_EDITOR_COMMANDS,
  ROAD_TOUR_ACTIONS,
  ROAD_TOUR_ACTION_IDS,
  ROAD_TOUR_ANCHORS,
  roadCommandAnchor,
  roadCompareRowAnchor,
  roadFilesOutputAnchor,
  roadPviLevelAnchor,
  roadReviewActionAnchor,
  roadWorkflowAnchor,
  roadTourContextActions,
} from './roadTour'

const anchors = new Set<string>([
  ...Object.values(ROAD_TOUR_ANCHORS),
  ...Object.keys(workspaceCommands).map(roadCommandAnchor),
  ...Object.keys(ROAD_EDITOR_COMMANDS).map(roadWorkflowAnchor),
  ...EXPORT_ITEMS.map((item) => roadFilesOutputAnchor(item.kind)),
  ...createDemoProject().alignments.map((road) => roadCompareRowAnchor(road.id)),
  roadPviLevelAnchor(1),
  roadReviewActionAnchor('standards'),
])
const steps = (manifest: TutorialManifest) => manifest.chapters.flatMap((chapter) => chapter.steps)
const trainingSnapshot = trainingSnapshotFor()

describe.each(ROAD_LESSONS.map((lesson) => [lesson.id, lesson] as const))('road lesson %s', (id, lesson) => {
  const load = async () => parseTutorialManifest(await lesson.load())

  it('is a valid Tourkit manifest under its own ID, with a guide that exists', async () => {
    const manifest = await load()
    expect(manifest.id).toBe(id)
    expect(Object.keys(ROAD_LESSON_FIXTURES)).toContain(manifest.launch.fixture)
    expect(manifest.docs).toBe(`/help/${id}`)
  })

  it('names only the designer’s actions, commands and anchors', async () => {
    for (const step of steps(await load())) {
      if (step.anchor) expect(anchors, step.id).toContain(step.anchor.id)
      if (step.target) expect(anchors, step.id).toContain(step.target.id)
      if (!step.action) continue
      expect(ROAD_TOUR_ACTION_IDS, step.id).toContain(step.action.id)
      if (step.action.id === ROAD_TOUR_ACTIONS.command)
        expect(Object.keys(workspaceCommands), step.id).toContain(step.action.args?.command)
    }
  })

  it('checks only paths the snapshot has, and every view it needs can be restored', async () => {
    for (const step of steps(await load())) {
      for (const clause of step.check?.all ?? [])
        expect(readTutorialStatePath(trainingSnapshot, clause.path), `${step.id}: ${clause.path}`).not.toBeUndefined()
      if (step.context) expect(roadTourContextActions(step.context), step.id).not.toHaveLength(0)
    }
  })

  it('passes Tourkit’s lesson validator against the designer’s declared actions', async () => {
    const report = await validateTutorialLesson(await lesson.load(), {
      actionIds: [...ROAD_TOUR_ACTION_IDS],
      fixtureIds: Object.keys(ROAD_LESSON_FIXTURES),
      initialSnapshot: trainingSnapshot,
    })
    expect(report.findings.filter((finding) => finding.severity === 'error')).toEqual([])
    expect(report.playable).toBe(true)
  })
})

describe.each(Object.entries(ROAD_LESSON_FIXTURES))('lesson fixture %s', (_id, fixture) => {
  it('sets up only through the designer’s actions and registry commands', () => {
    for (const action of fixture.setup) {
      expect(ROAD_TOUR_ACTION_IDS).toContain(action.id)
      if (action.id === ROAD_TOUR_ACTIONS.command)
        expect(Object.keys(workspaceCommands)).toContain(action.args?.command)
    }
  })

  it('opens with the lesson still requested and the address’s other parameters kept', () => {
    const search = fixtureLaunchSearch('?interface=ribbon&tour=station-200', fixture, {
      id: 'station-200',
      mode: 'watch',
    })
    const params = new URLSearchParams(search)
    expect(params.get('interface')).toBe('ribbon')
    expect(params.get('tour')).toBe('station-200')
    expect(params.get('tourMode')).toBe('watch')
    for (const [key, value] of Object.entries(fixture.params)) expect(params.get(key)).toBe(value)
  })
})

describe('the training fixture', () => {
  it('is the training project, at 0+000 with the cross-section shown', () => {
    const fixture = ROAD_LESSON_FIXTURES['hillside-training']
    expect(fixture.matches(trainingSnapshot)).toBe(true)
    expect(fixture.matches({ ...trainingSnapshot, project: { training: false } })).toBe(false)
    expect(fixture.setup.map((action) => action.args)).toEqual([
      { chainage: 0 },
      { command: 'crossSection' },
      { anchor: 'road.section.readout' },
    ])
  })
})

describe('station-200 readings', () => {
  it('match the training road as the designer calculates it', async () => {
    const project = createDemoProject()
    const road = project.alignments[0]
    const analysis = analyzeRoad(road, demoTerrain, project.settings)
    const station = analysis.stations.find((s) => Math.abs(s.chainage - 200) < 1e-6)!
    const text = JSON.stringify(await roadLesson('station-200')!.load())
    const grade = `${station.gradePercent!.toFixed(1)}%`
    const ground = station.groundElevation!.toFixed(2)
    const formation = station.designElevation!.toFixed(2)
    const depth = (station.groundElevation! - station.designElevation!).toFixed(2)
    expect([grade, ground, formation, depth]).toEqual(['7.3%', '704.53', '702.50', '2.03'])
    for (const reading of [`climbs at ${grade}`, `${ground} m`, `${formation} m`, `Cut Dp reads ${depth} m`])
      expect(text).toContain(reading)
    expect(text).toContain(`${Math.round(analysis.length).toLocaleString('en-CA')} m road`)
    expect(text).toContain(`${project.settings.maxGradePercent}% grade limit`)
  })
})
