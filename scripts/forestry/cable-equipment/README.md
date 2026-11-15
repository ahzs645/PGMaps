# Cable-logging equipment library

`build-library.mjs` builds `src/pages/dev-forestry-roads/cableEquipment/skylineXl.generated.json`,
the open yarder, carriage and wire-rope library behind PGMaps' rigging sets, from the USDA Forest
Service's **SkylineXL 25.0** workbook (`Database` sheet, updated 2024-11-01).

**Source and licence.** SkylineXL is listed at
<https://www.fs.usda.gov/forestmanagement/products/programs-software.shtml>, which states that its
programs "have been developed by the USDA Forest Service and are public domain software". The
workbook itself is not kept in the repository; download it from
<https://www.fs.usda.gov/sites/default/files/forest-management/products/skyline-xl-25.xlsm>
(retrieved 2026-11-14, SHA-256 `3af9dc20…f2b951a`). Cite the data as "USDA Forest Service,
SkylineXL 25.0 database (updated 2024-11-01), public domain".

```sh
node scripts/forestry/cable-equipment/build-library.mjs path/to/skyline-xl-25.xlsm          # rebuild
node scripts/forestry/cable-equipment/build-library.mjs path/to/skyline-xl-25.xlsm --check  # compare only
npm run cable-equipment:build -- path/to/skyline-xl-25.xlsm                                   # the same, from package.json
npm run cable-equipment:check -- path/to/skyline-xl-25.xlsm
```

Never edit the generated JSON by hand: change the script and rebuild.

**What it does.**

- Refuses a workbook whose SHA-256, title cell (`Database!G1`) or database date (`Database!O2`)
  differs. A new SkylineXL version means updating `SOURCE` in the script.
- Reads the sheet's English tables (yarders rows 5–29, carriages rows 57–79, rope table
  `AH6:AO19`) from the cells' stored values. No formula is evaluated and the workbook's VBA is never
  opened.
- Converts to SI with exact factors (in → mm, ft → m, lbf → N, lb/ft → kg/m, hp → kW, ft·lbf → N·m)
  and keeps each row as the sheet gives it under `sheet`.
- Gives every record its source (`dataset`, `version`, `databaseUpdated`, `retrieved`, `cells`).
- Checks every SI value against the sheet's own metric tables, which use rounded factors
  (25.467 mm/in, 3.28 ft/m, 0.453 kg/lb, forces in kgf), and stops on any disagreement beyond that
  rounding.
  - Four metric rows leave a rope type blank (`F127`, `F129`, `F132`, `K124`), so SkylineXL looks
    up EIPS values for a swaged rope there.
  - The English row names the type and is used. The difference is written into the record's
    `notes`.
- Checks each yarder line's weight and design tension against the rope table (all agree), and
  each rope's safe working load against breaking strength ÷ 3 (all agree).

**Contents.**

| Table     | Records | Notes                                                                                     |
| --------- | ------: | ----------------------------------------------------------------------------------------- |
| Yarders   |      25 | 21 machines and 4 SkylineXL class averages (small, medium, large, running).               |
| Carriages |      23 | Weight, power, clamp, slackpulling method, multispan, drums needed, line diameter ranges. |
| Ropes     |      24 | 13 EIPS and 11 swaged diameters (no swaged below 3/8").                                   |

**Left out.**

- The user-added rows the workbook keeps empty.
- The sheet's metric tables, which are used only for the cross check.
- SkylineXL's profile, analysis and jack-data sheets.

The library gives no payload, load clearance, rope fill factor or elastic modulus:
`cableEquipment.ts` lists those as values to confirm when it builds a rigging set.
