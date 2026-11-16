# Help and live lessons for the road designer

The road designer's help is `/help`: a page in the app, drawn with the shared UI and the help
brand (`BrandScope surface="help"`), listing thirteen lessons by topic. Each lesson has a guide
page, `/help/<lesson>`, and runs **live** in the designer over the real controls of whichever
interface is open:

- **Practise**: the learner does each step with any control that reaches its outcome. Typing 200
  in the Station box and stepping to it with the station arrows both complete "Go to station
  0+200".
- **Watch**: the lesson does each step itself, through the same operations the controls call.

Both come from [Tourkit](https://github.com/ahzs645/tourkit) (MIT), the guided-tour library that
webforms also uses. PGMaps uses its player and its lesson format and validator: no Studio,
recording, exports or review.

One manifest per lesson (`src/pages/dev-forestry-roads/tours/lessons/<id>.json`) is both: the
live lesson runs it, and the guide page prints each step's title and text from it, so the two
cannot say different things. The guide's pictures sit beside it in the catalog
(`roadLessons.ts`), because a Tourkit manifest only embeds image data; they are files under
`public/help/<lesson>/`, as are the sample files a lesson imports.

## Addresses

| Address | What opens |
| --- | --- |
| `/help`, `/help?interface=<id>` | The lessons by topic, the next one to do, and which are finished in this browser. The interface chosen is the one Practise and Watch open the designer in. |
| `/help/<lesson>` | The lesson's guide: what it needs, its steps with pictures, its sample files, Practise and Watch. |
| `/dev/forestry/road-design?example=training&tour=<lesson>&tourMode=practice\|watch` | The lesson running in the designer. Finishing or stopping it removes `tour` and `tourMode`, so a reload does not start it again; a reload while it runs offers to resume, and Tourkit replays the earlier steps' actions. |
| `/help/index.html`, `/help/<lesson>/index.html`, `/help/<lesson>/tour.html`, `/help/ribbon.html?lesson=<lesson>` | The old static help's addresses, redirected to the hub or the lesson (`legacyHelpTarget`, `helpLinks.ts`). `scripts/write-spa-fallback.mjs` writes an entry page at each, so GitHub Pages serves them. |

The designer's **Workflow help** opens `/help?interface=<the interface in use>`.

## How the parts fit

| Part | File | Job |
| --- | --- | --- |
| Help pages | `src/pages/help/` (`Help.tsx`, `HelpHome.tsx`, `HelpLesson.tsx`, `LessonActions.tsx`) | The hub and guide pages. `helpLinks.ts` (DOM-free) builds lesson and help addresses and resolves the old ones. |
| Action stream | `src/lib/tours/tourActions.ts` | What the person did, for an action-gated step. The page always reports to it; it imports no Tourkit code. |
| Launch | `src/lib/tours/tourLaunch.ts` | Reads and clears `tour` / `tourMode`. |
| Player host | `src/components/tours/TourPlayerHost.tsx`, `tours.css`, `tourStores.ts` | Tourkit's player with PGMaps' colours, DOM policy and namespaced progress and completion stores, which the help reads too. |
| Road vocabulary | `src/pages/dev-forestry-roads/tours/roadTour.ts` | Action IDs, anchors, the snapshot, Watch's executor, "Take me back" and view restoring. DOM-free. |
| Fixtures | `roadLessonFixtures.ts` | Where each lesson starts: how to recognise and open its project, and the setup for its first screen. DOM-free. |
| Lessons | `roadLessons.ts`, `lessons/*.json` | The catalog in the help's order: topic, guide pictures, sample files, and each manifest's loader. |
| Player | `RoadLessonPlayer.tsx` | Loaded with `lazy` only when the address names a lesson, so Tourkit, Zod and driver.js stay out of the designer's bundle. |

Tourkit comes from GitHub, pinned to a commit (`"tourkit": "github:ahzs645/tourkit#<sha>"`); its
`prepare` script builds `dist/` on install, and `scripts/ensure-tourkit.mjs` builds it when an
install skipped scripts (the checks job's `npm ci --ignore-scripts`). It declares React 19 as a
peer; PGMaps runs React 18, and `overrides` gives it PGMaps' React. Its player uses no React 19
API, and the e2e suites below run it on React 18. Move the pin only after running them.

The player draws its own cards with inline styles, so Tourkit's Tailwind 4 stylesheet is not
loaded and does not meet PGMaps' Tailwind 3. `tours.css` maps Tourkit's colour variables to
PGMaps' tokens, which follow the light and dark themes.

## Where a lesson starts: fixtures

Tourkit manages only the lesson's own state: where a run is (saved per tab, so a reload resumes),
which lessons are finished, and values a step captured for a later one. It cannot set up or
reset the designer. A manifest's `launch.fixture` is a name Tourkit never reads; the designer
gives it meaning in `roadLessonFixtures.ts`:

| Field | Job |
| --- | --- |
| `matches(snapshot)` | Whether the open project is the fixture. On any other project the lesson offers to open it, because its readings would be wrong there. Once setup has run the lesson keeps going whatever it opens: importing a terrain or a line, or reopening a saved file, leaves the training session, and that is part of the lesson. |
| `params` | The address parameters that open it, merged into the lesson's own address. |
| `setup` | Actions run through Watch's executor before the player mounts, in both modes and on every launch. |

`hillside-training` is the synthetic training project (`example=training`), which leaves the
person's own project saved in the browser and starts fresh on each load. Its setup selects 0+000
and shows the cross-section, so its lessons start from that screen in every interface: the
Ribbon's default layout hides the detail pane. `hillside-training-sketch` also opens the plan on
the road-free patch of the hillside (`lesson=sketch-road`, `PlanView.tsx`).

A Practice step whose outcome already holds when it opens is shown as already done; Tourkit does
not skip it silently. Setup is what keeps a lesson's own steps from being done before it starts.
Tourkit's `awaitsLearnerAction` (wait for the press even when the outcome holds) is not used: a
dropdown cannot report choosing the value it already shows, so a step waiting on it could never
finish.

## What a lesson may name

`roadLessons.test.ts` holds every lesson to these lists and runs Tourkit's own lesson validator
against them; `lessonReadings.test.ts` checks every number a lesson prints against the training
project as the designer calculates it (with the project's context features, as the page passes
them).

**Actions** (`ROAD_TOUR_ACTIONS`). Watch's executor calls the page operation the control uses and
reports nothing, so a demonstration is never counted as the learner's action.

| Action | Arguments | Watch runs |
| --- | --- | --- |
| `road.command` | `{ command }`, a `workspaceCommands` ID | the command's handler |
| `road.station.select` | `{ chainage }` | `selectStation` |
| `road.alignment.select` | `{ id }` | `selectAlignment` |
| `road.vertical.setLevel` | `{ pvi, elevation }`, absolute, 1-based | the PVI level field's update |
| `road.template.set` | `{ field, value }`, a `TEMPLATE_FIELDS` key | the template field's update |
| `road.workflow.reveal` | `{ editor, section }` | open the editor, then the section by its own toggle (as Find the best route does) |
| `road.sketch.stroke` | `{ stroke, metresPerPixel }` | the plan's sketch gesture's end, `finishSketch` |
| `road.terrain.datum` | `{ value }` | the import datum field |
| `road.file.import` | `{ kind, path }`, a sample under `help/` | the file chooser's import, with the sample fetched in place of a chosen file |
| `road.interface.select` | `{ id }` | the interface chooser's choice |
| `road.layout.select` | `{ preset }` | the screen preset picker's choice |
| `road.files.output` | `{ kind }` | choosing an output in Save & export |
| `road.files.save` | `{ kind }`, `project` or `csv` | Save & export's Save or Download, without the download; a project file is kept for the next step |
| `road.dialog.close` | | closes Save & export or the interface chooser |
| `road.project.reopen` | | Open's path for the file this lesson saved, kept in the training session (`restore` with `training`), once |
| `road.crossings.record` | | Record detected crossings |

The person's own operations are reported to the action stream by `runCommand`, the Station box's
commit and the detail view picker (which reports the view's registry command). Every other step
is graded on the snapshot.

**Anchors** (`data-tutorial-id`). A control drawn twice on screen is no anchor to Tourkit, so a
field the Ribbon also draws as a quick field carries its anchor only in its editor.

| Anchor | Where |
| --- | --- |
| `road.plan`, `road.profile`, `road.section.readout`, `road.detail.view`, `road.station` | the panes, the section readout, the detail view picker, the Station box |
| `road.command.<id>` | every registry command's button (`CommandButton`; not the quick-access copies) |
| `road.workflow.<editor>` | the sidebar's workflow tabs |
| `road.road`, `road.header.basis`, `road.design.roadName` | the road switcher, the planning-basis badge, Design's Road name |
| `road.sketch.done` | the sketch panel's Done sketching |
| `road.terrain.importOptions`, `road.terrain.datum`, `road.terrain.source` | Terrain's Import options toggle, datum field and source box |
| `road.design.verticalAlignment`, `road.vertical.level.<n>` | Vertical alignment's toggle, PVI n's level |
| `road.template.leftWidth` | Section's Left half-width |
| `road.compare.open`, `.baseline`, `.table`, `.row.<road id>` | the comparison |
| `road.engineering.quantities`, `road.quantities.cost` | Show quantities & cost breakdown, the cost table |
| `road.crossings.toggle`, `.record`, `.structure` | Stream crossing estimates |
| `road.review.verdict`, `road.review.action.<check>`, `road.review.standards` | Review |
| `road.files`, `road.files.output.<kind>`, `road.files.save` | Save & export |
| `road.interface.option.<id>` | the interface chooser's cards |

The shared pieces take an opt-in prop for this: `RoadSection toggleTutorialId`, `NumberField` and
`TemplateField tutorialId`, `RoadSelect tutorialId` (`AppSelect triggerTutorialId`),
`MapToolPanel closeTutorialId`, `ReadoutGrid data-tutorial-id`.

**Snapshot paths** (`roadTourSnapshot`): `project.training`, `interface.id`, `road.name`,
`road.lengthM`, `station.metre`, `station.chainage`, `panes.*`, `detail.view`,
`workflow.editor`, `workflow.shown`, `tool.mode`, `roads.count`, `roads.activeId`,
`roads.groundShare`, `vertical.levels`, `template.leftWidth`, `template.rightWidth`, `section.*`
(as the readout prints them), `terrain.*`, `busy`, `layout.preset`, `dialog.open`,
`files.output`, `files.saved`, `files.lastExport`, `files.openedFromFile`, `sections.open`
(`[{ name }]`, from `SectionOpenReporterContext`, which only a running lesson provides),
`crossings.records`, and `host.view` and `host.tab`, Tourkit's view vocabulary: the detail
pane's view and the workflow editor while each is on screen. A step whose `context` names one is
restored by its registry command; Practice offers **Return to this step's view**, Watch restores
it itself. An anchor missing when its step opens offers **Take me back** (`roadTourReturnAction`).

## Dialogs

A step whose check reads `dialog.*`, `files.output` or `interface.id` expects its dialog
(`roadTourStepExpectsDialog`): the player works with it open instead of pausing. Radix popovers
(a searchable dropdown's list, toolbar popovers) are `role="dialog"` but block nothing, so
PGMaps' DOM policy (`PGMAPS_TOUR_DIALOG_SELECTOR`) never pauses for them.

Save & export is a modal: while it is open the card is drawn but cannot be pressed. Every step
shown while it is open therefore completes on its check, never on Next, and a lesson's last step
is never inside it (Finish has to be pressable): export-stations ends by closing it. The
interface chooser is a native modal dialog in the browser's top layer, which hides the card; its
step completes when the chosen interface opens.

Escape stops a lesson unless a dialog is open, when the dialog takes it. A lesson never tells the
learner to press Escape to put a tool down or close something outside a dialog.

## Writing a lesson

1. Add `lessons/<id>.json`, a Tourkit manifest whose `launch.fixture` names an entry in
   `ROAD_LESSON_FIXTURES` and whose `docs` is `/help/<id>`, and an entry in `ROAD_LESSONS` with
   its topic, pictures by step ID and sample files.
2. Name the control and its outcome in the text, never the interface: the ring finds the
   control wherever the open interface puts it.
3. Prefer outcome checks on the snapshot; give an outcome step an action as well, for Watch.
   Give a reading step `completion: "continue"`, and a step that needs a view hidden in some
   interface a `context`.
4. Print only readings the designer calculates, and pin them in `lessonReadings.test.ts`.
5. Run `tests/e2e/forestry-road-lessons.spec.ts` and `forestry-road-lessons-watch.spec.ts`.

A new anchor, action or snapshot path goes in `roadTour.ts` and the tables above together.

## Limits

- One lesson runs at a time, and only in the page that opened it.
- The player's cards are drawn in `document.body`. In the designer's own full screen
  (`useElementFullscreen`) only the workspace is shown, so the cards are not.
- Practice imports and opens real files: the terrain and line lessons ask for the sample file
  from the guide, and Save and reopen downloads and opens a real `.road.json`, which keeps the
  reopened copy in this browser's projects. Watch does neither: it fetches the samples itself and
  reopens its saved copy inside the training session.
- Tourkit draws the primary button of its paused, resume and completion cards in a fixed blue
  (`#0284c7`) rather than `--tourkit-accent`. That is Tourkit's to change.
- Lesson progress (`sessionStorage`) and completions (`localStorage`) are kept under the
  `pgmaps-road-design` namespace. They are a convenience, not a record.
- Zod is about 25 KB of the lesson chunk's 72 KB gzipped (measured 16 November 2026), loaded only
  when a lesson or the help opens. The player needs it only for a few value checks; lessons are
  validated in `roadLessons.test.ts`. Dropping it from the player is a change in Tourkit, not here.
