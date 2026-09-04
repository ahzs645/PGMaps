# Project package envelope

Read this for every PGMaps project task.

## Choose the project mode

- Use `story-map-v1` when scenes, narrative order, camera changes, and layer
  visibility are the primary interaction.
- Use `map-explorer-v1` when filters, search, ranked entities, popups, and a
  source adapter drive an exploratory workspace.
- Use an `index-preset` with a `lab` recipe when the project is an editable
  Index Lab scoring configuration.
- Do not add a new workspace type merely for a new dataset. Prefer a new data
  adapter behind an existing renderer contract.

## Shared envelope

All packages require the catalog fields normalized by `src/lib/projectPackages.ts`,
including `version`, `slug`, `title`, `kind`, `theme`, ownership/status copy,
catalog metrics, layer summaries, scenes, and files. Use a nearby package of the
same mode as the exact structural example.

Project package JSON is app-owned unless a documented generator or scraper owns
it. Do not force generated scraper output into `public/data`.

Treat envelope copy as sourced project information. Do not infer an owner,
publication/update date, status, provenance note, or catalog metric from the
renderer configuration. When those facts are missing, produce an explicitly
incomplete review draft, leave metrics empty rather than fabricating values, and
list what a developer or project owner must resolve.

## Registration and validation

1. Put the package in `public/data/projects/`.
2. Run the package audit script from the skill. Its default mode is for a
   repository-ready structure. Pass `--draft` only while unresolved placeholder
   metadata is intentionally present, and report every warning.
3. Run `npm run projects:index` after adding or renaming it.
4. Run `npm run projects:index:check`, parser tests, TypeScript, and relevant
   renderer tests.
5. Open `/dev/projects/<slug>` at desktop and mobile widths. Verify loading,
   empty/error states, sidebar/sheet behavior, map controls, popups, legends,
   and any timeline.

These checks establish different things: the audit checks package structure;
parser tests check normalization; endpoint inspection checks adapter-compatible
payloads; and browser checks cover runtime integration. Do not describe one as
substituting for another. Catalog index checks cover only packages registered in
`public/data/projects`, not isolated proposal files.
