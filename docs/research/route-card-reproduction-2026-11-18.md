# Reproducing a planning route card, November 2026

What was learned while rebuilding a BC Timber Sales "Route Card Tool Assessment" and its "Other Considerations"
sheet from public data (guide: `docs/forestry-route-card.md`).

## The evidence

- **Two sets of real planning workbooks:**
  - one licensee's six blocks and three road reports, each with the tool's own HTML page;
  - a district's ten earlier block workbooks.
- **Block and road shapefiles** in BC Albers.

They are a licensee's unreleased material: they stay outside the repository, and no block, road or person in them is
named here.

Each workbook has two sheets:

- *Route Card Tool Assessment*: 77 rows in five coloured sections. B holds the label, C holds Y, N or "Within 200 m
  of Block", and D lists what was found.
- *Other Considerations*: the topic in B, the paragraph in C, and pictures pasted in the paragraph's row.

The tool's "Overlap Oracle" HTML pages name no layers. Each embeds:

- the block polygon in WGS84, about 1.3 m off the shapefile;
- for every Y row, the source features with their attributes.

Layers were identified by matching those attributes and geometries against DataBC.

## The route card

**Rules (from the HTML pages and the distances of hits and misses)**

| Row | Y | Within | Evidence |
| --- | --- | --- | --- |
| Default | the feature touches the block or road | up to 200 m | 196 m was Within, 205 m was N, 1.3 m was Within |
| Existing Roads | to about 400 m | to about 600 m | 393 m Y, 442 m Within, 605 m N |
| Invasive species | any site within 5 km | no Within state | cut-off between 5,000 and 5,050 m |

- Road reports use the same rules on the road line.
- The 50, 200 and 400 m buffers among the shapefiles belong to consultation packages, not to the route card.
- Each Y row lists every distinct value of the printed fields in the layer's order, with an empty value printed as
  `None`. A Within row prints nothing in D.

**Match**

- 45 of 69 rows come from public layers.
- 439 of 440 comparable cells matched exactly, once the two known differences are set aside. Over all 495 comparable
  cells, 480 matched exactly.
- **Merged BEC:** the tool prints N throughout one tree farm licence, where the public biodiversity order covers it.
  Its Y/N follows the BCTS operating areas in all 21 workbooks.
- **Redesigned boundaries:** two blocks exist only as redesigned boundaries, 25 to 70 m off the originals.

## The rows no public layer holds

**First Nations**

- **Source:** the Consultative Areas Database. Its public map draws no areas, but its *SOE Report* posts to
  `apps.gov.bc.ca/pub/soe/reportGenerate.do` with an XML request over `PIP_CONSULTATION_AREAS_SP`.
- **Answer:** contacts by nation, with no area names or shapes.
- **Match:** it named the tool's nations in all 11 cases.
- **Access:** no CORS headers, so a browser cannot read it.
- **Stand-ins:** Statement of Intent boundaries and treaty areas do not reproduce it.

**Fisher (11 rows)**

- **Source:** the Working Group's "Fisher Habitat Retention Spatial Data and Tool", one zip per region holding a File
  Geodatabase. It is not in the BCGW or the BC Data Catalogue, and states no licence.
- **Fields:** they match the route card rows one for one.
- **Rule:** every polygon that touches the block, printing each field's distinct values in the layer's order.
- **Release used:** June 2021 (version 210215). It is no longer on the site; an archived copy exists.
- **Match:**

  | Release | Result |
  | --- | --- |
  | June 2021 | 10 of 11 cases identical, order included; the eleventh differs by one polygon 26 m from a redesigned boundary |
  | 2025 (version 250108) | 68 of 121 cells |

- **Recomputing from VRI:** not possible. The warnings come from the Working Group's landscape model.
- **In the browser:** gdal3.js read the 548 MB Omineca geodatabase round one block in about 3 minutes. It filled all
  11 rows with the tool's values; only number style differed (`0` for `0.0`), which PGMaps now matches.

**Migratory bird rankings**

- **The method:** the "Migratory Bird Nest Density Ranking Matrix for Forested Stands in the Interior of BC" (v1.3,
  2016), part of the industry guidance on nesting migratory birds. It is described in the 2017 Columbia Mountains
  Institute incidental-take proceedings:
  - rank 1 to 6 for each VRI polygon;
  - from BEC zone (8 groups), stand type (19), age class (5) and height class (4);
  - 1,409 of 3,040 combinations ranked.
- **Publication:** the matrix is not published.
- **Geometry:** the ranked polygons are VRI rank-1 polygons.
- **Partial cells:** a public web layer near Tumbler Ridge carries 183 of its cells. It states no licence, so it was
  used only to understand the classes.
- **PGMaps' own rule:** age, plus height for older stands, adjusted for pine, black spruce and deciduous share. It
  reproduces:
  - 4 of 11 rank sets exact on current VRI;
  - 28 of the 34 printed ranks;
  - 5 of 11 exact with stands back-dated about seven years. The tool likely ranked an older VRI; the offset is not
    applied.

**The rest**

| Row | Finding | Way to fill it |
| --- | --- | --- |
| Arch Sites | RAAD is restricted to named users. Only the Borden grid is public, and it cannot show a site | The user's own RAAD export |
| ESI moose rows, ESI study area | Held under the ESI's agreements. The 2022 legal moose winter ranges are public but different | Import or entry |
| BCTS Roads, Block State | Public BCTS layers give a licence and block but not the developed state; BCTS road-network names are not public | Import or entry |
| Lakeshore Management Zones | No layer for the district. The BCTS forest stewardship plan sets zone widths by lake class (A 250 m, B to D 100 m, E 50 m); the classes are on plan maps only | Entry |
| Cable line | Public TRIM cultural lines, FCODE `EA03800000` (cable) and `CQ00300000` (aerial cableway) | Live read |

## The Other Considerations

- **Topics:** nine in sixteen sheets.
- **When each appears:**
  - **Every sheet:** Old Forest, Patch Size, Watershed, Migratory Bird Habitat and Fisher.
  - **Visuals:** only when EVQC is Y (10 of 10; 0 of 3 where an EVQO was only within 200 m).
  - **TAP:** when the remnant row is Y or Within.
  - **Caribou:** when the winter range row is Y.
  - **Arch:** when Arch Sites is Y.

**How close the generated text came**

| Topic | Result |
| --- | --- |
| Watershed | 11 of 16 identical; the rest differ only by a wrong block name |
| Migratory birds | 9 of 16 identical; the rest differ by rank order |
| Fisher | 10 of 16 identical; three sheets omit a WARNING the route card lists |
| Old Forest | identical once the unit's standing statement is given |
| TAP, caribou | every fact (sides, road length inside, adjacent units) reproduced from public layers |
| Patch Size | the figures reproduced; the decision and initials stay the planner's |

12 hand-copied sentences name the wrong block.

**Pictures in the planners' sheets**

- Pasted into the paragraph's own row: a map under TAP (three sheets), a road screenshot under Visuals and a winter
  range map under caribou.
- PGMaps draws the maps from its reads and takes the Visuals pictures from the saved views.

## Viewpoints typed ERROR

12 of the 13 Visual Landscape Inventory viewpoints within 12 km of one test block are typed ERROR, including the one
its planner assessed from. They are now listed as flagged candidates rather than dropped.
