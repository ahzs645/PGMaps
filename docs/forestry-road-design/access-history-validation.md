# Historical access implementation: validation record

This change was developed from PGMaps main commit
`1bc52b7b204852ab2e033e6bf4eb7030eb5f6349`. The ordinary automatic repository
checks and deployment workflows were not modified. No feature-specific Actions
workflow was dispatched.

## Verified locally

- Toolkit and json-url preparation: `npm run ci:prepare` passed with their pinned
  submodule revisions.
- Road-page dependency graph, new source/domain/UI modules, example generator and
  browser test TypeScript: `npm run check:access-history` passed. The command also
  works with `NODE_OPTIONS=--max-old-space-size=1536` in the constrained workspace.
- **190 tests in 14 focused domain/integration/regression suites passed.** They cover the historical
  engine and sources, map model, worked scenario, bundle/report IO, UI interactions,
  original operational network, road imports/scope/history, harvest history,
  project parsing, scenario library and map fit.
- Changed source files passed ESLint with `--max-warnings=0`, Prettier, and
  `git diff --check`.
- The example generator wrote portable files using the application parser and
  serializers. It makes no ministry requests and contains only synthetic data.
- A production Vite bundle preserving the exported `DevForestryRoads` entrypoint
  passed (3,869 transformed modules). The output was checked for the actual history
  UI and `historical-access-v1` implementation, so this was not an empty,
  tree-shaken entrypoint. This is a road-page bundle check, not a whole-site deployment build.

The focused unit command is:

```sh
npx vitest run \
  src/pages/dev-forestry-roads/accessHistory.test.ts \
  src/pages/dev-forestry-roads/accessHistorySources.test.ts \
  src/pages/dev-forestry-roads/accessHistoryMap.test.ts \
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
  --maxWorkers=1
```

The bounded production-bundle check used the existing Vite configuration with
`publicDir: false`, a temporary output directory, and:

```js
build: {
  rollupOptions: {
    input: 'src/pages/DevForestryRoads.tsx',
    preserveEntrySignatures: 'strict'
  }
}
```

## Live official-source smoke checks

The exact generated queries were exercised against the public OGL-BC services.
Opening `60677` returned matching RESULTS and FTEN identity records:
`A18165 / CP 70 / block 1 / EJ3070 / client 00001271`, with reported disturbance
dates `1997-07-01` to `1997-09-01`. The FTEN cutblock key was `162217`.
Typed source records passed the history parser. This is a block-identity check,
not a validated association to a particular road or bridge.

A bounded FTEN road-segment query returned `R13019` sections `O` and `P` with
unknown condition and reuse disabled. The RESULTS service initially timed out
with an unnecessary server-side sort; removing that sort returned the record,
and the adapter omits it. No real source rows were added to repository fixtures.
These server-side smoke checks do not establish browser CORS availability.

## Checks still required before merge

**Full repository checks:** two full `npx tsc -b` attempts were terminated with
exit 137. After initializing the pinned bcdatamapper submodule, the full Vite
build transformed 7,504 modules and was terminated with exit 137 while rendering
chunks. The focused typecheck and production road bundle pass, but they do not
replace the repository-wide gate. Run the standard checks in a sufficiently
provisioned environment.

**Rendered browser acceptance:** desktop and 320 px phone tests were authored in
`tests/e2e/forestry-access-history.spec.ts`. Both attempts stopped before page
execution because local Chromium could not create its process-singleton Unix
socket (`Operation not permitted`). The attached browser and shared cloud browser
also could not reach the isolated Vite server (`ERR_CONNECTION_REFUSED`). No
browser screenshot, interaction pass, live browser CORS result or mobile visual
approval is claimed.

Run the acceptance tests against a reachable local Vite server:

```sh
PGMAPS_E2E_BASE_URL=http://127.0.0.1:42173 \
  npx playwright test tests/e2e/forestry-access-history.spec.ts --workers=1
```

The suite checks selected block/route map synchronization, the future-road and
closure scenario, conflicting bridge evidence, sourced review, unchanged current
reuse switches, project download/reopen and horizontal overflow on a narrow phone.
The synthetic diagram is generated from data; it is not a browser screenshot.

**Real-world accuracy:** no province-wide or sampled road-to-block ground-truth
evaluation has been completed by this PR. The source identity joins, deterministic
geometry tests and synthetic scenario validate software behavior, not historical
purpose, actual haul use or engineering suitability. The validation programme and
data infrastructure required for that work are described in the
[expansion plan](access-history.md#what-the-wider-bc-system-still-needs).
