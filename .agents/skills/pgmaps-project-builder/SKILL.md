---
name: pgmaps-project-builder
description: Design, build, extend, or audit PGMaps project packages and their reusable renderers. Use for files in public/data/projects, story-map-v1 or map-explorer-v1 workspaces, Index Lab project presets, and changes to project feature blocks or renderer contracts.
---

# PGMaps Project Builder

Build projects from the package contract outward. Prefer an existing workspace
and capability before adding renderer code; add a new capability only when its
data contract and interaction cannot be expressed by an existing one.

## Route the task

- For the common package envelope, catalog registration, ownership, and
  validation workflow, read [references/project-package.md](references/project-package.md).
- For `workspace.type: "map-explorer"`, read
  [references/map-explorer.md](references/map-explorer.md), then read only the
  feature reference files for the blocks being used or changed.
- For `workspace.type: "story-map"`, read
  [references/map-story.md](references/map-story.md) and the repository's full
  `docs/project-map-stories.md` contract before changing the renderer.
- For `kind: "index-preset"` and `lab` recipes, read
  [references/index-preset.md](references/index-preset.md).

## Build and verification loop

1. Inspect the closest working package and the active parser types in
   `src/lib/projectPackages.ts`. The parser, TypeScript union, renderer, docs,
   and package JSON are one contract.
2. Choose the smallest existing project mode and capability set that expresses
   the requested experience. Keep domain-specific data normalization in an
   adapter; keep generic presentation in feature components or shared UI.
3. Make renderer changes in the partition that owns them. Do not put a new
   feature back into the top-level orchestrator.
4. Do not invent ownership, update dates, dataset counts, provenance, or status.
   If required facts are unavailable, keep the artifact explicitly in draft
   review and list the unresolved fields.
5. Run `node .agents/skills/pgmaps-project-builder/scripts/audit-project-package.mjs <package.json>`.
   Use `--draft` only for an explicitly incomplete review artifact; resolve its
   warnings before calling the package repository-ready.
6. Regenerate the catalog with `npm run projects:index` after adding or renaming
   a package. Run focused tests, TypeScript, and lint proportional to the change.
7. Render the canonical `/dev/projects/<slug>` route. Exercise every changed
   interaction at desktop and mobile sizes, inspect the browser console, and
   compare the result with the active mode's reference invariants.
8. If any structural, test, console, interaction, or visual check fails, fix the
   owning package/component and repeat from the narrowest gate capable of
   catching the failure. After a renderer change, repeat the full affected-mode
   browser pass.

Stop only when all in-scope gates pass, required layouts and viewports have been
exercised, the browser console is clean, and no visible defect remains. If a
remote source or unavailable environment prevents a check, report that check as
unverified; do not treat it as passed or loop without a possible state change.

The package audit proves local structure and feature-to-skill coverage. It does
not prove that a remote endpoint exists, matches its adapter, contains accurate
metrics, or renders correctly. Verify those separately whenever the necessary
data and registered route are in scope.

## Architecture boundaries

- `ProjectMapExplorer.tsx` orchestrates loading and layout only.
- `ProjectExplorerSidebar.tsx` orders sidebar feature blocks.
- `ProjectExplorerMap.tsx` composes map-only capabilities.
- `features/*.tsx` owns one `map-explorer-v1` option per file.
- `adapters/*` owns source-specific parsing, normalization, filtering, and
  derived GeoJSON.
- `src/components/ui/*` owns presentation that is useful outside project
  explorer packages.

When adding a `map-explorer-v1` feature, update together:

- `ProjectExplorerFeatureDef` and `normalizeExplorerFeature`;
- its feature component and sidebar/map composition site;
- `docs/project-map-explorer.md`;
- a focused reference under `references/map-explorer-features/`;
- parser tests and at least one package example.

Do not create a new skill for each feature. Separate reference files provide
progressive disclosure while this single skill preserves the shared project
workflow and cross-feature invariants.
