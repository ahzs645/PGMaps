# Index Lab project presets

Use `kind: "index-preset"` when a Projects catalog entry opens an editable
Index Lab recipe. The `lab` object is the executable handoff; the surrounding
project envelope explains the recipe in the catalog.

Prefer generated preset packages. The source preset definitions and generator
live under `src/maps/scorebuilder/constants/` and
`scripts/generate-scorebuilder-projects.ts`; generated packages live under
`public/data/projects/scorebuilder/`.

When changing a preset:

1. change the source preset/metric definitions;
2. regenerate with `npm run projects:scorebuilder`;
3. do not hand-edit a generated package unless it is explicitly an app-owned
   example rather than generator output;
4. verify the project package and Index Lab load the same boundary, metrics,
   weights, normalization, aggregation, missing-data, network, and output
   settings;
5. run score-builder formula/URL-state tests relevant to the recipe.
