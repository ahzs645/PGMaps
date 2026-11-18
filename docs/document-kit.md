# document-kit

document-kit is the shared document framework PGMaps uses for Word output: one
block model for a report, a Word writer, and a layout that turns a Word file
into a PDF or page pictures, all in the browser with no server and no network.
It lives in its own repository and is a pinned Git submodule at
`vendor/document-kit`, shared with the laboratory reports' application. Its own
guides are in the submodule: `README.md`, `AGENTS.md`, `docs/model.md` (the
block model and the Word writer, with a table mapping the VIA report's blocks to
the kit's) and `docs/layout.md` (the layout, its fonts and its losses).

## What PGMaps uses it for

The VIA report's **Word** and **PDF from the Word layout** formats in the
visual quality page's Save & export (`docs/forestry-visual-quality.md`, **VIA
reports**):

| PGMaps file | What it does |
| --- | --- |
| `src/pages/dev-forestry/viaReport/word.ts` | The `AssembledReport` as a kit document and its Word bytes (`reportDocument`, `reportDocx`), by the PDF's page rules. DOM- and network-free; the kit's writer and picture reader are passed in (`WordKit`) and its types imported alone. |
| `src/pages/dev-forestry/viaReportWord.ts` | The browser side: loads the kit on demand, writes the Word file, lays it out to a PDF (`docxToPdf`) or to page pictures for the preview (`docxToPages`). |
| `src/pages/dev-forestry/viaReportWordFonts.ts` | The font files the layout is given: Arimo, the kit's open stand-in for Arial, emitted by Vite from `document-kit/fonts/*` as hashed assets under the deploy's base. |

Nothing else in PGMaps imports the kit. Every import of it is dynamic and sits
behind a Word output being asked for, so the kit, the `docx` library, the
layout engine and the fonts stay out of the page's bundle. The fonts are
build assets, not a data folder: they never move to another host and are not
resolved through `withBase`. The kit fetches nothing itself; a face the build
does not serve is drawn in Arimo and reported as a loss.

The PDF (`viaReport/pdf.ts`, jsPDF) stays the report's default format. The kit
adds the Word file beside it; it replaces no writer PGMaps has.

## How it is built

The package's entries point at `dist/`, which the submodule does not commit.
PGMaps depends on it as `"document-kit": "file:vendor/document-kit"`, and
`scripts/ensure-document-kit.mjs` builds it when `dist/` is missing or older than
the kit's sources: `npm ci` inside the submodule (its own pinned tools, from its
own lockfile) when its tools are not installed, then `npm run build`. The script
runs in `predev` and `ci:prepare`, so the checks, the deploy's prebuild and the
dev server all have the kit built. The feature workflows that build or
typecheck the whole app run it after `vendor/json-url`'s build and initialise
the submodule with the others.

PGMaps' root install links the kit and installs its runtime dependencies
(`docx`, `fast-xml-parser`, `fflate`). Its build tools stay the kit's: the kit
states them as wide ranges, so linking it leaves PGMaps' own Vite and Vitest
where they are. The
deploy caches the kit's `node_modules` with PGMaps' and keys the cache on both
lockfiles.

## Changing the kit and moving its pointer

Change the kit in its own repository, never in `vendor/document-kit`: run its
`npm run check` (type checks, unit tests, build and the browser test with every
outside request blocked) and push. Then, here:

1. Move the submodule pointer (`git -C vendor/document-kit fetch` and check out
   the new commit, then stage `vendor/document-kit`).
2. Run `node scripts/ensure-document-kit.mjs`, which rebuilds `dist/` because
   the sources are newer.
3. If the kit's dependencies changed, update PGMaps' lockfile with
   `npm install --package-lock-only --ignore-scripts` and check the diff names
   only the kit and its dependencies.
4. Run `npx tsc -b`, `npx vitest run src/pages/dev-forestry/viaReport` and
   render a report's Word file and its Word-layout PDF to look at the pages.

The kit holds no PGMaps content. Forestry wording, rating tables and page rules
stay in `viaReport/`; anything both applications need goes into the kit
upstream first.
