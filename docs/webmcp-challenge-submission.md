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
for joint inspection.

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

## What is new for this challenge

PGMaps and its project renderers existed before the challenge. The challenge
extension is the agent-native layer added after the August 25, 2026 submission
period began:

- the imperative WebMCP registration lifecycle and browser type support;
- page-scoped catalog, story, layer, raster, research-filter, and location
  tools wired to existing PGMaps application actions;
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
context, filter, and location tools. An `AbortController` unregisters tools
when the React page state makes them irrelevant. Read operations and UI actions
carry explicit annotations, inputs are narrowly described and strictly
validated, and tool results include enough state to verify what happened.

The feature is progressive: browsers without `document.modelContext` use the
unchanged PGMaps interface.

## Demo video script (target: 2 minutes 35 seconds)

### 0:00–0:20 — Problem and premise

Show the PGMaps catalog and ChatGPT side by side.

Narration: "Maps are hard for agents because the real state lives across a
canvas, filters, layers, and popups. PGMaps uses WebMCP so the agent can operate
the same live map I am looking at, through explicit tools instead of guessed
clicks."

Open the browser's Site tools menu briefly to show the two catalog tools.

### 0:20–1:15 — Story-map collaboration

Prompt: "Find a map project about climate and health, open the best match, and
tell me what scenes I can explore."

Show the agent call `find_map_projects`, `open_map_project`, and
`get_map_project_context` while the workspace opens.

Prompt: "Take me to the scene about the highest burden, then hide one context
layer so I can compare the map."

Show `go_to_map_scene` animate the narrative/camera and
`set_map_layer_visibility` change the visible evidence.

Narration: "The agent reads structured scene and layer state, while I keep the
spatial context and can intervene with the normal controls."

### 1:15–2:10 — Research-explorer collaboration

Return to projects and open the Nechako Watershed Research Portal.

Prompt: "What decades and research categories are available? Filter to one
decade and the most relevant category for water, then show me the leading
location."

Show `get_research_map_context`, `filter_research_map`, another context read,
and `select_research_location`. Hold on the changed clusters, totals, ranked
list, and open popup.

Narration: "A detached API could return rows, but WebMCP lets the agent change
the exact map I am inspecting and gives both of us the same result to verify."

### 2:10–2:35 — Implementation and close

Show the WebMCP registration code, input schema, annotations, and shared React
action. End on the live map.

Narration: "Tools are registered only when they are useful, inputs are strictly
validated, and unsupported browsers keep the complete human interface. This is
the open web as a genuinely shared workspace for people and agents."

## Submission checklist

- [ ] Commit and push the WebMCP implementation and MIT `LICENSE` to `main`.
- [ ] Confirm GitHub identifies the repository license at the top of the repo.
- [ ] Wait for the GitHub Pages deployment and test the live URL in ChatGPT's
      built-in browser with GPT-5.6 Sol or Terra.
- [ ] Inspect Available site tools on the catalog, a story, and the research
      explorer; confirm old page tools disappear after navigation.
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
