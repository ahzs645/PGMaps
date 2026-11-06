# Food spinner dining categories

Audit of the checked-in food-health snapshot on September 30, 2026: **457
premises**, with **253 default dining candidates** and **204 excluded premises**.
Turning on Other spots adds eight more, for 261 candidates and 196 exclusions.
These are records in the inspection library, not a
verified list of currently operating businesses.

The food safety map retains every premise. Restaurant Roulette uses its own
dining eligibility in `src/maps/foodmap/dining.ts` before applying any optional
distance, violation or hazard filters. Turning off “Distance and safety
filters” never bypasses the dining selection. Category, wheel-size and optional
filter controls sit behind the Filters button so the wheel comes first, and
spinning closes that panel. On phones the roulette also opens from the collapsed
sheet, so it is reachable without expanding the panel.

All eight dining categories are selected initially, and users can narrow them
independently of the safety filters. A ninth category, **Other spots**, holds
the named exceptions below and starts off. Users see it as one category rather
than as individual places: turning it on adds all eight, whichever other
categories are selected, and they still obey enabled distance/safety filters.
“All” selects all nine categories; it does not include all inspected premises.

## Category inventory

The source category is the name-based `restaurant-classifications.json` value,
falling back to `facility_type` and then `Unknown`. The source classifications
cover 282 names; that includes the named Unknown records. Source snapshots
remain owned by `vendor/bcdatamapper/datascrapers/food-health/output`.

| Source category | Library records | Spinner candidates | Decision |
| --- | ---: | ---: | --- |
| Restaurant | 174 | 172 | Include except two convenience stores |
| Food Truck | 6 | 6 | Include |
| Coffee Shop | 24 | 23 | Include except nutrition retailer |
| Bar/Pub | 15 | 11 | Include except Legion, nightclubs and show lounge |
| Brewery/Winery | 5 | 5 | Include; food availability needs review |
| Bakery | 16 | 16 | Include as snacks/desserts; includes specialty sellers |
| Deli | 14 | 14 | Include; includes grocery deli counters |
| Stand | 6 | 6 | Include as snacks/seasonal food |
| Concession | 22 | 0 | Costco Food Court is in Other spots |
| Recreation | 27 | 0 | Exclude venue facilities pending review |
| Social Services | 39 | 0 | Exclude meal programs and organizations |
| Community Kitchen | 30 | 0 | Exclude churches, halls and community kitchens |
| Institutional Kitchen | 18 | 0 | Exclude hospitals, care homes and correctional facilities |
| Camp | 15 | 0 | Exclude camp kitchens |
| Gas Station | 15 | 0 | Exclude retail premises |
| Store | 9 | 0 | Exclude retail premises |
| Catering | 7 | 0 | Exclude booking-based services |
| Hotel | 6 | 0 | Exclude accommodation/breakfast facilities |
| Farm | 2 | 0 | Exclude production premises |
| Unknown | 7 | 0 | Exclude until categorized |
| **Total** | **457** | **253** | **204 excluded by default** |

## Other spots

These exact-name entries make up the optional Other spots category for a casual
dining spinner. They do not rewrite a premise's inspection classification or
claim to verify its current service. Ordinary hotel restaurants and
hospital/university coffee shops remain eligible when their own records have a
dining category.

| Premise | Source category | Reason it is optional |
| --- | --- | --- |
| 7-Eleven Food Store #37259 | Restaurant | Convenience store |
| 7-Eleven Food Store #37263 | Restaurant | Convenience store |
| Active Body Nutrition | Coffee Shop | Nutrition retailer |
| Royal Canadian Legion #43 | Bar/Pub | Organization/club |
| Crush Night Club | Bar/Pub | Nightlife venue |
| Ignite Night Club | Bar/Pub | Nightlife venue |
| The Underground Show Lounge and Bar | Bar/Pub | Show lounge |
| Costco Food Court | Concession | Food court inside a retailer |

For example, Evangelical Free Church, St Giles Presbyterian Church and Trinity
United Downtown Church fall under Community Kitchen. PG Civic Centre - CG
60667 falls under Concession. All four are excluded from the spinner.

## Follow-up review

The registry supports establishment categories, **not cuisine categories**.
Cuisine, opening hours, walk-in access and current operation cannot be inferred
reliably from these inspection records. Names and labels offer a first pass,
with the following cases worth checking against business information:

- Recreation records that may contain public dining: Lil Hoppers Playhouse &
  Cafe, PixelPlay Cafe, Treasure Cove Casino Cafe, Alder Hills Golf Course- The
  Lounge and Tee Box Golf Simulators & Lounge Ltd.
- Retail records that may be snack destinations: Fort George Railway Scoop
  Shop. Gas Station also contains Eastway Esso-KFC; review whether that record
  should join Other spots.
- Unknown records: Cook Shack, The; PG Afro Caribbean Enterprise; Rice Bowl;
  Silver Gosling; Sweden Creek Eats; The Muddled Leaf; Walker Camp.
- Restaurant fallback includes Apna Bazaar. Review whether it describes a
  restaurant or a market. Coffee shops such as Degrees Coffee and UNBC-Good
  Earth may have campus access or hours restrictions.
- Bakery includes custom cake sellers, chocolatiers and ice cream. Delis
  include supermarket departments, and brewery/winery records do not establish
  that food is available. Users can deselect these entire categories; a later
  verified dining curation can narrow individual records.

New or renamed premises may lose a name-based classification or Other spots entry.
Review this inventory when the scraper snapshot changes; Unknown and other
non-dining categories stay excluded. Broad source-label mistakes should be
corrected in bcdatamapper, following its commit/push/sync workflow. Spinner-only
eligibility decisions belong in the app's dining rules.
