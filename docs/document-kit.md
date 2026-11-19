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
| `src/pages/dev-forestry/viaReport/word.ts` | The `AssembledReport` on the PDF's pages as the kit's blocks and sections (`layoutReport`, framed by a `WordFurniture`), and the direct route's document and Word bytes (`reportDocument`, `reportDocx`), kept as the recipe route's test oracle. DOM- and network-free; the kit's writer and picture reader are passed in (`WordKit`) and its types imported alone. |
| `src/pages/dev-forestry/viaReport/recipeJson/` | The reports as JSON recipes in the kit's format (`vendor/document-kit/docs/recipe.md`): a base recipe with the theme, each page kind as a section and the furniture as JSON components, and one recipe per report extending it. `recipes.generated.json` is the kit's compile of them as the page reads them; `comparison-result.json` the last comparison of the two routes. |
| `src/pages/dev-forestry/viaReport/recipeRoute.ts` | The Word document through the kit's recipe engine: the library, one code-component adapter over the report parts, compile, render, and placement by `word.ts`. DOM- and network-free; the engine is passed in (`RecipeKit`). |
| `src/pages/dev-forestry/viaReport/reportEngine.ts`, `engineParts.ts`, `kitBlocks.ts`, `reportFacts.ts` | The report parts defined as JSON components: the page's handle on the engine (`reportEngine.ts`, the only one of these the page holds), and, loaded with it, the renderer over the compiled parts (`engineParts.ts`), the facts object they read (`reportFacts.ts`) and the reader that turns what they render into the report's own blocks (`kitBlocks.ts`), so the PDF, HTML, Markdown and Word file draw one definition. DOM- and network-free. |
| `src/pages/dev-forestry/viaReportEngine.ts` | The browser side of that engine: loads the kit's renderer, the reader and `recipeJson/parts.compiled.json` by dynamic import when Save & export opens, once a session. |
| `src/pages/dev-forestry/viaReportWord.ts` | The browser side: loads the kit on demand, writes the Word file, lays it out to a PDF (`docxToPdf`) or to page pictures for the preview (`docxToPages`). |
| `src/pages/dev-forestry/viaReportWordFonts.ts` | The font files the layout is given: Arimo, the kit's open stand-in for Arial, emitted by Vite from `document-kit/fonts/*` as hashed assets under the deploy's base. |

Nothing else in PGMaps imports the kit at run time (the tests and
`scripts/forestry/via-recipes/` do). Every import of it is dynamic, so the kit
stays out of the page's bundle: its recipe renderer (about 108 kB, 35 kB
gzipped) and the compiled JSON parts load when Save & export opens
(`viaReportEngine.ts`), because the report's JSON parts are rendered by it for
every format; the `docx` writer, the layout engine, the fonts and the Word
route (`recipeRoute.ts`, about 56 kB, 17 kB gzipped) load only when a Word
output is asked for (`viaReportWord.ts`). The page reads the recipes from the
generated file, not the kit. The unit tests load the renderer for the forestry
tests only (`viaReport/reportEngine.setup.ts`). The fonts are
build assets, not a data folder: they never move to another host and are not
resolved through `withBase`. The kit fetches nothing itself; a face the build
does not serve is drawn in Arimo and reported as a loss.

The PDF (`viaReport/pdf.ts`, jsPDF) stays the report's default format. The kit
adds the Word file beside it; it replaces no writer PGMaps has.

The Word file is built through the kit's **recipe engine**
(`docs/forestry-visual-quality.md`, **Recipes as JSON**): the reports are JSON
recipes, compiled once each per session, rendered with the report parts as
code components, and placed on pages by `word.ts`. The direct route stays as
the oracle, pinned equal by `recipeRoute.test.ts`. Two kit changes came from
this: a code component carries `meta` as a JSON component does, and a text run
whose tags all fill renders as one run (so the JSON furniture writes exactly
the runs the direct route writes).

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
4. Run `npx tsc -b`, `npx vitest run src/pages/dev-forestry/viaReport`,
   `npm run via-recipes:check` and `npm run via-recipes:compare` (the recipe
   route against its oracle), and render a report's Word file and its
   Word-layout PDF to look at the pages.

The kit holds no PGMaps content. Forestry wording, rating tables and page rules
stay in `viaReport/`; anything both applications need goes into the kit
upstream first.
