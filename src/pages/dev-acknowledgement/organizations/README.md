# Organization acknowledgement database

One JSON file per organization in this folder. Files are **auto-discovered** by
`index.ts` (`import.meta.glob('./*.json')`), so adding an org = dropping a
`<id>.json` here. No index edits, no code changes.

This database powers the **Multi-point composer & org comparison** on
`/dev/acknowledgement`: it pins each org's campuses on the map, resolves the
Nation(s) our engine derives from geography, and compares that against what the
org actually names.

## ⚠️ The one hard rule: facts + a link, never the verbatim statement

We do **not** store an organization's verbatim land/territory acknowledgement
text (it is the organization's copyrighted wording). Store only:

- the **facts** — which Nations they name, where their sites are, how they frame it; and
- the **`sourceUrl`** — the official page where the full wording lives.

If you are given a statement, **extract the facts from it** (the list of Nations,
the framing). Do not paste the sentence into the JSON, and do not paraphrase it
so closely that it reproduces the original. `note` is a short factual summary
(e.g. "Musqueam, Squamish, and Tsleil-Waututh"), not a reworded quote.

## Schema (`OrgRecord`, see `index.ts`)

```jsonc
{
  "id": "kebab-case-id",                 // filename must be "<id>.json"
  "name": "Full organization name",
  "sector": "university | college | institute | health | crown-agency | municipality",
  "framing": "single_specific | per_campus | regional | mixed",
  "acknowledges": ["Nation A", "Nation B"], // institution-wide union of Nations named (facts)
  "sourceUrl": "https://…",              // official acknowledgement page
  "note": "Short factual summary (not the verbatim statement).",
  "pattern": "located_on",               // optional: short structural label, see below
  "campuses": [
    { "name": "Campus / site name", "latitude": 0, "longitude": 0, "acknowledges": ["Nation A"] }
  ]
}
```

### Field guidance

- **`framing`** — pick by how the org words it:
  - `single_specific` — one site, names specific Nation(s).
  - `per_campus` — distinct campus-by-campus acknowledgements (e.g. UBC, SFU).
  - `regional` — broad "First Nations across BC / the region", names no specific Nation (e.g. most Crown agencies). Put `acknowledges: []` (or only people-groups), keep one representative campus point.
  - `mixed` — broad institution-wide wording **plus** campus specifics (e.g. UNBC, VIU).
- **`acknowledges`** (org level) — the union of Nations named across sites. Use the names the org uses; common English names are fine (the engine fuzzy-matches).
- **`campuses[].acknowledges`** — the Nation(s) for that specific site. For `regional` orgs this is usually `[]`.
- **`latitude`/`longitude`** — campus/site or city-hall coordinates (approximate is OK; verify if precision matters). Used to resolve the territory polygon at that point.
- **`pattern`** (optional) — a short structural label for the wording *form* (never the words), useful for the engine/template comparison. Examples seen so far:
  `located_on`, `situated_on_unceded`, `gathered_today_unceded`,
  `on_whose_land_we_live_work_play`, `operates_on_lands_and_waters`,
  `offers_services_on`, `shared_territories`.

## How to add an org from a source

1. Find the org's **official** acknowledgement page → `sourceUrl`.
2. Read it and **extract facts only**: the Nation(s) named (and per campus if it
   differs), and the framing style. Do **not** copy the sentence in.
3. Get coordinates for each campus/site (campus address or city hall).
4. Choose a kebab-case `id`; write `src/pages/dev-acknowledgement/organizations/<id>.json`.
5. Done — it appears in the picker automatically. Verify on `/dev/acknowledgement`
   by selecting it and checking the "They name" vs "Our engine resolved" panel.

## Canonical Nation resolution (`nations.ts`)

`acknowledges` stays as the **free text** each org uses. `nations.ts` provides a
resolver (`createNationResolver(graph)`) that maps each free-text name to a
canonical identity:

- `nation` — matches a Nation in the relationship graph (by preferred/alternate name);
- `people-group` — matches a people-group (e.g. "Ts'msyen", "Coast Salish");
- `unlisted` — not in our database yet.

The resolver references **two** sources, so coverage does **not** depend on the
submodule relationship graph:

1. the **relationship graph** (verified Nations + people-groups), and
2. **`nationRegistry`** in `nations.ts` — an in-repo list we maintain ourselves.

To map a Nation an org names, add a `nationRegistry` entry (no submodule edit):

- **Nation already in the graph, different name** → add an entry with
  `graphNationId` set + the free-text form in `aliases` (e.g. Squamish,
  Tsleil-Waututh, Syilx). It resolves as `inGraph: true`.
- **Nation not in the graph at all** → add an entry *without* `graphNationId`
  (e.g. Snuneymuxw, Wet'suwet'en). It resolves as a `nation` we recognize, just
  `inGraph: false` (registry-backed). If it later gets added to the relationship
  graph, set `graphNationId` to link them.

The composer shows `Mapped to our database: X/Y (Z in verified graph, rest in
registry)` and only chips names in **neither** source.

## Notes on accuracy

- Coordinates and Nation lists here are a working dataset seeded from public
  sources; verify against the org's current official statement before relying on
  them. The composer marks geometry-derived output as review-level for the same
  reason.
- `acknowledges` should reflect what the **org** names, not what our engine
  resolves — the whole point is to compare the two.
