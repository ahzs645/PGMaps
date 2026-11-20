import { describe, expect, it, vi } from 'vitest'
import type { TutorialSemanticAction } from 'tourkit/core'
import { workspaceCommands } from '@/pages/dev-forestry-roads/interface/workspaceCommands'
import {
  ROAD_EDITOR_COMMANDS,
  ROAD_TOUR_ACTIONS,
  ROAD_TOUR_ACTION_IDS,
  createRoadTourExecutor,
  createRoadTourSnapshotMemo,
  roadTourContextActions,
  roadAnchorPlacement,
  roadTourReturnAction,
  withAnchorPlacement,
  type RoadTourPage,
  type RoadTourToolbar,
} from './roadTour'
import layouts from '../../../../public/workspace-layouts.json'
import { TRAINING_SNAPSHOT_INPUT, trainingSnapshot } from './trainingSnapshot.testSupport'

const act = (id: string, args?: TutorialSemanticAction['args']): TutorialSemanticAction =>
  args ? { id, args, match: 'subset' } : { id, match: 'subset' }

describe('the road lesson snapshot', () => {
  it('rounds what a person reads or selects, and names the panes and editor on screen', () => {
    const snapshot = trainingSnapshot({ station: 199.96, pviLevels: [688.0999999, 712.5] })
    expect(snapshot.station).toEqual({ metre: 200, chainage: 200 })
    expect(snapshot.panes).toEqual({ plan: true, profile: true, detail: true })
    expect(snapshot.vertical.levels).toEqual([688.1, 712.5])
    expect(snapshot.host).toEqual({ view: 'section', tab: 'design' })
    expect(snapshot.roads).toEqual({ count: 2, activeId: 'demo-main', groundShare: 100 })
  })

  it('has no view or editor while they are off screen, and no output while Save & export is shut', () => {
    const snapshot = trainingSnapshot({ visiblePanes: ['plan'], workflow: { editor: 'review', shown: false } })
    expect(snapshot.host).toEqual({ view: null, tab: null })
    expect(snapshot.files.output).toBeNull()
    expect(trainingSnapshot({ dialog: 'files', filesOutput: 'csv' }).files.output).toBe('csv')
  })

  it('lists open sections as records a check can match by name', () => {
    expect(trainingSnapshot({ openSections: ['Vertical alignment', 'Import options'] }).sections.open).toEqual([
      { name: 'Import options' },
      { name: 'Vertical alignment' },
    ])
  })

  it('keeps the same object while nothing a check reads has changed', () => {
    const memo = createRoadTourSnapshotMemo()
    const first = memo(TRAINING_SNAPSHOT_INPUT)
    expect(memo({ ...TRAINING_SNAPSHOT_INPUT, station: 0.04 })).toBe(first)
    expect(memo({ ...TRAINING_SNAPSHOT_INPUT, station: 1 })).not.toBe(first)
  })
})

describe('Watch and recovery actions', () => {
  const page = (): RoadTourPage => ({
    isCommand: (id) => ['crossSection', 'profile', 'gradeDiagram'].includes(id),
    runCommand: vi.fn(),
    selectStation: vi.fn(),
    selectRoad: vi.fn(),
    setPviLevel: vi.fn(),
    setTemplateField: vi.fn(),
    revealSection: vi.fn(),
    sketch: vi.fn(),
    setImportDatum: vi.fn(),
    importFile: vi.fn(async () => {}),
    selectInterface: vi.fn(),
    selectLayoutPreset: vi.fn(),
    setFilesOutput: vi.fn(),
    saveFile: vi.fn(async () => {}),
    closeDialog: vi.fn(),
    reopenSavedCopy: vi.fn(async () => {}),
    recordCrossings: vi.fn(),
    showAnchor: vi.fn(),
  })

  it('runs each action through the page operation its control uses', async () => {
    const p = page()
    const execute = createRoadTourExecutor(p)
    execute(act(ROAD_TOUR_ACTIONS.command, { command: 'gradeDiagram' }))
    execute(act(ROAD_TOUR_ACTIONS.station, { chainage: 200 }))
    execute(act(ROAD_TOUR_ACTIONS.selectRoad, { id: 'demo-contour' }))
    execute(act(ROAD_TOUR_ACTIONS.pviLevel, { pvi: 1, elevation: 688.1 }))
    execute(act(ROAD_TOUR_ACTIONS.templateField, { field: 'leftWidth', value: 4 }))
    execute(act(ROAD_TOUR_ACTIONS.revealSection, { editor: 'design', section: 'Vertical alignment' }))
    execute(
      act(ROAD_TOUR_ACTIONS.sketch, {
        stroke: [
          [0, 0],
          [1, 1],
        ],
        metresPerPixel: 0.4,
      }),
    )
    execute(act(ROAD_TOUR_ACTIONS.importDatum, { value: 'Synthetic training metres' }))
    await execute(act(ROAD_TOUR_ACTIONS.importFile, { kind: 'terrain', path: 'help/terrain/training-slope.tif' }))
    execute(act(ROAD_TOUR_ACTIONS.selectInterface, { id: 'guided' }))
    execute(act(ROAD_TOUR_ACTIONS.selectLayoutPreset, { preset: 'linked' }))
    execute(act(ROAD_TOUR_ACTIONS.filesOutput, { kind: 'csv' }))
    await execute(act(ROAD_TOUR_ACTIONS.saveFile, { kind: 'project' }))
    execute(act(ROAD_TOUR_ACTIONS.closeDialog))
    await execute(act(ROAD_TOUR_ACTIONS.reopenSavedCopy))
    execute(act(ROAD_TOUR_ACTIONS.recordCrossings))
    execute(act(ROAD_TOUR_ACTIONS.showAnchor, { anchor: 'road.road' }))
    expect(p.runCommand).toHaveBeenCalledWith('gradeDiagram')
    expect(p.selectStation).toHaveBeenCalledWith(200)
    expect(p.selectRoad).toHaveBeenCalledWith('demo-contour')
    expect(p.setPviLevel).toHaveBeenCalledWith(1, 688.1)
    expect(p.setTemplateField).toHaveBeenCalledWith('leftWidth', 4)
    expect(p.revealSection).toHaveBeenCalledWith('design', 'Vertical alignment', true)
    expect(p.sketch).toHaveBeenCalledWith(
      [
        [0, 0],
        [1, 1],
      ],
      0.4,
    )
    expect(p.setImportDatum).toHaveBeenCalledWith('Synthetic training metres')
    expect(p.importFile).toHaveBeenCalledWith('terrain', 'help/terrain/training-slope.tif')
    expect(p.selectInterface).toHaveBeenCalledWith('guided')
    expect(p.selectLayoutPreset).toHaveBeenCalledWith('linked')
    expect(p.setFilesOutput).toHaveBeenCalledWith('csv')
    expect(p.saveFile).toHaveBeenCalledWith('project')
    expect(p.closeDialog).toHaveBeenCalled()
    expect(p.reopenSavedCopy).toHaveBeenCalled()
    expect(p.recordCrossings).toHaveBeenCalled()
    expect(p.showAnchor).toHaveBeenCalledWith('road.road', true)
  })

  it('names every action it routes', () => {
    expect([...ROAD_TOUR_ACTION_IDS].sort()).toEqual(Object.values(ROAD_TOUR_ACTIONS).sort())
  })

  it('refuses what it does not know rather than doing nothing', () => {
    const execute = createRoadTourExecutor(page())
    expect(() => execute(act('road.unknown'))).toThrow('no lesson action')
    expect(() => execute(act(ROAD_TOUR_ACTIONS.command, { command: 'nope' }))).toThrow('no command "nope"')
    expect(() => execute(act(ROAD_TOUR_ACTIONS.station, { chainage: 'x' }))).toThrow('must be a number')
    expect(() => execute(act(ROAD_TOUR_ACTIONS.importFile, { kind: 'terrain', path: '../secret' }))).toThrow(
      'only its own sample files',
    )
    expect(() => execute(act(ROAD_TOUR_ACTIONS.importFile, { kind: 'shapes', path: 'help/a/b.tif' }))).toThrow(
      'cannot import',
    )
    expect(() => execute(act(ROAD_TOUR_ACTIONS.saveFile, { kind: 'report-pdf' }))).toThrow('does not save')
    expect(() => execute(act(ROAD_TOUR_ACTIONS.sketch, { stroke: [[0, 0]], metresPerPixel: 1 }))).toThrow('two or more')
  })

  it('brings back an anchor it knows where to find, and offers nothing for one always on screen', () => {
    expect(roadTourReturnAction('road.road')).toEqual(act(ROAD_TOUR_ACTIONS.showAnchor, { anchor: 'road.road' }))
    expect(roadTourReturnAction('road.vertical.level.1')?.args).toEqual({ anchor: 'road.vertical.level.1' })
    expect(roadTourReturnAction('road.compare.row.demo-contour')?.args).toEqual({
      anchor: 'road.compare.row.demo-contour',
    })
    expect(roadTourReturnAction('road.station')).toBeNull()
    expect(roadTourReturnAction('road.files.save')).toBeNull()
    expect(roadTourReturnAction(undefined)).toBeNull()
  })

  it('restores a detail view or a workflow editor by the command that opens it', () => {
    expect(roadTourContextActions({ label: 'grade', all: [{ path: 'host.view', equals: 'grade' }] })).toEqual([
      act(ROAD_TOUR_ACTIONS.command, { command: 'gradeDiagram' }),
    ])
    expect(roadTourContextActions({ label: 'review', all: [{ path: 'host.tab', equals: 'review' }] })).toEqual([
      act(ROAD_TOUR_ACTIONS.command, { command: 'review' }),
    ])
    expect(roadTourContextActions({ label: 'page', all: [{ path: 'host.page', equals: 'x' }] })).toEqual([])
  })

  it('opens each workflow editor by a registry command whose editor it is', () => {
    for (const [editor, command] of Object.entries(ROAD_EDITOR_COMMANDS))
      expect((workspaceCommands as Record<string, { editor?: string }>)[command]?.editor, editor).toBe(editor)
  })
})

describe('anchor placement in each interface', () => {
  const toolbar = (id: string) =>
    (layouts as { id: string; toolbar?: RoadTourToolbar }[]).find((layout) => layout.id === id)?.toolbar

  it('finds the road switcher on the Ribbon tab that holds it, and leaves the header switcher alone', () => {
    expect(roadAnchorPlacement('road.road', toolbar('ribbon'))).toEqual([{ kind: 'group', group: 'Road' }])
    expect(roadAnchorPlacement('road.road', toolbar('workbench'))).toEqual([])
    expect(roadAnchorPlacement('road.road', toolbar('guided'))).toEqual([])
  })

  it('points a workflow tab at the Ribbon tab that hosts its editor, and at the sidebar elsewhere', () => {
    expect(roadAnchorPlacement('road.workflow.engineering', toolbar('ribbon'))).toEqual([
      { kind: 'group', group: 'Engineering' },
    ])
    expect(roadAnchorPlacement('road.workflow.engineering', toolbar('guided'))).toEqual([{ kind: 'controls' }])
    expect(roadAnchorPlacement('road.workflow.engineering', toolbar('dashboard'))).toEqual([{ kind: 'controls' }])
  })

  it('opens the editor, and the folded section, that holds an editor control', () => {
    expect(roadAnchorPlacement('road.design.roadName', toolbar('ribbon'))).toEqual([
      { kind: 'editor', editor: 'design' },
    ])
    expect(roadAnchorPlacement('road.vertical.level.2', undefined)).toEqual([
      { kind: 'editor', editor: 'design' },
      { kind: 'section', editor: 'design', section: 'Vertical alignment' },
    ])
    expect(roadAnchorPlacement('road.crossings.record', undefined)).toEqual([
      { kind: 'editor', editor: 'engineering' },
      { kind: 'section', editor: 'engineering', section: 'Stream crossing estimates' },
    ])
  })

  it('selects the group holding a command, shows a pane by its command, and leaves dialogs to their step', () => {
    expect(roadAnchorPlacement('road.command.sketch', toolbar('ribbon'))).toEqual([{ kind: 'group', group: 'Road' }])
    expect(roadAnchorPlacement('road.command.sketch', toolbar('guided'))).toEqual([
      { kind: 'group', group: 'Alignment' },
    ])
    expect(roadAnchorPlacement('road.section.readout', toolbar('ribbon'))).toEqual([
      { kind: 'pane', pane: 'detail', command: 'crossSection' },
      { kind: 'details' },
    ])
    expect(roadAnchorPlacement('road.compare.row.demo-contour', undefined)).toEqual([
      { kind: 'pane', pane: 'detail', command: 'compare' },
    ])
    expect(roadAnchorPlacement('road.files.save', toolbar('ribbon'))).toEqual([])
    expect(roadAnchorPlacement('road.station', toolbar('ribbon'))).toEqual([])
  })

  it("puts every anchored step's anchor on screen first, before any prepare of its own", () => {
    const manifest = {
      chapters: [
        {
          steps: [
            { id: 'a', anchor: { id: 'road.road' } },
            { id: 'b', anchor: { id: 'road.files.save' } },
            { id: 'c' },
            {
              id: 'd',
              anchor: { id: 'road.design.roadName' },
              prepare: [act(ROAD_TOUR_ACTIONS.command, { command: 'profile' })],
            },
          ],
        },
      ],
    } as unknown as Parameters<typeof withAnchorPlacement>[0]
    const steps = withAnchorPlacement(manifest).chapters![0].steps
    expect(steps[0].prepare).toEqual([act(ROAD_TOUR_ACTIONS.showAnchor, { anchor: 'road.road', panes: false })])
    expect(steps[1].prepare).toBeUndefined()
    expect(steps[2].prepare).toBeUndefined()
    expect(steps[3].prepare?.map((action) => action.id)).toEqual([
      ROAD_TOUR_ACTIONS.showAnchor,
      ROAD_TOUR_ACTIONS.command,
    ])
  })
})
