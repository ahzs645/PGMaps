# Historical access review — Training · reconstruct block access and bridges

As of: **2010-06-30**.

Historical route candidates describe evidence and network connections. They do not authorize current road use or establish construction purpose, legal access, bridge capacity or engineering suitability.

## Trace settings

- Include roads and structures with unknown timing: no.
- Allow unverified endpoint connections: no.
- Endpoint tolerance: 1 m. Attachment tolerance: 10 m.

## Saved route assertions

### access-history-v1-e3024e679385ca7d

Block: Synthetic block A · harvested 2009–2010. Relationship: **inferred-access**.

Period: 2010-06-30 to 2010-06-30. Length: 1264.0 m.

Settings retained with this assertion: date 2010-06-30; unknown road timing excluded; unverified endpoint connections excluded; endpoint tolerance 1 m; anchor tolerance 10 m.

Roads: history-example-bridge-road, history-example-mainline-west, history-example-spur-a. Structures: history-example-bridge.

Source records: example-closure-notice, example-crossing-register, example-harvest-log, example-road-log.

Recalculation assessment: \{"stale":false,"temporalStatus":"compatible","connectivity":"stored-continuous","reasons":\[\]\}.

- Historical topology only: mapped connectivity does not establish past use, current access or vehicle capacity.
- Junction history-junction-entrance-a is declared on only one eligible road; it connects no other road.
- Junction history-junction-entrance-b is declared on only one eligible road; it connects no other road.
- Rehabilitation costs were explicitly excluded from this path request.
- This is a geometric historical-access candidate, not proof that this route was used or built for this block.
- Vehicle capacity, present condition and current legal access are not established.

### access-history-v1-ed6c14af33a33771

Block: Synthetic block B · harvested 2010–2011. Relationship: **inferred-access**.

Period: 2010-06-30 to 2010-06-30. Length: 1460.6 m.

Settings retained with this assertion: date 2010-06-30; unknown road timing excluded; unverified endpoint connections excluded; endpoint tolerance 1 m; anchor tolerance 10 m.

Roads: history-example-bridge-road, history-example-mainline-east, history-example-mainline-west, history-example-spur-b. Structures: history-example-bridge, history-example-culvert.

Source records: example-closure-notice, example-crossing-register, example-harvest-log, example-road-log.

Recalculation assessment: \{"stale":false,"temporalStatus":"compatible","connectivity":"stored-continuous","reasons":\[\]\}.

- Historical topology only: mapped connectivity does not establish past use, current access or vehicle capacity.
- Junction history-junction-entrance-a is declared on only one eligible road; it connects no other road.
- Junction history-junction-entrance-b is declared on only one eligible road; it connects no other road.
- Rehabilitation costs were explicitly excluded from this path request.
- This is a geometric historical-access candidate, not proof that this route was used or built for this block.
- Vehicle capacity, present condition and current legal access are not established.

## Entrances and outlets

- Synthetic block A entrance (history-example-entrance-a): entrance; [-122.70474013256904, 53.89314762354422]; road history-example-spur-a; block history-example-block-a; sources example-harvest-log.
- Synthetic block B entrance (history-example-entrance-b): entrance; [-122.69863618559665, 53.89179864202527]; road history-example-spur-b; block history-example-block-b; sources example-harvest-log.
- Synthetic established-network outlet (history-example-outlet): outlet; [-122.72, 53.89]; road history-example-mainline-west; block unknown; sources example-road-log.

## Road events

- constructed-history-example-mainline-west: road history-example-mainline-west, constructed, event 1988-06-01 to 1988-06-01, observed 2016-12-31; sources example-road-log; extent history-v1-941d512ef8d86278.
- constructed-history-example-bridge-road: road history-example-bridge-road, constructed, event 1988-06-01 to 1988-06-01, observed 2016-12-31; sources example-road-log; extent history-v1-0eed2b6600601b40.
- constructed-history-example-mainline-east: road history-example-mainline-east, constructed, event 1988-06-01 to 1988-06-01, observed 2016-12-31; sources example-road-log; extent history-v1-d63fb8c7aa1b62ed.
- constructed-history-example-spur-a: road history-example-spur-a, constructed, event 2008-08-01 to 2008-08-01, observed 2016-12-31; sources example-road-log; extent history-v1-aaa3a42f77ca9b7f.
- constructed-history-example-spur-b: road history-example-spur-b, constructed, event 2009-08-01 to 2009-08-01, observed 2016-12-31; sources example-road-log; extent history-v1-518642eb106cb421.
- constructed-history-example-bypass: road history-example-bypass, constructed, event 2016-07-01 to 2016-07-01, observed 2016-12-31; sources example-road-log; extent history-v1-b44c646cbeddd1d8.
- constructed-history-example-overpass: road history-example-overpass, constructed, event 1988-06-01 to 1988-06-01, observed 2016-12-31; sources example-road-log; extent history-v1-3e1643b400c81fca.

## Structures and reported restrictions

### Synthetic shared bridge · closed in 2019 (history-example-bridge)

Type: bridge. Crossing site: SYNTHETIC-SITE-01. Structure: SYNTHETIC-BRIDGE-01. Source row: SYNTHETIC-ROW-01.

Road: history-example-bridge-road; permit/section 009900 / 002; reviewed attachment within 5 m. Construction: 1988-06-01 to 1988-06-01; removal: unknown.

Sources: example-crossing-register, example-closure-notice.

- load-rating: Invented historical rating; not a vehicle authorization.. Reported rating: 60 t; valid 1988-06-01 to 2018-12-31; sources example-crossing-register.
- closure: Invented closure effective 2019-01-01.. Reported rating: unknown; valid 2019-01-01 to unknown; sources example-closure-notice.
- load-rating: Invented inventory still lists 60 t; conflict remains visible.. Reported rating: 60 t; valid 2022-07-01 to unknown; sources example-crossing-register.
- load-rating: Invented closure notice lists zero tonnes.. Reported rating: 0 t; valid 2019-01-01 to unknown; sources example-closure-notice.

### Synthetic spur B culvert (history-example-culvert)

Type: culvert. Crossing site: SYNTHETIC-SITE-02. Structure: SYNTHETIC-CULVERT-01. Source row: SYNTHETIC-ROW-02.

Road: history-example-spur-b; permit/section 009900 / 005; reviewed attachment within 5 m. Construction: 2009-08-01 to 2009-08-01; removal: unknown.

Sources: example-crossing-register.


## Sources

- **example-road-log — Synthetic construction ledger**, record INVENTED-example-road-log (synthetic teaching record). Published 2016-12-31; retrieved 2026-11-08T00:00:00Z. Dates for mainline, spurs and bypass; not permit award dates. Invented for training; not a BC record. https://github.com/ahzs645/PGMaps/blob/main/docs/forestry-road-design/access-history.md
- **example-harvest-log — Synthetic harvest and entrance plan**, record INVENTED-example-harvest-log (synthetic teaching record). Published 2011-04-01; retrieved 2026-11-08T00:00:00Z. Two harvest periods and explicitly located entrances. Invented for training; not a BC record. https://github.com/ahzs645/PGMaps/blob/main/docs/forestry-road-design/access-history.md
- **example-crossing-register — Synthetic crossing register**, record INVENTED-example-crossing-register (synthetic teaching record). Published 2022-07-01; retrieved 2026-11-08T00:00:00Z. Bridge and culvert identities, locations and reported rating. Invented for training; not a BC record. https://github.com/ahzs645/PGMaps/blob/main/docs/forestry-road-design/access-history.md
- **example-closure-notice — Synthetic bridge closure notice**, record INVENTED-example-closure-notice (synthetic teaching record). Published 2019-01-01; retrieved 2026-11-08T00:00:00Z. Bridge closed from 2019; conflicts with the later inventory rating. Invented for training; not a BC record. https://github.com/ahzs645/PGMaps/blob/main/docs/forestry-road-design/access-history.md
- **example-haul-ledger — Synthetic haul ledger**, record INVENTED-example-haul-ledger (synthetic teaching record). Published 2010-07-01; retrieved 2026-11-08T00:00:00Z. Invented route-specific evidence a reviewer can use to demonstrate a documented-use assertion. Invented for training; not a BC record. https://github.com/ahzs645/PGMaps/blob/main/docs/forestry-road-design/access-history.md
