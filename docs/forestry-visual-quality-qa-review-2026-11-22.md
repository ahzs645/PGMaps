# Visual quality — external QA review, November 2026

An external reviewer tested `/dev/forestry/visual-quality` at `a81a1e6b` and
handed back 32 work items (VQ-01 to VQ-32) with logs, screenshots, walkthroughs
from an empty site and one unmerged patch. This page records what was done with
each item between 22 and 23 November 2026, what the work turned up beyond the
review, which decisions were taken, what is still open and how it was checked.
The contract for how the page behaves is
[forestry-visual-quality.md](forestry-visual-quality.md); this page is the record
of how it got there.

The review's own files include real assessments and their sheets. They stay
outside the repository, and nothing here names a case, block or figure from
them; the benchmark items are described by what they ask, not by case.

## How the work went

1. **Triage.** Eight read-only agents checked every item against the code
   before anything changed. Most findings held. Two were overstated (VQ-20 and
   VQ-32, below), and the triage found five defects the review had not listed
   (see **Found beyond the review**).
2. **First pass**, pushed to `main` as `370485ab`: the reporting, project-state
   and capture items (VQ-01 to VQ-08, VQ-15 to VQ-19, VQ-22, the scene race
   in VQ-23, VQ-26 to VQ-28). Four review agents then read the change and found
   about thirty further defects, all fixed before the push.
3. **Second pass**, pushed as `66053e73`: mobile and accessibility (VQ-09, 10,
   21, 24, 25), the typed place, lens and eye (VQ-12, 13), the reviewed scope
   (VQ-14), captures surviving a reload (the rest of VQ-23), the reverse-run
   fix, and the defects a real-GPU browser check found.
4. **Toolkit and eye**, pushed as `b4a46c4c`: the toolkit's half of the mobile
   work (geo-toolkit PRs #22 and #23, pinned at `908d594`, with the PGMaps
   workarounds they cover removed) and the owner's decision on a view's eye.

## Item by item

| Item  | What it asked                                          | Status | Commits |
| ----- | ------------------------------------------------------ | ------ | ------- |
| VQ-01 | Keep each site's evidence on its own site              | Done   | `51157a5d`, `feb3e7fa`, `e022b6c2` |
| VQ-02 | One readiness rule for every output                    | Done   | `58381887`, `5a1321cd`, `986eda39` |
| VQ-03 | One resolved formula on every analysis figure          | Done   | `27ee8747` |
| VQ-04 | Reference evidence apart from the objective's authority | Done, decision 2 included | `b044572e`, `8e7a4f77` |
| VQ-05 | Recover work when starting a different site            | Done   | `8ae9de24` |
| VQ-06 | Competing runs never strand a capture                  | Done   | `93874ccf`, `39802eb9` |
| VQ-07 | Drawn timber and retries recoverable                   | Done   | `64521717` |
| VQ-08 | Screenshot, class pass and sheet tracked apart         | Done   | `ddff7b88`, `dc4dc6fb`, `6939f662`, `ce4c09f7`, `bf530ecf`, `7bb3643a` |
| VQ-09 | Map actions reachable at small heights                 | Done   | `cc2730ae`, toolkit #22 |
| VQ-10 | Open the requested package editor directly             | Done   | `9458d77e` |
| VQ-11 | Archive readiness and provenance on open               | Done   | see **Decisions**, decision 3 |
| VQ-12 | Exact named viewpoint in WGS84 or NAD83 UTM            | Done   | `aa3c9e2f`, `8d6332c6` |
| VQ-13 | Numeric lens and surveyed eye on planned views         | Done   | `aa3c9e2f`, `21949dac`, `4537e1a1`, `415b73ee`, `af25dcee` |
| VQ-14 | Reviewed landform and net footprint explicit           | Done   | `9900822f` |
| VQ-15 | Existing disturbance resolved at the warning           | Done   | `7ac615c0`, `65f6fe49` |
| VQ-16 | Camera positions for photos without GPS                | Done   | `35ac1fde`, `aba02ef0`, `ba27f64b` |
| VQ-17 | Photo location checked on real terrain                 | Checked on a real photo; scored benchmark with the others | `ba27f64b` |
| VQ-18 | Vegetation behind the assessed hillside                | Done   | `35ac1fde`, `ab0fe6af`, `ab03611c`, `6ca9b2b7`, `0323d88f`, `215b311c` |
| VQ-19 | Background forest on a real scene                      | Checked live on a real GPU; phones not checked | `17644d4e` |
| VQ-20 | Validate GIS imports before adoption                   | Open, in part | — |
| VQ-21 | Large archive open and the openings list               | Done   | `201e23dd` |
| VQ-22 | Open and import results in the active view             | Done   | `a9de1da4` |
| VQ-23 | Captures survive reload and archive round trips        | Done   | `9b63acd0`, `b8d8a005`, `de26b504`, `81eb1d84` |
| VQ-24 | Labels, contrast, focus and keyboard drawing           | Done   | `9458d77e`, `cc2730ae`, toolkit #22, #23 |
| VQ-25 | Short landscape layout and touch targets               | Done, one part open | `cc2730ae`, toolkit #22 |
| VQ-26 | Label modelled FS1252 inputs and report purposes       | Done   | `2b92a4c1` |
| VQ-27 | Full report contents across formats                    | Done   | `552cc67b`, `deea2118`, `a74da5c2` |
| VQ-28 | Numerical tolerance on a frozen replay                 | Done   | `f46ec893` |
| VQ-29 | Calibrate one historical sheet before claiming parity  | Open: needs the research folder | — |
| VQ-30 | Map a complete historical atlas                        | Open: needs the research folder | — |
| VQ-31 | Reproduce an isolated water study on GPUs              | Open: needs the research folder | — |
| VQ-32 | Live-source and full-build verification               | Not a PGMaps fault | — |

### Notes on the items

- **VQ-04.** The authority sentence now prints only beside a recorded
  objective, and the figures request and a withheld authority stay out of the
  report files. Archives saved before the change still carry the historical
  reference in the old field; decision 2 offers to move it (see Decisions).
- **VQ-12 and VQ-13.** A view of interest takes a typed place (`viewCoordinates.ts`:
  WGS84, or NAD83 UTM zones 7N to 11N, keeping the precision it was typed to),
  its own lens (`viewCamera.ts`) and a surveyed eye, either an elevation or a
  height above the ground. A typed eye that disagrees with the terrain by more
  than `EYE_GROUND_TOLERANCE_METERS` (3 m) is flagged for review, never
  corrected. The lens prints on a view only for the picture taken with it.
- **VQ-14.** The reviewed scope (`assessmentScope.ts`, `AssessmentScopePanel.tsx`)
  sits beside every figure: the reviewed face, its units, gross and net
  geometry, exclusions and masks, each with its source. The VIA report prints it
  as its own part (`assessment-scope.json`).
- **VQ-16 and VQ-17.** The reviewed patch (`7061aa3c`) was not merged as it
  stood: it withheld the whole stand for up to 10 s, regrew the stand when the
  road view closed, leaked open background ground into the scene package and
  offered a camera on an ambiguous fit. It was rebuilt: the core stand draws
  first and *Distant trees* is a band of its own, every skyline reader is
  searched and scored by one reader, and a near tie offers no location. The
  search was run on one real field photo on a real GPU; a scored comparison
  against surveyed camera positions belongs with VQ-29 to VQ-31.
- **VQ-20.** Half overstated: projected polygons are already refused before the
  scene changes. What is real and still open: a file is accepted in part
  without counts of adopted, skipped and rejected features, degenerate rings get
  through, and an import with no name says "Imported  from x.".
- **VQ-23.** The open site is kept in this browser (`siteCheckpoint.ts`,
  `useSiteCheckpoint.ts`): the `current` row of the `previousSites` work store,
  written in the same form as the project file's state, so a reload brings back
  the scene, its saved and shelved views and their pictures. A quick reload no
  longer lets the IndexedDB copy overwrite a newer edit.
- **VQ-25.** Touch targets, the overflow menu and the phone sheet's controls
  are done. A phone held sideways (844 × 390) still gets the desktop layout,
  because the toolkit chooses the layout by width alone; that needs a toolkit
  change.
- **VQ-32.** The review's typecheck failure and its 503 errors came from the
  reviewer's environment: both acknowledgement files are in the pinned
  submodule, and the 503s came from their network proxy. The live checks need
  running again on a working network.

## Found beyond the review

The triage and the review agents found these; each was fixed in the first pass
unless it says otherwise.

- The first *Save viewpoint* on a new site shelved the previous site's views
  into it.
- A capture's restore, run in `finally`, could move site A's road into site B
  after a switch. Every write after a switch is now guarded (`feb3e7fa`).
- A quick reload could let the IndexedDB copy of the scene overwrite a newer
  copy in `localStorage` (`9b63acd0`).
- Saved views stamped their sightline figure without the readiness rule, and
  that figure fed the analysis sheet, the report and step 4's groups away from
  the station. It is now read through `capturedSightline` (`5a1321cd`,
  `7bb3643a`).
- A view stood at was run from the pull-out's two ends, 15 m from the eye, never
  from the eye itself. Decision 1 moved new runs to the eye.
- The VIA document threw when no view had a class pass, and the VIA report was
  recorded as doing the same. Decision 4 settled both: they print.

The real-GPU check in the second pass found four more, all fixed:

- **A planned capture lost its picture on reload** (`de26b504`). The
  checkpoint's shelved set was keyed by the in-memory fingerprint and the stored
  record by its own key, so the page held two sets and `resolvePackage` picked
  the renumbered one. Sets are now paired by key or by content.
- **The first frame of a panorama had a seam** (`deea2118`). The drive camera
  re-poses when the field of view changes, so the first frame was read from the
  camera before it. Every framed frame now checks its own camera and is placed
  again, up to three times.
- **The analysis sheet's facts box dropped blocks** (`552cc67b`). It now wraps,
  shrinks, writes "and n more", then ellipsizes.
- **Show options disappeared in a wide road view** (`68f7660a`), and *Distant
  trees* switched on again showed the old failure rather than loading
  (`215b311c`).

A reverse run started during a forward run could leave the analysis on
"running"; a replaced run is now settled (`39802eb9`). A before render could
start on a stale terrain and report "not measured"; it now waits for the road
view's terrain and says so (`a74da5c2`). The race itself was not reproduced.

## Decisions

**Taken, 23 November 2026: a view's own eye feeds the run at its stand.** A
surveyed elevation already did, as a photo's altitude does. A height above the
ground now does too, at that view's stand only (`standEyeHeight`,
`viewpointStand.ts`, part of `sceneFingerprint`); where a view has both, the
elevation wins. `result.settings.observerHeightMeters` is the eye the run used,
so the analysis sheet's picture and its sightline figure always share one eye,
and the VIA report's Methods names each view that stood at its own eye
(`reportEyes`, `eyeClause`). Roads and views without an eye keep the scene's.
The two landform-finding tools and the road view video still use the scene's
eye: they suggest candidates and record pictures, and print no figure.

**Taken, 23 November 2026: a view's run stands at the eye, as calculation 2
(decision 1).** A view stood at now runs from one station at its eye
(`settings.stationsAt: 'eye'`, `runCalcVersion`); a scene or archive without
the setting is calculation 1, the pull-out's two ends, and replays exactly, and
a replay names the calculation its archive used. New scenes start at the eye;
*Simulation settings → Views stood at* switches either way. Measured on the
Purden Lake sample first: over 14 stands the perspective figure moved a median
0.07 points, and 3.8 and 9.3 points at two where one pull-out end saw over near
ground the eye does not (the main doc's **Where a view's stations stand**). The
real cases are still to be measured, when the VIA research folder is back.

**Taken, 23 November 2026: old archives' reference field (decision 2).** When a
project opens whose *Objective established by* (`sourceDocument`) names only
files the project carries, each " | "-separated part an attachment's name
(`referenceMoveOffer`, `referenceMove.ts`), step 1's receipt and the header say
so, and the receipt and the FS1252 office field offer *Move to Historical
reference*: one click appends the text to `referenceDocument` and clears
`sourceDocument`, as one ordinary edit (`movedReference`). Nothing moves on open,
a field that names anything else is never offered, and nothing else changes.
The converter that wrote the old field is not in this repository and was not
changed.

**Taken, 23 November 2026: a report with no figures prints (decision 4).** The
VIA report and the VIA document are written when no view of the package has a
class pass: every figure and picture nobody gave prints nothing, and each view
is named on the report's to-complete list (`withViewsLeftOut`) or under the
document's *Reviewer to complete* (`withViewsToComplete`), with why at the file's
end. The document no longer throws; the report's assembly already wrote every
format with no figure (`viaReport/noClassPass.test.ts`,
`viaDocument/noClassPass.test.ts`). A package holding no view at all is still
refused, with the reason.

**Taken, 23 November 2026: earlier captures are listed, never dropped.**
Captures saved under an earlier version of a planned view no longer count as
its capture, and the outputs still leave them out, but each view's open row
now lists them read-only as *Earlier captures (n)*, with the screenshot, when
it was saved and what has changed since (`earlierCaptures`,
`viewsOfInterest.ts`). Each has one action, *Keep as its own saved view*,
which clears its planned view's id and key and nothing else (`keptAsOwnView`).
This settles VQ-11: opening a project or archive now says, in the same line,
whether its saved figures are the scene's as it opens or come from an earlier
calculation of it (the file keeps the scene's fingerprint as `sceneKey`), that
there is no run yet, where its recipe is found (shipped, yours in this
browser, or not here), and how many earlier captures are listed
(`projectOpenStatus`, `projectFile.ts`).

## Still open

- Decision 1 measured on the real cases, when the VIA research folder is back.
- VQ-20's partial-acceptance counts, degenerate rings and empty import message.
- VQ-29 to VQ-31: the benchmarks need the VIA research folder, which was not on
  the machine.
- Checks on a physical phone (VQ-19 and VQ-25), and the sideways-phone layout,
  which needs a toolkit change.
- Two `VirtualResultList` faults the toolkit has not fixed: it loops on a
  hidden panel, and it takes the arrow keys from fields inside a row. PGMaps
  works round both (`stepShown.ts`, `virtualRowKeys.ts`; see
  [shared-ui.md](shared-ui.md), **Result lists**).
- The shared navbar and the ribbon name some commands differently.
- VQ-32's live checks, on a working network.

## Toolkit changes

`ahzs645/geo-toolkit` PR #22 made the map controls finger-sized on touch,
stopped the phone sheet's Hide panel button being covered and let stat tile
labels wrap. It also wrote a stat tile's note before its term, which is not
valid inside a `dl`; PR #23 put the term first and draws the note under the
label with `order`. Both are merged (`908d594`) and pinned in PGMaps
(`07164a11`, `a529ec29`), which removed the two workarounds they cover. Kept,
because they are PGMaps' own or the toolkit has not fixed them: the
*More map tools* menu (`MapControlOverflow`), the map tool toggle's
`touch:!size-11`, `MAP_CONTROL_SQUARE`, the InfoTip's touch
area, `stepShown.ts`, `virtualRowKeys.ts` and `SidebarScrollFallback`.

## Verification

At `b4a46c4c`, before the push:

- `tsc -b`, lint, format and the road designer's boundary check pass.
- Unit tests: 10,368 pass. Five files fail because data they read is missing
  from this machine; they fail the same way on `a81a1e6b`.
- Browser tests (`forestry-visual-quality*.spec.ts`), run against the newly
  built toolkit: 39 pass. Seven fail, and the same seven fail on a clean
  `a81a1e6b`, so they are not regressions: in
  `forestry-visual-quality.spec.ts` as pushed, the tests at lines 403, 656,
  795, 852, 1214, 1259 and 1357 (the worksheet, eye-level drive, phone sheet,
  phone controls and forest-loading tests). The suite needs
  `VITE_MAPILLARY_TOKEN` set to a dummy value, or the field photo test fails.
- Real GPU (Chrome with Metal on an Apple M4 Pro): capture and the VIA report
  with fresh class passes, *Distant trees* on live terrain, and the photo
  location search on a real photo. The defects this found are listed above.
- GitHub's checks and the Pages deploy passed on `b4a46c4c`.

New browser tests: `tests/e2e/forestry-visual-quality-mobile.spec.ts` (short
heights, touch, keyboard drawing) and the helpers in
`tests/e2e/visuals-plan-tools.ts`.
