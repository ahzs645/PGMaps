# Validation scope and local commands

checks.yml and deploy.yml use .nvmrc (Node 22). ci:prepare is the common toolkit/json-url preparation also invoked by prebuild. Checks retain data sync and the full unit/lint/type/format gate. All seven specialist workflows remain manual. Recursive submodules, scraper provenance/cache keys, deployed dataset checks and LiDAR validation remain unchanged.

## Local entry points

```sh
git submodule update --init --recursive
npm ci --ignore-scripts
npm run ci:prepare
npm run data:sync-from-bcdatamapper
npx tsc -b
npm run lint -- --max-warnings=0
npm run format:check
npx vitest run
# Full deployment validation: deploy.yml; specialist investigations: their manual workflows.
```

Feature branches without an open PR use local commands. A local pass does not replace validation of the submitted revision. Main/release publication keeps the workflow's existing authorization and artifact conditions.

CI optimization batch: November 7, 2026. Workflow syntax and focused orchestration/selection checks are separate from complete application, native-platform and research validation.
