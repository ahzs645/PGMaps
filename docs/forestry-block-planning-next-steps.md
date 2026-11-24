# Block planner: next steps

What is still open in `/dev/forestry/block-planning` after old and old interior forest were built (24 November 2026), in the order to take it up. The contracts are [Block planning and Prince George forest patch scenarios](forestry-patch-scenarios.md) and [Old and old interior forest in the block planner](forestry-old-forest.md). Each item says what it changes, where it would go, what decides it, and how to know it worked. When one is built, move its rules into the contract and delete it here.

## Next: the two remaining old-forest gaps

These are what Objectives A and B do not model yet (private land, excluded tenures and pipelines were built on 24 November 2026; see the contract). Each must leave a plan that does not use it calculating exactly as now.

### 1. D.4: up to 20% of younger stands

The order lets up to 20% of the old and old interior objectives be met by younger age classes, "where it can be demonstrated that equal or better conservation benefits would result". That benefit is a judgement, so D.4 is the reviewer's, never the model's.

**Where it goes.**

- A switch in the panel's _Assumptions you can change_, off by default.
- With it, a stated age (for example, from 100 years) and a required statement of the conservation benefit, kept on `OldForestChoices`.
- When on, stands from that age up to the old age count toward A and B, up to 20% of each requirement and never more. The panel, the record and the summary show how many hectares D.4 supplied.
- D.5(a)'s evidence line says when a result leans on D.4.

**Done when.**

- A unit short of old forest by less than 20% of its requirement reads as met only with the switch on and a statement given.
- The record carries the statement.
- `firstShortfall` names D.4 when it is the difference.

### 2. D.2: pooling units

D.2 lets a licensee meet the combined requirement of similar mBEC units across district boundaries. A3 is printed "combined with A13". Decision 5 keeps pooling off by default, and the reviewer chooses it.

**Where it goes.**

- `OldForestChoices` gains an optional list of units to pool with the chosen one.
- The worker reads each unit, as it does one now. The requirement is the sum of each unit's CFLB × its own percentage, and the old forest held is the sum across all of them, never counted twice.
- The record names every unit pooled. The Board comparison stays per unit, because the Board's table is per unit.

**Done when.**

- A3 pooled with A13 reports the combined requirement and holding.
- The record says it is pooled.
- An overlap between pooled units (there should be none) is refused, never double-counted.

A13 alone is past the 30,000-stand limit, so this needs the prepared tables below.

## After that

### Prepared tables in bcdatamapper

Sized in [Prepared tables for the block planner](research/block-planning-prepared-tables-2026-11-24.md): about 60 MB on bcdatamapper's Pages site, with VRI geometry (about 200 MB gzip) on R2. They make:

- the Board check instant;
- old forest possible for units past 30,000 stands (A13 and the large E and D units);
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

### A map of old and interior forest

The panel reports figures but draws nothing. Add old ground, interior ground and the 200 m edges as a plan-map layer for the year on the map, through the toolkit's `Map` props and a legend row, as `forestry-tool-standard.md` asks. A reviewer then sees where a block takes interior.

### D.3: representative non-pine stands

D.3 requires a representative share of stands not affected by the beetle. The non-pine figure against policy Tables 8–10 is reported today; representativeness beyond it (by BEC variant, age and site) is not. It is a reviewer's judgement first; build a summary that helps it, never a pass or fail.

### Offline old-forest reads

Old-forest reads are kept only for the session. Their result travels with the plan, but a reviewer offline cannot change a setting and recalculate. Keeping a unit's reads would need a `download` entry in `STORE_CATALOGUE` and **Offline and storage**'s rules (AGENTS.md, **Offline and caching**). Decide this once the prepared tables exist, since they may make it unnecessary.
