# Title

PGMaps — Agent-Native Maps for Real-World Decisions

## One-line Summary

PGMaps turns public-interest maps into a shared visual workspace where people and AI agents can discover experiences, compare evidence across datasets, operate map stories, and inspect the result together through WebMCP.

## Problem

Maps are unusually difficult for agents to use well. Important state is spread across a canvas, filters, layer controls, story cards, popups, and the current camera. An agent that guesses at clicks is slow and brittle, while a detached API removes the person from the visual context where spatial results make sense.

This is especially limiting for questions that cross datasets. Choosing a food option using both recent inspection history and nearby mapped property-crime incidents requires filtering, spatial comparison, transparent assumptions, and a final result that a person can inspect rather than blindly accept.

## Solution

PGMaps exposes the meaningful operations behind its existing map experiences as narrow, page-aware WebMCP tools. Those tools call the same React actions as the human interface, so an agent can search projects, open a map, move a story, change a layer, filter evidence, rank options, and select a result while the person sees every change on the shared map.

The primary demo combines food-establishment inspections with Prince George property-crime points. The user controls the inspection period, incident radius, crime lookback, minimum inspection requirement, and relative weighting. PGMaps reports the top candidates, explains the methodology and limitations, and opens the selected establishment and inspection history in the normal interface.

## Why This Matters

Public data is often available but difficult to use together. PGMaps makes agent assistance legible: assumptions are explicit, the evidence remains visible, and control can pass back and forth between person and agent at any time. The result is more useful than either DOM automation or a hidden backend workflow.

## How We Used AI

AI is the natural-language reasoning and orchestration layer. The agent discovers the relevant PGMaps experience, selects the appropriate page-scoped tools, translates a user's priorities into validated parameters, compares structured results, explains tradeoffs and caveats, and then updates the visible map for human review.

The product does not ask a model to invent risk or safety judgments. Deterministic application code performs filtering, distance calculations, normalization, weighting, and ranking. The agent interprets the user's request and communicates what the calculation can and cannot establish.

## How We Used Codex

Codex helped inspect the existing PGMaps architecture, design the WebMCP tool boundaries, implement page-aware registration and cleanup, connect tools to existing React state, add strict input validation and annotations, and build the cross-dataset food/crime workflow. It also helped create unit and Playwright coverage, exercise desktop and mobile map flows, run real-data smoke tests, audit the public changes for credentials, and verify the production build and deployment.

## Key Features

- Site-wide discovery tools for Food Safety, air quality, census, Index Lab, boundaries, Indigenous research, outdoors planning, infrastructure, and project experiences.
- Project search and navigation from natural-language intent.
- Map-story context, scene navigation, and layer visibility controls.
- Research-explorer context, filtering, ranked locations, and popup selection.
- Transparent food-establishment ranking using inspection violations and nearby mapped property-crime incidents.
- Adjustable time windows, radius, minimum-inspection rule, and crime/violation weighting.
- Page-scoped tool lifecycles with obsolete tools removed after navigation.
- Progressive enhancement: browsers without `document.modelContext` retain the complete human interface.
- Reusable project packages, story layouts, boundary search, and live iNaturalist species-at-risk exploration.

## Architecture

PGMaps is a React and TypeScript single-page application built with Vite and deployed on GitHub Pages. MapLibre and deck.gl render the visual workspace. WebMCP tools are registered through `document.modelContext`, validate narrow JSON-schema inputs, and invoke the same state-changing actions used by the interface.

Persistent site tools handle experience discovery. Catalog, story, research, and Food Safety pages register additional tools only while their required state is available. An `AbortController` cleans up page tools when navigation makes them irrelevant. Public datasets remain in the browser-side application; deterministic TypeScript code handles spatial distance and ranking.

## Testing Instructions

1. Open https://pgmaps.ahmadjalil.com/ in a WebMCP-capable ChatGPT browser.
2. Ask: “Find me a restaurant, coffee shop, bakery, or deli that balances the fewest inspection violations with the least nearby property crime. Use the last two years of inspections, require at least one inspection in that period, a 500 metre radius, the last three years of crime data, and a 60% crime / 40% violations weighting. Show me the top three, explain the tradeoff and limitations, then open the best option and its inspection history.”
3. Confirm the agent discovers Food Safety, applies the requested parameters, reports a ranked top three with methodology and caveats, and opens the selected establishment on the map.
4. Ask: “Now find a map project about climate and health, open it, go to Future Heat, and hide the hospital layer.”
5. Confirm the project, scene, narrative, camera, raster, and layer controls update in the visible interface.

Automated verification used for the challenge commit:

- TypeScript production build: passed.
- Vitest: 53 files and 567 tests passed.
- ESLint: passed with three non-blocking pre-existing React Compiler warnings.
- Playwright: 17 affected desktop/mobile WebMCP and project-story scenarios passed.

## Public Demo Link

https://pgmaps.ahmadjalil.com/

Useful direct routes:

- https://pgmaps.ahmadjalil.com/foodmap
- https://pgmaps.ahmadjalil.com/dev/projects

## Public Repository Link

https://github.com/ahzs645/PGMaps

Challenge implementation commit:

https://github.com/ahzs645/PGMaps/commit/2a3d19cd3a12b77eacbfcd609819fa01562ec378

Supporting public-data source commit:

https://github.com/ahzs645/bcdatamapper/commit/8df8d5e

## Demo Video

TODO: Upload the final public, under-three-minute demo video and paste its URL here.

Suggested length: 2 minutes 40 seconds.

1. Show the food/crime outcome first.
2. Hold on the top-three ranking, parameters, and caveat.
3. Open the selected establishment and inspection panel.
4. Run the climate-and-health story prompt and hide the hospital layer.
5. Close on the tool schema, deterministic ranking methodology, and shared visual result.

## Screenshot Shot List

1. Food Safety map with the selected establishment and inspection panel open.
2. ChatGPT tool result showing the top-three food/crime ranking, parameters, and limitations.
3. Climate-and-health story on the Future Heat scene with the hospital layer hidden.
4. Available site tools showing the persistent discovery tools plus page-scoped Food Safety tools.
5. A concise code view showing strict tool input schema, annotations, and shared React action.

## Submission Readiness Notes

- Public repository: ready and MIT licensed.
- Challenge commit: pushed to `main`.
- Production deployment: triggered from the challenge commit; verify the live commit before final entry.
- Automated tests: passed as listed above.
- Demo script: ready.
- Demo video: still required.
- Official Devpost eligibility, rules, required fields, and live entry status: must be checked through the signed-in Devpost connection or website before final submit.

## Known Limitations

- WebMCP support is experimental and depends on a compatible browser/client; the normal PGMaps UI remains usable without it.
- Inspection and property-crime records are historical public datasets with different coverage and update schedules.
- Nearby incidents are counted within a radius but are not attributed to an establishment and do not predict personal safety.
- Inspection violations do not guarantee current food quality or future compliance.
- Missing inspections are excluded by default rather than treated as evidence of a perfect record.
- Results can change as source datasets update and should be treated as planning context, not a guarantee or professional safety assessment.

## TODO Official Form Fields

- Confirm the exact official category and eligibility selections.
- Copy any challenge-specific questions from the live Devpost form and answer them here.
- Add the public demo-video URL.
- Add the final screenshots or project thumbnail.
- Confirm whether the official form requests a Codex session ID before recording one.
