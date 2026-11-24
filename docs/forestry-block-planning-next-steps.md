# Block planner: next steps

What is still open in `/dev/forestry/block-planning` after old and old interior forest were built (24 November 2026), in the order to take it up. The contracts are [Block planning and Prince George forest patch scenarios](forestry-patch-scenarios.md) and [Old and old interior forest in the block planner](forestry-old-forest.md). Each item says what it changes, where it would go, what decides it, and how to know it worked. When one is built, move its rules into the contract and delete it here.

## Done: the four old-forest gaps

Built on 24 November 2026 and moved into [the old-forest contract](forestry-old-forest.md): private land and excluded tenures left out of the CFLB proxy (A6 and A10 now within 1% and 3% of the Board's CFLB), pipelines in the 2005 interior method, D.4's younger stands and D.2's pooling. What they leave open is in the contract's **Limits and what is not built**.

## Done: what the instruments on a block can reach

Built on 24 November 2026 with its own contract, [On this ground](forestry-ground-instruments.md): step 5 reads every legal instrument mapped on the block shape under review (Land Act reserves, withdrawals, designated use areas and tenures, the ALR, legal objectives and OGMAs, winter ranges and habitat areas, range tenures, parks, ecological reserves and protected areas, private parcels, community watersheds), shows what each can reach for harvest, replanting, roads and grazing with the provision each answer rests on, reads RESULTS precedent inside each one near the block, and drafts the documents to ask for. A second batch the same day added notations of interest and applications, the Robson Valley ADA order, mineral and placer tenures, water licences near the block (points), woodlots, community forests, First Nations woodland licences and TFLs, recreation sites and trails (lines), scenic areas and visual quality objectives, and federal critical habitat, and gave the precedent the public signals of an exception (SPEX openings, standards units with no regeneration obligation or under a variation, exempt cut blocks, ALR applications and notices of intent). What it leaves open is in the contract's **Not built**.

## Done: a map of old and interior forest, and D.3's summary

Built on 24 November 2026 and moved into [the old-forest contract](forestry-old-forest.md): the plan map draws old forest, old interior, the 200 m edges, D.1 and D.4 ground and the ground left out for the schedule and year on the map, from the worker's own run of the calculation (**A map of old and interior forest**), and _Representative stands (D.3)_ sets old forest beside the CFLB by leading species, BEC variant, age class and site index, under the order's and the policy's words (**D.3: representative stands**). What they leave open is in the contract's **Limits and what is not built**.

## Next

### Prepared tables in bcdatamapper

Sized in [Prepared tables for the block planner](research/block-planning-prepared-tables-2026-11-24.md): about 60 MB on bcdatamapper's Pages site, with VRI geometry (about 200 MB gzip) on R2. They make:

- the Board check instant;
- old forest possible for units past 30,000 stands (A13 and the large E and D units), alone or pooled under D.2 (A3 printed "combined with A13");
- a sub-unit's baseline read take 1–2 s instead of 20–66 s.

Build them in `vendor/bcdatamapper` under AGENTS.md's **Updating submodule data**, publish through `pages/site.json` and `src/config/data-hosts.json`, and read them through `withBase`. Keep the live reads as the fallback and say which one a figure came from.

### The Board check on the other ten sub-units

The Board published 2015 and 2018 shares for twelve district × sub-unit pairs. Only Prince George and Fort St. James Moist Interior – Mountain have been checked. Fort St. James Omineca – Mountain is past the 25,000-record read limit, and the large Plateau units are heavy for one browser. Run them from the prepared tables, harvests only, and add each to the guide's table.

### What the Board check still does not explain

- **Smallest class.** It reads 7–8 points high in Prince George Moist Interior – Mountain. Tiny records, dating rules and the young window are ruled out.
- **Fort St. James 2015 does not reproduce.** Today's records hold only about 400 ha of young forest in that unit in 2015.

The next thing to try is the LLOWG's own records. The Board names the 2015 and 2018 LLOWG analyses; ask for their inputs before changing the method.

### A5's old forest

A5's land base matches the Board's to 4%, but its old forest is 12 points short of the Board's share. A6, now that its land base matches to 1%, is 3 points short (40.4% against 43.6%). The likeliest cause is the VRI vintage: today's ages against the 2019 inventory, and stands harvested between 2019 and the VRI projection whose 2019 age is not kept (262 ha on A6). Test it with an archived VRI of 2019 (FAIB keeps vintages), and record the answer in the guide's table.

### Offline old-forest reads

Old-forest reads are kept only for the session. Their result travels with the plan, but a reviewer offline cannot change a setting and recalculate. Keeping a unit's reads would need a `download` entry in `STORE_CATALOGUE` and **Offline and storage**'s rules (AGENTS.md, **Offline and caching**). Decide this once the prepared tables exist, since they may make it unnecessary.
