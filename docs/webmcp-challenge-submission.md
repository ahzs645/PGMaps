# WebMCP Challenge submission brief

## Project

**Working title:** PGMaps — an agent-native geospatial research workbench

**Live URL:** https://pgmaps.ahmadjalil.com/dev/projects

**Public repository:** https://github.com/ahzs645/PGMaps

## Short description

PGMaps turns complex public-interest maps into a shared workspace for people
and agents. A person keeps the visual, spatial context while an agent uses
structured WebMCP tools to find the right project, move through a map story,
control the visible evidence, filter a research collection, and open a location
for joint inspection. It can also combine historical restaurant-inspection and
nearby property-crime data through an explicit, adjustable ranking, then open
the selected establishment on the same map.

## Why this is a strong fit for WebMCP

Maps are unusually difficult for UI-driving agents. Important state is spread
across a canvas, layer controls, story cards, filters, popups, and the current
camera. Guessing at clicks is slow and fragile, while an API alone removes the
human from the live visual context.

WebMCP bridges that gap. PGMaps exposes the meaningful operations behind the
current page as narrow tools, and each tool updates the same React state that
drives the interface. The agent gets reliable structured actions; the person
sees every result on the map and can continue by hand at any point.

## Better user experience

A user can ask, "Find a project about climate and health, open it, and take me
to the scene about unequal burden." The agent searches structured project
metadata, opens the workspace, reads its available scenes, and advances the
narrative and map camera. The user can then ask to hide a distracting layer or
simply click and explore normally.

In the Nechako research explorer, the agent can inspect available decades and
resource categories, apply a precise filter, report matching totals and ranked
places, then select one location so its popup opens on the shared map. This
combination of structured analysis and immediate visual verification was
difficult to achieve with either DOM automation or a detached backend tool.

On the Food Safety map, the person can ask for a place with both fewer recent
inspection violations and fewer nearby mapped property-crime incidents. The
agent discloses and can adjust the incident radius, historical lookback, and
relative weighting, compares the currently visible establishments, and opens
the approved result and its inspection history. The tool reports source
limitations and does not turn historical records into a guarantee of personal
safety or food quality.

## What is new for this challenge

PGMaps and its project renderers existed before the challenge. The challenge
extension is the agent-native layer added after the August 25, 2026 submission
period began:

- the imperative WebMCP registration lifecycle and browser type support;
- page-scoped catalog, story, layer, raster, research-filter, and location
  tools wired to existing PGMaps application actions;
- site-wide experience discovery plus Food Safety context, filtering,
  cross-dataset ranking, establishment selection, and inspection-history tools;
- strict tool input validation, trust/read-only annotations, and compact
  verification results;
- unit tests plus Chromium end-to-end tests that simulate discovery and tool
  execution across desktop and mobile map layouts;
- WebMCP setup instructions, the open-source license, and this submission/demo
  documentation.

The dated commit that introduces these files and integrations should be linked
or named in the Devpost submission so judges can distinguish the eligible
WebMCP extension from the pre-existing mapping application.

## What people and agents can do together

- Search and open a relevant map project from plain-language intent.
- Read the current scene, available scenes, layer stack, and visibility state.
- Move a story by scene number, label, or title while its narrative, camera,
  and layer state update together.
- Show, hide, or toggle a named map layer without guessing at controls.
- Inspect a research map's live filters, totals, categories, decades, and
  highest-ranked mapped locations.
- Apply text, decade, and category filters and see the map and ranked list
  change immediately.
- Select a result by ID or human-readable name and open its visual popup.
- Discover and open Food Safety, air quality, census, Index Lab, boundaries,
  Indigenous research, outdoors planning, and infrastructure experiences.
- Rank visible food establishments by an adjustable balance of inspection
  violations and nearby mapped property-crime incidents, then inspect the
  selected establishment together.
- Hand control back and forth without creating a separate agent-only workflow.

## WebMCP implementation

PGMaps uses the imperative JavaScript API in the top-level page:

```ts
await document.modelContext.registerTool({
  name: 'go_to_map_scene',
  description: 'Move the current map story to a scene by number, label, or title.',
  inputSchema: {
    type: 'object',
    properties: { scene: { type: 'string' } },
    required: ['scene'],
    additionalProperties: false,
  },
  execute: async ({ scene }) => {
    // Resolves the scene, then calls the same React action used by the UI.
  },
})
```

Registrations are page-aware. The catalog offers discovery and navigation;
map stories offer context, scene, and layer tools; the research explorer offers
context, filter, and location tools; and Food Safety offers inspection context,
map filtering, transparent cross-dataset ranking, and establishment selection.
Two persistent tools let an agent discover and open the wider set of PGMaps
experiences. An `AbortController` unregisters page tools when the React page
state makes them irrelevant. Read operations and UI actions carry explicit
annotations, inputs are narrowly described and strictly validated, and tool
results include enough state to verify what happened.

The feature is progressive: browsers without `document.modelContext` use the
unchanged PGMaps interface.

## Suggested primary demo prompt

> Find me a restaurant, coffee shop, bakery, or deli that balances the fewest inspection violations with the least nearby property crime. Use the last two years of inspections, require at least one inspection in that period, a 500 metre radius, the last three years of crime data, and a 60% crime / 40% violations weighting. Show me the top three, explain the tradeoff and limitations, then open the best option and its inspection history.

## Demo video script (target: 2 minutes 40 seconds)

### 0:00–0:15 — Show the outcome first

Start on PGMaps beside ChatGPT and use the primary prompt. Show the agent
discovering and opening Food Safety.

Narration: "I want a useful answer that no single screen or dataset can give me:
a food option with fewer inspection problems and less mapped property crime
nearby."

### 0:15–1:20 — Cross-dataset food decision

Show `get_food_safety_context` and `rank_food_options`. Hold briefly on the top
three results, the 500 metre radius, three-year lookback, 60/40 weights, and the
caveat. Let the agent call `select_food_establishment`; the winning restaurant
and its inspection panel open on the shared map.

Narration: "The score is transparent and adjustable. It uses historical public
records as planning context, not as a promise that a place is safe. The agent
does the comparison while I keep the map, the evidence, and the final choice."

### 1:20–2:20 — A second kind of shared map

Prompt: "Now find a map project about climate and health, open it, go to Future
Heat, and hide the hospital layer."

Show `open_map_experience`, `find_map_projects`, `open_map_project`,
`go_to_map_scene`, and `set_map_layer_visibility` updating the narrative,
camera, raster, and visible layer controls.

Narration: "The same WebMCP layer works across analytical decisions and visual
story maps. Every result lands in the interface the person is already using."

### 2:20–2:40 — Implementation and close

Show the ranking schema, read-only annotation, explicit methodology, and shared
selection action. End on the selected map result.

Narration: "Tools are registered only when they are useful, inputs are strictly
validated, and unsupported browsers keep the complete human interface. This is
the open web as a genuinely shared workspace for people and agents."

## Submission checklist

- [ ] Commit and push the WebMCP implementation and MIT `LICENSE` to `main`.
- [ ] Confirm GitHub identifies the repository license at the top of the repo.
- [ ] Wait for the GitHub Pages deployment and test the live URL in ChatGPT's
      built-in browser with GPT-5.6 Sol or Terra.
- [ ] Inspect Available site tools on Food Safety, the catalog, a story, and the
      research explorer; confirm old page tools disappear after navigation.
- [ ] Run the two demo prompts and verify every visible change and returned
      result.
- [ ] Record at 1080p with readable browser and chat text and clear audio.
- [ ] Upload a public, under-three-minute YouTube video.
- [ ] Complete Devpost eligibility and official-rules checks, including country
      restrictions and age of majority.
- [ ] Paste the live URL, public repository URL, video URL, and the edited
      description sections above into the submission form.
- [ ] Submit before September 4, 2026 at 1:00 a.m. PDT, leaving time to reopen
      the submitted entry and verify all links.
