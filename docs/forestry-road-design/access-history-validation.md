# Historical access implementation: validation record

This record covers the discovery and access-investigation continuation of PR #94
on 2026-11-09 UTC. It distinguishes the current local software checks from browser
observations recorded before this continuation. Automatic checks and deployment
workflows are unchanged; no specialist Actions workflow was dispatched.

The published baseline commit is
[`f7ae30d8bd1e0cd172e6eb2422c21a6a5430d81c`](https://github.com/ahzs645/PGMaps/commit/f7ae30d8bd1e0cd172e6eb2422c21a6a5430d81c).
Its GitHub checks and build succeeded; deployment was skipped. These baseline
results are not a CI result for the discovery continuation. Check the current
PR head's ordinary checks separately before merging.

## Current verified software behavior

| Check | Result |
| --- | --- |
| Application source typecheck | Full `src` scope passed with `tsrs` |
| Road-page and example typecheck | Focused dependency graph, tests, review entry, CLI and generator passed with `tsrs` |
| Combined regression slice | **276 tests in 23 suites passed** |
| Changed TypeScript/TSX | ESLint passed with zero warnings; Prettier passed |
| Whole-application Vite bundle plus review entry | Passed with normal minification and public assets: **7,521 transformed modules** |
| Live public-source discovery | Exact licence and licence/permit searches passed through the production search loader; capped results and legacy opening identifiers remained explicit |
| Actual example recipes | Four checked cases: **60677, 56944, 11981 and 11984**; three additional cases passed the production pilot parsers |
| Updated full-map browser suite | **Three tests discovered; not executed** during this continuation |

The current 23-suite slice covers historical chronology and topology, source
parsing, query provenance, scoped coverage, pilot assembly, discovery filters and
limits, candidate comparisons, project/example discovery, persisted investigation
mode and workspace transitions, map feature modelling, evidence IO and UI
interactions, plus the original road network/import/history/project/scenario/map-fit
behavior. The final retained run log reports 276 passing tests in 17.11 seconds.
This includes the final block-selection coherence and overlapping harvest-interval
presentation regressions found while reviewing the real shared-road example.

The preceding continuation passed a different slice of 254 tests in 19 suites,
including two Castor IO suites for a small projection-typing adjustment. The
current command adds six discovery/investigation suites and omits those two Castor
suites. These are overlapping validation runs, not additive test totals.

Chronology regressions include definite closures after undated notices, future
construction despite unknown-time opt-in, compatible observations within
construction windows, and expired restrictions. Import regressions reject paths
that jump between disconnected source nodes, omit encountered crossing assets,
or remove supporting source references.

### Reproduce the combined unit slice

```sh
npx vitest run \
  src/pages/dev-forestry-roads/accessHistory.test.ts \
  src/pages/dev-forestry-roads/accessHistorySources.test.ts \
  src/pages/dev-forestry-roads/accessHistoryMap.test.ts \
  src/pages/dev-forestry-roads/accessHistorySummary.test.ts \
  src/pages/dev-forestry-roads/bcAccessPilot.test.ts \
  src/pages/dev-forestry-roads/bcAccessPilotScenario.test.ts \
  src/pages/dev-forestry-roads/bcAccessSearch.test.ts \
  src/pages/dev-forestry-roads/trainingAccessHistoryScenario.test.ts \
  src/pages/dev-forestry-roads/AccessHistoryIO.test.ts \
  src/pages/dev-forestry-roads/AccessHistoryPanel.test.tsx \
  src/pages/dev-forestry-roads/AccessHistoryCandidates.test.tsx \
  src/pages/dev-forestry-roads/BcAccessDiscoveryPanel.test.tsx \
  src/pages/dev-forestry-roads/ProjectsDialog.test.tsx \
  src/pages/dev-forestry-roads/investigationWorkspace.test.ts \
  src/pages/dev-forestry-roads/useRoadWorkspace.test.ts \
  src/pages/dev-forestry-roads/roadNetwork.test.ts \
  src/pages/dev-forestry-roads/existingRoadScope.test.ts \
  src/pages/dev-forestry-roads/roadHistory.test.ts \
  src/pages/dev-forestry-roads/existingRoads.test.ts \
  src/pages/dev-forestry-roads/harvestHistory.test.ts \
  src/pages/dev-forestry-roads/project.test.ts \
  src/pages/dev-forestry-roads/scenarios.test.ts \
  src/pages/dev-forestry-roads/planFit.test.ts \
  --maxWorkers=1
```

### Typechecker and build details

The checker was installed outside the repository at version
`tsrs 0.23.0-ts7.1.0-beta`; this change does not upgrade the repository's TypeScript
dependency or alter CI's compiler. TS7 no longer accepts `baseUrl`, so temporary
equivalent configs removed that option, resolved every existing `paths` entry
and `include` against its original directory, and checked the Node reference
separately. No source directories were excluded from the full application check.

The preceding continuation made four small compatibility changes to make the
checked types explicit: infer the existing proj4 converter return type, import GeoJSON types in the two Node smoke
modules, and declare the exact published spinnerwheel CSS export. These do not
change source data, algorithms or runtime dependency versions.

Earlier unrestricted parallel builds exceeded this workspace's memory budget.
The current full build succeeded with two Rust worker threads and a 1 GiB Node
heap, transforming 7,521 modules. Only compressed-size reporting
was disabled; output minification, code splitting, application entry points and public asset copying remained enabled:

```sh
RAYON_NUM_THREADS=2 NODE_OPTIONS=--max-old-space-size=1024 \
  node --input-type=module - <<'JS'
import { build } from 'vite'
await build({ build: {
  outDir: '/tmp/pgmaps-history-review',
  emptyOutDir: true,
  reportCompressedSize: false,
  rollupOptions: { input: {
    app: 'index.html',
    historyReview: 'examples/forestry/access-history/interface-review.html'
  } }
} })
JS
```

The narrow host HTML has no build dependencies; copy
`examples/forestry/access-history/interface-review-phone.html` beside the built
review HTML when using a static preview. Vite's development server can serve both
source entries directly. Neither entry is registered as a production app route,
and these commands perform no deployment.

## Current actual-source checks

The [BC discovery and shared-road guide](bc-access-discovery.md) records all four
checked openings, their exact source requests, date semantics, mapped candidate
comparisons and the shared-record investigation for openings 11981 and 11984.
The checked road counts are 20, 3, 10 and 5 for openings 60677, 56944, 11981 and
11984 respectively. These are bounded current-source observations, not reconstructed
historical road inventories.

The production search for licence A18165 returned 25 visible rows, a transfer-limit
indication and a lower bound of 26 matches. Adding cutting permit 70 returned one
row for opening 60677 without a cap indication in that response. Negative reported
opening identifiers remain visible under their FTEN keys with an explanation of
why the positive-ID study loader cannot open them. Search errors and timeouts are
not represented as successful zero-row queries. Opening 57243 was attempted but
its incomplete, timed-out inspection is excluded from the checked example catalogue.

The three new complete studies were assembled at 03:40:17, 03:40:44 and 03:40:49 UTC
on 2026-11-09. Exact per-request timestamps and returned source records were checked
through the production parsers and retained outside the repository. No provincial
geometry or source archive is committed as a test fixture. Physical road chronology,
reviewed entrances/outlets, crossing history and historical use remain unresolved.

## Current browser acceptance

The review entry uses the production search, candidate list, source loader,
record inspector and bundle importer. Its right pane draws retained coordinates
in a labelled SVG diagram; it has no basemap or terrain analysis. These checks
do not establish full WebGL-map or terrain-load acceptance.

Observed in the rendered browser on this continuation:

- Search licence A18165: 25 visible records, an explicit more-results notice, and
  both legacy negative opening IDs retained with an explanation. Review caught
  an idle busy-label error on unavailable rows; it is fixed with a regression.
- Add exact opening 11981: one search result with licence, permit, block, timber
  mark, harvest interval, retrieval date and query link. Open study loaded one
  block and ten actual road records; seven were within 1 km of the footprint.
- Select R03890/B from the candidate list: the source geometry is highlighted
  and its road identifiers and unknown physical chronology are displayed.
- Load opening 11984 into the first study, review the staged result and explicitly
  add it: one new block, three new roads and two duplicate source IDs retained
  once. The combined study has two blocks, thirteen roads and twenty-five source
  references, with no inferred events, structures, anchors or paths.
- Import the separately supplied two-block bundle through the production preview
  and Apply action: the same counts are retained and new road reuse stays disabled.
- Switch the selected block from 11981 to 11984: the previous road selection
  clears. The reported 1988–1990 interval now explicitly spans reference year
  1989 instead of implying the entire harvest is in the future.
- Filter nearby roads by R03890 and select section A: two candidate rows remain,
  and the exact selected road coordinates and evidence are visible together.
- Search opening 56944 at 320 CSS px: one live result. Viewport and document
  scroll widths both measured 320 px. Review caught a clipped search-button label;
  the final build places that action on its own narrow-screen row.

Current screenshots:

- [Exact opening search](../../examples/forestry/access-history/review/bc-cutblock-discovery.jpg)
- [Shared-road study and filter](../../examples/forestry/access-history/review/bc-shared-road-study.jpg)
- [320 px live search](../../examples/forestry/access-history/review/bc-cutblock-search-320px.jpg)

The latest source changes were typechecked, linted and regression-tested; the
final responsive button change was also linted, formatted, rebuilt and observed
in the browser. Full production-map mode suppression, map-layer picking and
regional terrain remain the separate manual gate below.

## Preceding source and browser observations: opening 60677

The exact bounded production queries returned one RESULTS record, one FTEN
polygon and twenty FTEN road records. The preceding server-side live CLI check was
retrieved at **2026-11-09 02:43:35 UTC**:

```sh
node --import tsx scripts/forestry/inspect-bc-access-pilot.ts 60677 --python-transport
```

The optional transport uses Python urllib with the configured environment proxy;
the browser continues to use native fetch. It changes no source URLs, parsers,
record limits or import semantics. There are no automatic retries.

The [case findings and exact query links](access-history.md#what-the-opening-60677-records-established)
document the keys, 1997 harvest fields, candidate distances and missing evidence.
The separately supplied portable bundle retains individual source retrieval
times from 02:21 and 02:35 UTC. It was assembled from verified responses through
the production loader and round-trip parser, then independently checked against
the later live response. No provincial geometry or source archive is committed
as a fixture in PGMaps.

The rendered browser completed the same three live requests after an earlier
timeout. Before Add, the project still had zero loaded features. After the
explicit Add action it displayed opening 60677, its exact identifiers, twenty
roads, twenty undated physical histories, twenty-six retained source references,
and no fabricated entrance, outlet, structure or route. This establishes live
browser access to these three public endpoints during this review; it does not
guarantee subsequent service latency or availability.

## Rendered component acceptance — preceding continuation

The preceding standalone review entry imported the **production** history panel,
record cards, source loader and shared map-assessment model. It drew retained
coordinates in an explicitly labelled SVG evidence diagram. It supplies no
basemap or terrain analysis and is separate from full-map acceptance.

The following browser interactions were observed before the current discovery and
investigation-mode changes:

- Open the selected-block overview and inspect exact source identifiers and gaps.
- In the teaching example, trace 2010 through the bridge, then trace 2022 through
  the later bypass after the documented closure. The saved route keeps its own
  date, and selecting the bridge reveals its separate dated reports.
- Query actual BC records, review the staged counts, and explicitly add them to a
  clean source study. The figure uses returned polygon and road coordinates.
- Select R01860/K6 through the diagram's keyboard-accessible record control and
  inspect permit, section, stations, client, timber mark, status and unknown
  physical chronology.
- Export that live study, reopen it at 320 CSS px, review the import preview and
  apply it. The result retains one block and twenty roads, with no route assertions
  and reuse still disabled. Measured document width equals viewport width.

Screenshots captured from the preceding rendered-component review:

- [Actual BC opening and roads](../../examples/forestry/access-history/review/bc-opening-60677.jpg)
- [320 px imported study](../../examples/forestry/access-history/review/320px-imported-study.jpg)
- [Synthetic connected-network example](../../examples/forestry/access-history/review/teaching-example.jpg)

The review exposed and corrected two review-entry issues: Tailwind did not scan
the example's unique layout classes, and its initial empty alignment failed the
normal project parser. At that stage the wrapper used its own responsive CSS and a valid unused design
draft. The current investigation-mode changes hide the internal compatibility
alignment until the user explicitly starts a design; their browser acceptance is
recorded separately above.

## Remaining acceptance gates

**Full WebGL map:** the updated manual full-page suite contains three discoverable
tests: the source-only investigation transition plus the synthetic history flow at
two viewport sizes. Test discovery passed; the tests have **not been executed**
during this continuation. Full terrain/map interaction, actual layer picking and
regional-terrain loading therefore remain acceptance gates.

During the preceding review, the shared browser reported WebGL as disabled and
could not initialize MapLibre. Local Playwright Chromium failed before page
execution because its process-singleton Unix socket was unavailable. Those are
recorded earlier observations, not a new environment diagnosis. Component/diagram
screenshots do not demonstrate full-map behavior. Run the updated suite with:

```sh
PGMAPS_E2E_BASE_URL=http://127.0.0.1:42173 \
  npx playwright test tests/e2e/forestry-road-access-history.spec.ts --workers=1
```

The spec follows the existing `forestry-road-*.spec.ts` naming pattern, so the
manual `forestry-roads.yml` workflow includes it in lint and browser shards.
That workflow's trigger remains `workflow_dispatch` only.

**Repository CI:** GitHub checks and build succeeded for the published baseline
`f7ae30d8bd1e0cd172e6eb2422c21a6a5430d81c`; its deploy job was skipped. Full source
typechecking and the whole application bundle passed locally for this continuation,
but this record does not claim the complete repository-wide unit suite or CI
success for the new head. Review that head's
ordinary PR checks before merging. The specialist browser workflow remains manual.

**Historical accuracy:** no road-to-block ground-truth evaluation across BC has
been completed. The four examples' identity matches and spatial candidates do not
establish access at their reported harvest dates, construction purpose, actual haul
use, bridge configuration or the operator's rationale. The [expansion plan](access-history.md#what-the-wider-bc-system-still-needs)
identifies the operational documents, dated observations, crossing versions and
reviewed cases needed to make those claims.
