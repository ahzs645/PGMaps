# Historical access implementation: validation record

This record covers the continuation of PR #94 on 2026-11-09 UTC. The branch
incorporates main commit `0e5cf193dcb52a2d019356f812545efcd97fd8a0` (PR #93).
Automatic checks and deployment workflows are unchanged; no specialist Actions
workflow was dispatched.

## Verified software behavior

| Check | Result |
| --- | --- |
| Pinned toolkit and json-url preparation | `npm run ci:prepare` passed |
| Application source typecheck | Full `src` scope passed with `tsrs` |
| Node/build-tooling typecheck | `tsconfig.node.json` passed with `tsrs` |
| Road-page and example typecheck | Focused dependency graph, tests, review entry, CLI and generator passed with `tsrs` |
| Combined regression slice | **254 tests in 19 suites passed** |
| Final source-request budget change | **57 source, pilot and harvest tests passed** after the change |
| Final record-display cleanup | **13 panel tests passed**, including preserving the raw station number while formatting its display |
| Changed TypeScript/TSX | ESLint with zero warnings and Prettier passed |
| Whole-application Vite bundle plus review entry | Passed with normal minification and public assets, 7,515 transformed modules |
| Portable synthetic example | Regenerated through the production parser and serializers |
| Live public sources | Server-side CLI and rendered browser returned the actual opening and surrounding roads |
| Browser export and import | The browser-exported actual study reopened through the production import preview and explicit Apply action |
| Narrow component layout | 320 CSS px viewport and 320 px document scroll width; no horizontal overflow |

The 254-test slice covers historical chronology and topology, source parsing,
query provenance, scoped coverage, pilot assembly, clean scenario replacement,
map feature modelling, worked scenarios, evidence IO and UI interactions, plus
the original road network/import/history/project/scenario/map-fit behavior.
Two existing Castor IO suites cover the small projection-typing adjustment.
The later focused counts overlap this slice and are not additive.

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
  src/pages/dev-forestry-roads/trainingAccessHistoryScenario.test.ts \
  src/pages/dev-forestry-roads/AccessHistoryIO.test.ts \
  src/pages/dev-forestry-roads/AccessHistoryPanel.test.tsx \
  src/pages/dev-forestry-roads/roadNetwork.test.ts \
  src/pages/dev-forestry-roads/existingRoadScope.test.ts \
  src/pages/dev-forestry-roads/roadHistory.test.ts \
  src/pages/dev-forestry-roads/existingRoads.test.ts \
  src/pages/dev-forestry-roads/harvestHistory.test.ts \
  src/pages/dev-forestry-roads/project.test.ts \
  src/pages/dev-forestry-roads/scenarios.test.ts \
  src/pages/dev-forestry-roads/planFit.test.ts \
  src/features/forestry-castor/io.test.ts \
  src/features/forestry-castor/io-engine.test.ts \
  --maxWorkers=1
```

### Typechecker and build details

The preferred checker was installed outside the repository at version
`tsrs 0.23.0-ts7.1.0-beta`; this change does not upgrade the repository's TypeScript
dependency or alter CI's compiler. TS7 no longer accepts `baseUrl`, so temporary
equivalent configs removed that option, resolved every existing `paths` entry
and `include` against its original directory, and checked the Node reference
separately. No source directories were excluded from the full application check.

Four small compatibility changes make the checked types explicit: infer the
existing proj4 converter return type, import GeoJSON types in the two Node smoke
modules, and declare the exact published spinnerwheel CSS export. These do not
change source data, algorithms or runtime dependency versions.

Earlier unrestricted parallel builds exceeded this workspace's memory budget.
The final full build succeeded with two Rust worker threads and a 1 GiB Node
heap. Only compressed-size reporting was disabled; output minification, code
splitting, application entry points and public asset copying remained enabled:

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

## Actual opening 60677: observed source behavior

The exact bounded production queries returned one RESULTS record, one FTEN
polygon and twenty FTEN road records. The final server-side live CLI check was
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

## Rendered component acceptance

The standalone review entry imports the **production** history panel, record
cards, source loader and shared map-assessment model. It draws retained
coordinates in an explicitly labelled SVG evidence diagram. It supplies no
basemap or terrain analysis and is separate from full-map acceptance.

Observed browser interactions:

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

Screenshots captured from the rendered components:

- [Actual BC opening and roads](../../examples/forestry/access-history/review/bc-opening-60677.jpg)
- [320 px imported study](../../examples/forestry/access-history/review/320px-imported-study.jpg)
- [Synthetic connected-network example](../../examples/forestry/access-history/review/teaching-example.jpg)

The review exposed and corrected two review-entry issues: Tailwind did not scan
the example's unique layout classes, and its initial empty alignment failed the
normal project parser. The wrapper now has its own responsive CSS and retains a
valid unused design draft. The production clean BC scenario was unaffected.

## Remaining acceptance gates

**Full WebGL map:** the shared browser reports WebGL as disabled and cannot
initialize MapLibre. Local Playwright Chromium also failed before page execution
because its process-singleton Unix socket was unavailable. Full terrain/map
interaction, including actual layer picking and the real pilot's regional
terrain load, remains to run in a browser with WebGL. Component/diagram
screenshots do not demonstrate those features. The existing full-page suite is:

```sh
PGMAPS_E2E_BASE_URL=http://127.0.0.1:42173 \
  npx playwright test tests/e2e/forestry-access-history.spec.ts --workers=1
```

**Repository CI:** full source typechecking and the whole application bundle
passed locally, but this record does not claim the complete repository-wide
unit suite or an unobserved GitHub checks result. Review ordinary PR checks
before merging. The specialist browser workflow remains manual.

**Historical accuracy:** no road-to-block ground-truth evaluation across BC has
been completed. The pilot's identity match and spatial candidates do not establish
1997 access, construction purpose, actual haul use, bridge configuration or the
operator's rationale. The [expansion plan](access-history.md#what-the-wider-bc-system-still-needs)
identifies the operational documents, dated observations, crossing versions and
reviewed cases needed to make those claims.
