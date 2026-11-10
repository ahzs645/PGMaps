# Converting the reference projects: licence routes

This page is a plan; none of it has been built yet. It covers the 14 forestry-road projects reviewed on 10
November 2026 (see [the field review](field-review-and-reference-repos-2026-11-10.md)). For each one it
says:

- what PGMaps would still take from it;
- whether its code could run in the browser as WebAssembly or be rewritten in TypeScript;
- what each route means for PGMaps' licence.

The repository stays MIT while this is open, and the rule in `AGENTS.md` still holds: no GPL, LGPL or
unlicensed code is copied, translated or shipped.

This is an engineering reading of the licences, not legal advice. Before anything here becomes a
commercial product, or before the deployed site is put under the GPL, have it checked.

## Before you rely on it

- **Licences checked.** They were read from each archive's own `LICENSE`, `COPYING`, `DESCRIPTION`,
  `metadata.txt` and source headers, as supplied on 10 November 2026. A newer upstream release can
  change the licence, so check again before acting on any row.
- **How the 10 November methods were written.**
  - Reviewer agents read the source and wrote method reports. Those reports are kept outside the
    repository.
  - The implementers worked from the reports and the published papers. They were told not to copy or
    translate.
  - The source archives were on the same machine, so this was not a strict clean room.
  - No file, function body or data table was copied. Constants were taken from published references:
    the BC MoTI Supplement to TAC, Irvine's and Pestal's cable texts, and Roussel et al. 2022.
  - Keep this provenance with any future work of the same kind.
- **Running a program is not distributing it.** SEILAPLAN was run unmodified to produce check numbers
  for `cableMechanics.ts`. That needs no licence change, and neither does any other oracle use
  described below.

## What the licences allow

| Action                                                                        | GPL-2 / GPL-3                                                                                                                                                                                                                                | LGPL-3                                                                                                          | No licence                   | Apache-2.0                                        |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------- |
| Re-implement the method from a paper or a written description                 | Yes. Ideas, equations and published numbers are not covered.                                                                                                                                                                                 | Yes                                                                                                             | Yes, from the papers         | Yes                                               |
| Translate the code into TypeScript                                            | The result is a modified version and must be GPL. GPL-2 §0 names translation as modification.                                                                                                                                                | The result is LGPL                                                                                              | Not permitted                | Yes, keep the notice (as `NOTICE-LANDIS.md` does) |
| Compile the code to WASM (Emscripten, Pyodide, webR) and serve it             | That is conveying object code. The source must be offered. A module loaded into the same page that exchanges data structures with PGMaps forms one program with it (the FSF's reading), so the deployed whole must be offered under the GPL. | Allowed beside MIT code if the library stays a separate, replaceable file and its source and notice are offered | Not permitted                | Yes, with the notice                              |
| Run it unmodified, outside the app, to produce comparison numbers             | Yes                                                                                                                                                                                                                                          | Yes                                                                                                             | Only with the author's leave | Yes                                               |
| Combine with the Apache-2.0 code already in PGMaps (`roads/`, `skidSpurs.ts`) | GPL-3 and GPL-2-or-later: yes. GPL-2-only: no, because Apache-2.0's patent and indemnity terms are extra restrictions under GPL-2.                                                                                                           | Yes                                                                                                             | —                            | —                                                 |

## Three routes for the project

The decision is the owner's and applies to the whole site, not to one tool.

### A. Stay MIT and re-implement (current)

Every method is written from its paper or a written description, then checked against numbers
from running the original. Nothing else changes. It costs development time per method, and it
is the only route open for the unlicensed 3D-CHA and the GPL-2-only QuickTurn.

### B. Keep the source MIT, ship the built site under GPL-3.0-or-later

MIT is compatible with the GPL in one direction: MIT files can go into a GPL program. So PGMaps' own
files can stay MIT in the repository while the deployed site, once it contains GPL code, is offered
as a whole under GPL-3.0-or-later. Anyone who takes MIT files from the repository still gets MIT;
anyone who redistributes the built site takes on the GPL.

What it would take:

1. **A separate package for GPL code.**
   - Put it in `packages/forestry-gpl/` or its own repository, with a `LICENSE` of GPL-3.0-or-later and
     SPDX headers.
   - Its own build emits a worker and its WASM files.
   - The road page loads it lazily, the way `whitebox-wasm` is loaded, and talks to it only by messages.
   - A lint boundary stops MIT modules from importing it directly, so its code never mixes into an MIT
     file.
2. **A licences page in the app.**
   - List the GPL components with their copyright holders.
   - Link each to its source at the deployed commit, including build scripts and submodule pointers.
     GPL-3 §6 counts a public repository with build instructions as the source offer.
3. **Clear the dependencies that conflict with GPL-3.** From `npm ls --omit=dev` on 10 November 2026:
   - **`gsap`.** Its "Standard no-charge licence" is not an open-source licence, and it adds terms the
     GPL forbids. Only the food map's roulette wheel uses it, through `@firstform/spinnerwheel`.
     Either replace it, or confirm that the road page's bundle never loads it and document the site
     as separate programs.
   - **`jsts` and `turf-jsts`.** They are EDL-1.0 or EPL-1.0. Take them under EDL-1.0, which is
     BSD-style and GPL-compatible.
   - **`jszip`** (MIT or GPL-3.0-or-later) and **`dompurify`** (MPL-2.0 or Apache-2.0) are fine.
   - **`gdal3.js`** (LGPL-2.1-or-later) is fine as the separate WASM file it already is.
   - **`lightningcss`** (MPL-2.0) is a build tool; its output is not covered.
4. **No GPL-2-only code.**
   - QuickTurn cannot join even under route B, because the site already carries Apache-2.0 code.
   - Topografia is fine: its `main.py` and README grant "version 2 or any later version".

It saves rewriting a large method, such as SEILAPLAN's support optimizer. It is lost for good once
GPL code ships: a later move back to MIT means taking that code out again.

### C. Ask the authors

Many of these are research codes from public institutes. A short request often gets one of these:

- an MIT or Apache licence for the parts asked about;
- a written exception for PGMaps;
- an answer that the method may be re-implemented with credit, which is already allowed and
  costs nothing to confirm.

The value is highest where route A is slow:

- Sylvaccess (INRAE): cable and forwarder models;
- SEILAPLAN (WSL / ETH Zürich): support optimizer;
- Clément Hardy: the QGIS network plugin, whose LANDIS-II sibling is already Apache-2.0.

Draft request text is at the end of this page.

### Oracle use (any route)

Run an original program unmodified in a `workflow_dispatch` suite and compare its numbers with
PGMaps'. `roads-reference.yml` already does this against native R `roads`, so this is a known pattern.

- **Where the scripts go.** A wrapper that imports a GPL Python or R library is best kept in its own
  folder with its own GPL-3.0-or-later `LICENSE`, say `scripts/forestry/reference-oracles/`.
- **What stays outside it.** App code never imports that folder.
- **Upstream code.** The workflow downloads the upstream code at a pinned commit, so none of it is
  committed.

## Project by project

Each table gives the licence as found, what code and runtime the project uses, what PGMaps would
still take from it, and what is done so far.

### Projects worth converting

| Project                | Licence as found                            | Code and runtime                                                                                                                     | What PGMaps would still take                                            | Done so far                                                                                |
| ---------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| SEILAPLAN              | GPL-2.0-or-later (38 files carry the grant) | Python; the solver in `core/` is about 1,700 lines on NumPy and SciPy. QGIS and ReportLab are only for the interface and PDF report. | Intermediate-support optimizer (`opti_sta.py`, `main_opti.py`)          | Span mechanics re-implemented in `cableMechanics.ts`; matched SEILAPLAN's sag within 0.3 % |
| Sylvaccess             | GPL-3.0 (INRAE LESSEM)                      | Python with about 4,800 lines of Cython, NumPy, SciPy, GDAL, h5py; PyQt5 interface                                                   | Winching rays, forwarder side-slope rule, cable coverage of a block     | Along-ground skid reach in `skidReach.ts`                                                  |
| ALSroads               | GPL-3 (`DESCRIPTION`)                       | R with Rcpp; imports lidR, sf, terra, raster, gdistance, EBImage, lwgeom and others                                                  | Point-cloud metrics (intensity, return density) beside the DTM features | DTM-only method in `roadLikeness.ts`, `roadRelocation.ts`, `roadTrace.ts`, `roadSlices.ts` |
| SylvaRoad (QGIS port)  | GPL-3.0                                     | Python QGIS plugin, about 3,700 lines; the port is broken (three settings read one input)                                            | Hairpins found by the search, platform test, chord cut/fill limit       | Nothing                                                                                    |
| LANDIS-II Forest Roads | Apache-2.0                                  | C# for the LANDIS-II engine                                                                                                          | Wood flux, road-class suggestion                                        | Closest-first spurs adapted in `skidSpurs.ts`                                              |

| Project                | Recommended route                                                                                                                                                                                   | Effort                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| SEILAPLAN              | Oracle now. Ask the authors. If they decline and the optimizer is wanted quickly, it is the best route B candidate: `core/` runs in Pyodide with NumPy and SciPy, at a lazy download of tens of MB. | A: 1–2 weeks. B: about 1 week plus the route B groundwork. |
| Sylvaccess             | A, with an oracle run on synthetic rasters. Ask INRAE. A WASM build would need the Cython compiled for Pyodide and GDAL input replaced, which costs about as much as re-implementing.               | 1–2 weeks with the cable items                             |
| ALSroads               | A. webR cannot load several of its imports (EBImage, gdistance), and the method is published.                                                                                                       | 3–5 days once a point cloud reaches the road tool          |
| SylvaRoad (QGIS port)  | A, from the published SylvaRoad method; the port's code is not a reliable reference anyway. Ask its original INRAE authors together with Sylvaccess.                                                | 6–10 days                                                  |
| LANDIS-II Forest Roads | Port directly with attribution, under the existing `NOTICE-LANDIS.md`. No licence work needed.                                                                                                      | 2–3 days                                                   |

### Projects with little left to take

| Project                        | Licence as found                                                                                                            | Code and runtime                                                          | What PGMaps would still take                                                                | Done so far                                                                                     |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| forestroaddesigner             | GPL-3.0                                                                                                                     | Python QGIS plugin; route optimizer about 1,500 lines, NumPy, SciPy, GDAL | Grade-change penalty; "lowest grade that connects" diagnostic                               | Nothing; PGMaps' router already checks every metre                                              |
| 3D-CHA                         | None: all rights reserved                                                                                                   | Python, about 1,250 lines, NumPy                                          | Minimum tangent and curve lengths in the corridor search; grade-aware cost-to-go            | Nothing                                                                                         |
| QuickTurn                      | GPL-2. The files carry no version grant, only the licence text, so treat it as GPL-2-only unless the author says otherwise. | AutoLISP for AutoCAD                                                      | Nothing                                                                                     | Steering lock and junction turns re-implemented; truck sizes from the BC MoTI Supplement to TAC |
| RFLTools                       | GPL-3.0                                                                                                                     | AutoLISP and VB for AutoCAD and Civil 3D                                  | 3D available sight distance, least-squares curve fits of mapped roads, survey scale factors | Most alignment tools already exist in PGMaps                                                    |
| Lima VVA                       | GPL-3.0-or-later (About dialog)                                                                                             | C++ with Windows MFC                                                      | Nothing further                                                                             | Pappus volume correction in `curvedVolume.ts`                                                   |
| Topografia (GeoRoad)           | GPL-2.0-or-later (`main.py`, README); its licence file is an unofficial Portuguese translation                              | Python with Qt, pyglet, NetworkX                                          | DXF export                                                                                  | Everything else is already covered                                                              |
| smartlog_aco                   | LGPL-3.0                                                                                                                    | Python, NumPy, NetworkX                                                   | Nothing; it orders pile pickups, it does not choose landings or roads                       | —                                                                                               |
| ForestRoadNetworkPluginForQGIS | GPL-3.0                                                                                                                     | Python QGIS plugin                                                        | Nothing beyond its Apache LANDIS-II sibling                                                 | —                                                                                               |
| roads (LandSciTech)            | Apache-2.0                                                                                                                  | R                                                                         | Nothing                                                                                     | Already ported in `roads/`; checked by `roads-reference.yml`                                    |

| Project                        | Recommended route                                                                                                       | Effort   |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | -------- |
| forestroaddesigner             | A. Both are small ideas.                                                                                                | 2–4 days |
| 3D-CHA                         | A, from the published papers only. Ask the author for a licence before reading its code again.                          | 1 week   |
| QuickTurn                      | Done. AutoCAD-only, so it has no WASM route, and GPL-2-only rules out route B.                                          | —        |
| RFLTools                       | A, from standard references (TAC sight distance, least squares). There is no runtime that would run it outside AutoCAD. | 3–5 days |
| Lima VVA                       | None needed. Its Windows MFC code would need rewriting before any WASM build.                                           | —        |
| Topografia (GeoRoad)           | Write DXF R12 ourselves (a public format), or use a permissively licensed JavaScript writer.                            | 1–2 days |
| smartlog_aco                   | Not used                                                                                                                | —        |
| ForestRoadNetworkPluginForQGIS | Not used. Its author may relicense the plugin to match the LANDIS-II extension.                                         | —        |
| roads (LandSciTech)            | Done                                                                                                                    | —        |

## Found during this check: GPL code already in the bundle

This is outside the road tool, but it matters for every route above.

- **Where it comes from.**
  - `vendor/json-url`, the share-link library, depends on `node-lzw@0.3.1`.
  - `node-lzw`'s `package.json` says only `"license": "GPL"`, with no version and no licence file.
  - The library's codec table imports it lazily.
- **It ships even though PGMaps never uses it.**
  - PGMaps imports only `@firstform/json-url/web-share` and never picks the LZW codec.
  - A bundler still emits the codec as its own chunk, because the import is in the table. Bundling the
    `web-share` entry with esbuild produced `lzw-*.js` holding `node-lzw`'s code.
  - The Vite build is expected to emit it the same way. The deployed site therefore very likely serves
    a GPL file that it never loads.

Fix, whichever route is chosen:

- Drop the LZW codec from the `json-url` fork, or replace it with a permissively licensed
  implementation.
- Rebuild, then check that no emitted chunk contains it.
- Add `"license": "MIT"` to PGMaps' `package.json`, which currently has no licence field.

## Built-in assumptions

- The deployed site counts as distribution. Serving JavaScript and WASM files that browsers download
  is conveying under GPL-3 and distribution under GPL-2.
- A worker that only exchanges messages with the page is still treated as part of one program when the
  two exchange the data structures a single feature needs. This is the cautious reading. The separate-program
  argument is real but untested, and route B does not depend on it.
- Data files shipped inside a GPL project are treated as covered by its licence, like its code. None
  was used, including QuickTurn's vehicle library and SEILAPLAN's parameter templates.

## Failure modes

- **An implementer reads GPL source while writing the matching PGMaps module.** The result then looks
  like a translation even if no line was copied. Keep the provenance note in the module header (paper,
  report, reference numbers) and keep variable names and structure your own.
- **A dependency update brings in a GPL or proprietary package.** It goes unnoticed until someone checks.
  A licence allow-list check in `checks.yml` would catch it; it is not there yet.
- **The GPL-2-only reading of QuickTurn is wrong.** Its §9 lets an unspecified version be read as any
  version. That would only matter for route B, and nothing is wanted from it, so the cautious reading
  costs nothing.

## Draft permission request

> Subject: Permission to re-use [method] from [project] in an MIT-licensed web tool
>
> Hello,
>
> We maintain PGMaps, an open-source (MIT) web application with a forest-road design tool used for
> planning in British Columbia. We would like to offer [the specific method, e.g. the intermediate
> > support optimizer] in the browser. [Project] is released under [licence], which we cannot combine
> with an MIT application without changing its licence.
>
> Would you be willing to either (a) release [the named files or functions] under the MIT or Apache-2.0
> licence, or (b) grant PGMaps written permission to port them under MIT, with credit to you and
> [institute] in the code and the application's licence page? If neither suits, we will re-implement
> the method from [paper] and cite it, and would welcome your comments on that implementation.
>
> Thank you for publishing [project]; it has been a valuable reference.

Send it from the maintainer's own address. Name the files exactly, and keep the reply with the
change that uses it.
