# Block planner: next steps

What is still open in `/dev/forestry/block-planning` after old and old interior forest were built (24 November 2026), in the order to take it up. The contracts are [Block planning and Prince George forest patch scenarios](forestry-patch-scenarios.md) and [Old and old interior forest in the block planner](forestry-old-forest.md). Each item says what it changes, where it would go, what decides it, and how to know it worked. When one is built, move its rules into the contract and delete it here.

## Done: the four old-forest gaps

Built on 24 November 2026 and moved into [the old-forest contract](forestry-old-forest.md): private land and excluded tenures left out of the CFLB proxy (A6 and A10 now within 1% and 3% of the Board's CFLB), pipelines in the 2005 interior method, D.4's younger stands and D.2's pooling. What they leave open is in the contract's **Limits and what is not built**.

## Done: what the instruments on a block can reach

Built on 24 November 2026 with its own contract, [On this ground](forestry-ground-instruments.md): step 5 reads every legal instrument mapped on the block shape under review (Land Act reserves, withdrawals, designated use areas and tenures, the ALR, legal objectives and OGMAs, winter ranges and habitat areas, range tenures, parks, ecological reserves and protected areas, private parcels, community watersheds), shows what each can reach for harvest, replanting, roads and grazing with the provision each answer rests on, reads RESULTS precedent inside each one near the block, and drafts the documents to ask for. A second batch the same day added notations of interest and applications, the Robson Valley ADA order, mineral and placer tenures, water licences near the block (points), woodlots, community forests, First Nations woodland licences and TFLs, recreation sites and trails (lines), scenic areas and visual quality objectives, and federal critical habitat, and gave the precedent the public signals of an exception (SPEX openings, standards units with no regeneration obligation or under a variation, exempt cut blocks, ALR applications and notices of intent). What it leaves open is in the contract's **Not built**.

## Done: a map of old and interior forest, and D.3's summary

Built on 24 November 2026 and moved into [the old-forest contract](forestry-old-forest.md): the plan map draws old forest, old interior, the 200 m edges, D.1 and D.4 ground and the ground left out for the schedule and year on the map, from the worker's own run of the calculation (**A map of old and interior forest**), and _Representative stands (D.3)_ sets old forest beside the CFLB by leading species, BEC variant, age class and site index, under the order's and the policy's words (**D.3: representative stands**). What they leave open is in the contract's **Limits and what is not built**.

## Done: the law behind a finding, and what the rules reach

Built on 27 November 2026 and moved into the planner contract, **The law behind a finding**: every citation opens its provision with the cited words marked, each topic has a decision flowchart, and every section of the stored Acts and regulations and every provision of the transcribed Omineca orders has a dated reading of what it bears on and whether a rule tests it (the **Law coverage** map, and the [coverage book](legal-coverage-book.md)). The high gaps that reading found became rules: FPPR 1.2.0, the cutting and road permit pack, and the Omineca old growth, Mackenzie biodiversity and visual quality packs. What is left is below and in the book's **Open gaps**.

## Done: exceptions as a choice, with a rationale

Built on 27 November 2026 and moved into the planner contract, **The law behind a finding** → **Exceptions**: a rule lists the exceptions the law makes to it, each holding by law or needing a decision; a reviewer claims one on a raised finding with a rationale, evidence and the decision, and the finding stays raised with the claim's standing beside it. FPPR 1.3.0, the permit pack 1.1.0 and old growth 1.1.0 moved their exception questions into exceptions, and Crown grazing 1.2.0 did the same for its §44(3) purposes and FPPR §46.11's tolerance.

## Done: Mackenzie old forest, calculated

Built on 27 November 2026 and moved into [the old-forest contract](forestry-old-forest.md), **The Mackenzie order**: Review → *Mackenzie old forest* calculates every row of the 2008 order's Table 2 as replaced in 2010, with Table 3's interior shares, the order's own old age, CFLB and Natural Forest Area, and the younger-stand allowance on the live old forest part only, as evidence beside the Mackenzie pack's margins. What it leaves open is in the contract's **Limits and what is not built**.

## Next

### Map screens behind the reviewer's answers

The permit and old-growth packs ask questions a layer could answer as a candidate, as *On this ground* does: candidate old forest areas (the non-legal OGMA layer filtered to `PRG_COFA` and `PRG_DPG`, the 2022 letter's Appendix 5; the visual quality route card already reads it), special purpose areas, pine-leading VRI polygons of 5 ha or more in the listed TSAs, lakeshore management zones, fisheries sensitive watersheds and mapped L1 lakes. FSP forest development units and forest landscape areas have no public layer found yet. Each is a ground catalogue layer with its reach cells cited, and stays a candidate the reviewer confirms.

### Prepared tables in bcdatamapper

Sized in [Prepared tables for the block planner](research/block-planning-prepared-tables-2026-11-24.md): about 60 MB on bcdatamapper's Pages site, with VRI geometry (about 200 MB gzip) on R2. They make:

- the Board check instant;
- old forest possible for units past 30,000 stands (A13 and the large E and D units), alone or pooled under D.2 (A3 printed "combined with A13");
- a sub-unit's baseline read take 1–2 s instead of 20–66 s.

Build them in `vendor/bcdatamapper` under AGENTS.md's **Updating submodule data**, publish through `pages/site.json` and `src/config/data-hosts.json`, and read them through `withBase`. Keep the live reads as the fallback and say which one a figure came from.

### The Board check on the other ten sub-units

Run on 24 November 2026 from Node, harvests only, through `boardCheck` itself, and recorded in the guide's **The other ten sub-units** (all ten ran). What they show, and what is left:

- **Six cannot be run in the browser yet.** Fort St. James Omineca – Mountain and – Valley, and Prince George and Vanderhoof Moist Interior – Plateau, read 25,677 to 46,261 records, past the 25,000 limit; the run raised it in a copy of the reader only. Both Wet Trench units run the browser's 5 km grow out of memory; the run grew them polygon by polygon. The prepared tables (above) lift the record limit and the wait: the four large units' checks took 11 to 56 minutes in Node, and Wet Trench – Valley's 1 hour 43 minutes. A smaller fix for the Wet Trench units is to grow each polygon on its own in `grownUnit`, as the run did; it draws the same shape, but moves every unit's read boundary by the buffer's segment error, so check the other units' figures do not move before making it.
- **Fixed on the way.** McGregor Plateau and Wet Mountain could not be read at all: the order layer stores a single space for a missing sub-unit, and the reader asked for an empty one (`orderUnits.ts`). DataBC's cutblock service answered 502 after two minutes on full pages of Prince George Moist Interior – Mountain on every read from about 08:00 UTC (it read whole at 00:06); the reader now asks again at half the size (`readCutblockPages`).
- **What the twelve say.** Five plateau and valley units come within 9–18 points summed in both years, and Wet Trench – Valley within 7.2 in 2018. Wet Mountain and Wet Trench – Mountain are 30–40 points out, with 6–20 points too much in patches over 1,000 ha; clipping patches at the boundary does not explain it. And the smallest class reads high in ten of the twelve, by 1.8–9.5 points, so the next item is not one unit's problem.

### What the Board check still does not explain

- **Smallest class.** It reads 7–8 points high in Prince George Moist Interior – Mountain, and 1.8–9.5 points high in ten of the twelve sub-units; which class gives it up varies by unit. Tiny records, dating rules and the young window are ruled out on Prince George Moist Interior – Mountain.
- **Fort St. James 2015 does not reproduce.** Today's records hold only about 400 ha of young forest in that unit in 2015.
- **Wet Mountain and Wet Trench – Mountain.** Too much in the largest class with whole patches; clipped, Wet Trench – Mountain has none there.

The next thing to try is the LLOWG's own records; do not change the method before they are read. The Board (FPB/IRC/235, December 2020, pp. 5 and 7) says the LLOWG, the licensee subset of the 2002 landscape objectives working group, "annually collects harvest, road and retention data from all PG TSA licensees", ran the young-forest patch analysis in 2015, an interim one in 2018 "using the process in the 2017 chief forester's guidance", and planned another for 2020, and reports its results "to licensees and the Ministry", which "uses the report to monitor compliance". It calls the analyses non-spatial (p. iii).

**What to ask for**, for each of the 2015, 2018 and (if run) 2020 patch analyses, and the 2019 old forest analysis:

1. The report as delivered to the Ministry, with its results by district, NDU and mBEC.
2. The disturbance inputs: the harvest, road and retention polygons as compiled from each licensee, with each one's date and the field it came from; whether RESULTS, consolidated cutblocks or licensee GIS; and whether fires, beetle-killed stands, roads and retention were counted as young forest or left out.
3. The land base: the VRI vintage and the date its ages were projected to, the CFLB and its netdowns (private land, parks, TFLs, woodlots, community forests), and the NDU and mBEC boundaries as used.
4. The patch method as run: the young window and the date it was measured from; the join and buffer distances at each stage (the 2005 policy's for 2015, the 2017 guidance's for 2018); whether patches were cut at the NDU, district or TSA boundary; any minimum patch or record size.
5. The software and settings (tool, version, model or script), and the output patch layer with each patch's size class.
6. The September 2017 chief forester's guidance itself, _Omineca Region Guidance – Stand and Landscape-Level Retention for Harvesting in Response to Spruce Beetle Outbreaks_, which was not found online.

**Who holds it.** The LLOWG is a group of licensees, not a public body: reach it through its members. The Ministry of Forests holds the reports it received (Omineca Region; Prince George and Stuart Nechako natural resource districts). BC Timber Sales Prince George is a licensee in the group (FPB/IRC/235 footnote 8). The Forest Practices Board holds what it was given for complaint investigation 18042.

**The channel.** Ask the Prince George district's stewardship staff and the Board directly first, naming the analyses and years. The fallback is a freedom of information request to the Ministry of Forests (which covers BCTS) and to the Board, which FOIPPA Schedule 2 lists as a public body with its Chair as head. Licensees' harvest records may be withheld or cut under FOIPPA §21 (third-party business interests). The request is also a row of [Records behind exceptions](research/non-public-records-for-exceptions-2026-11-24.md), section 11.

When they arrive, run the check on the LLOWG's own inputs first: if it then reproduces the Board's shares, the difference was the inputs; if not, it is the method, and the settings in item 4 say where.

### A5's old forest

A5's land base matches the Board's to 4%, but its old forest is 12 points short of the Board's share. A6, now that its land base matches to 1%, is 3 points short (40.4% against 43.6%). The likeliest cause is the VRI vintage: today's ages against the 2019 inventory, and stands harvested between 2019 and the VRI projection whose 2019 age is not kept (262 ha on A6).

Tried on 24 November 2026 (the guide's 2019 table, **The 2019 inventory, where it could be read**). FAIB's 2019 VDYP7 input, joined to today's stands by `FEATURE_ID`, reaches the polygons the two vintages share: 52% of A5's proxy CFLB and 60% of A6's. There the ages agree and 2019 old forest does not move (A5 2,807 to 2,807 ha, A6 6,681 to 6,686 ha). The rest is drawn as polygons the 2019 inventory did not have (6,174 ha on A5, 6,529 ha on A6, including A6's 262 ha harvested since), and its 2019 ages need the 2019 polygons. Those are only in the province-wide rank 1 file, 5.36 GB zipped and 7.2 GB unpacked, with rows in no spatial order, past what this check could download. Next, in order:

1. Read `VEG_COMP_LYR_R1_POLY_2019.gdb.zip` whole on a machine with the room, keep A5's and A6's polygons, delete the file, and run the 2019 check with their ages (`PROJ_AGE_1`, `PROJECTED_DATE`, `HARVEST_DATE` as today's read takes them).
2. Or ask FAIB (Forest Analysis and Inventory Branch) for a clip of the 2019 rank 1 layer to A5 and A6, and the 2018 one too: which vintage the LLOWG's 2019 analysis used is not stated.
3. Or take the LLOWG's own 2019 inventory from the request under **What the Board check still does not explain**.

Record the answer in the guide's 2019 table.

### Offline old-forest reads

Old-forest reads are kept only for the session. Their result travels with the plan, but a reviewer offline cannot change a setting and recalculate. Keeping a unit's reads would need a `download` entry in `STORE_CATALOGUE` and **Offline and storage**'s rules (AGENTS.md, **Offline and caching**). Decide this once the prepared tables exist, since they may make it unnecessary.
