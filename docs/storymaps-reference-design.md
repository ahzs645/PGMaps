# StoryMaps reference design

The user supplied a desktop network capture of [The Diverse Prague](https://storymaps.arcgis.com/stories/3ed83ef359d346618510764c6222ac01), published by the Institute of Planning and Development (IPR Prague). Its authored story configuration is the evidence for the patterns below. The accompanying mobile capture was empty.

This document first records the reference patterns used for the BC style examples. Following the user’s request to recreate the actual story, `example-prague` imports the supplied content and credited media into `public/data/story-documents/prague`. The original publisher retains authorship; PGMaps supplies the renderer. The capture, account metadata, analytics and original application code are not included.

## What the reference contains

The reference is a continuous editorial document. It combines a full-screen video cover, chapter navigation, text, wide images, immersive maps, tours and credits in one reading sequence.

| Captured configuration | Evidence |
| --- | --- |
| Cover | Full cover; video media; title at the end of the cover; summary and byline |
| Chapter navigation | Seven visible links to headings and credits |
| Docked sidecar | Seven slides with the narrative on the left at medium width |
| Docked comparison sidecar | Four slides with the narrative on the right at large width; each compares two webmaps with a swipe divider |
| Floating sidecar | Seven slides with a floating narrative panel; fade transitions |
| Guided map tours | Four map-focused tours with 4, 6, 3 and 2 numbered stops; left narrative panel; accompanying images and text |
| Inline map actions | Seven visible actions that change map viewpoints and visible layers; the stored graph also contains eight stale action records |
| Editorial media | Wide images, text blocks, separators and closing attribution |
| Theme | Black background, white Noto Sans, bold headings, underlined links and full-width separators |

These are authored settings. A network capture does not establish exact rendered dimensions, every gesture, keyboard behavior or mobile layout. Mobile adaptation and accessibility must be verified in PGMaps itself.

## Reusable PGMaps presentation

The source patterns map to declarative story options and scenes. Source fetching, attribution, camera fitting, layer overrides and source errors remain the responsibility of the existing story renderer.

| Pattern | PGMaps feature and example |
| --- | --- |
| Narrative beside a persistent map | Docked sidecar; `example-sidecar-docked` |
| Narrative floating over a large map | Floating sidecar; `example-sidecar-floating` |
| Explicit step-by-step movement | Slideshow sidecar; `example-sidecar-slideshow` |
| Multiple compositions in one reading sequence | Mixed sidecar; `example-sidecar-mixed` |
| Cover and chapter navigation | Shared sidecar cover and chapter controls, authored in the package |
| Reader-requested map changes | Scene `mapActions`, changing layers and camera within the current chapter |
| Genuine map-versus-map reveal | Scene comparison using `StoryComparison.tsx`; synchronized cameras and separately authored left/right layer sets |

The slideshow is an additional PGMaps presentation of this content; it was not one of the three sidecar subtypes found in the capture. The BC sidecar examples do not contain numbered photo tours or video covers. The separate `example-prague` document reconstruction includes these original blocks and publisher credits. Consult [the story contract](project-map-stories.md) for the exact fields supported by the current renderer.

## Comparison behavior

`StoryComparison.tsx` keeps the primary map mounted for both ordinary and comparison scenes. A comparison mounts one additional passive map with the same container size, basemap and camera. A clip reveals its right side; the divider changes the clip rather than resizing either map, which preserves geographic alignment.

The primary map owns pan, zoom and camera transitions. The passive map mirrors position, zoom, bearing, pitch, roll and padding, including resize and the zoom floor adjusted by scene fitting. It reuses already-loaded GeoJSON collections from the story source store. Polygon and point GeoJSON plus polygon PMTiles are supported; native climate-grid comparison is not supported.

A keyboard-operable range input and **Show left**, **Both** and **Show right** buttons provide alternatives to dragging. Layer names remain visible. Comparison scenes suppress underlying feature selection because the passive right map does not own picking. Event listeners and pending attachment frames are released when comparison ends.

## Verification expectations

- Use the same BC content when comparing presentation variants so layout differences are visible without changing the subject.
- Check desktop and phone layouts independently; the supplied capture provides no mobile evidence.
- Verify navigation in both directions, camera alignment during pan and resize, divider endpoints, keyboard controls and return from comparison to ordinary scenes.
- Preserve the existing panel, scrolly and slides layouts, including their map instance, pointer ownership and pane-sizing invariants.
- Inspect sources, loading errors, attribution and reduced-motion behavior along with visual appearance.


## Original-document reconstruction

Open `/dev/projects/example-prague` for the actual Prague content: 257 nodes,
59 resources, 18 immersive slides, four comparisons, four tours with 15 stops,
and seven visible inline actions (15 stored action records, including eight stale records). Forty media assets, six fonts and 19 map definitions are
local. PGMaps renders maps with its existing MapLibre stack. A source adapter
translates captured WebMap layer definitions and viewpoints into MapLibre
sources, layers and cameras. Original service-rendered cartography preserves
the publisher’s symbols; no ArcGIS JavaScript SDK is loaded.

The initial source audit loaded 15 of 19 map definitions without layer errors. Four map
definitions reference three unavailable original services: `ortofoto_wm`
(service not found), `arch_plan_juttner_1816` (HTTP 404), and
`mapove_podklady_archiv` (service not started). The supplied HAR records those
same failures and contains no successful imagery for them. These maps retain
their original references and show source errors, rather than substituting
different imagery. The missing layers cannot be recreated from this capture.

The replica is a native reconstruction, not a byte-for-byte copy of the original
application. It preserves original document content and presentation patterns;
it keeps the PGMaps header and project navigation, with accessible
playback/expansion controls. Its reading area contains the original content
and responsive compositions. Covers, chapter navigation, media, sidecars,
tours and map comparisons are reusable presentation components.
The separately documented `workspace.document` option and import script make
this content adapter reusable for future supplied story documents.

## Content preservation audit

The imported graph was compared directly with the supplied `desktop.har`. All
257 original node IDs are present. The original content is retained, including
118 text nodes, 36 image nodes, 15 carousels, 18 immersive slides, four tours
and four comparisons. The root retains all 69 children in the original order.
Three root analytics/publication-management fields were removed:
`gaid`, `gaConsentMessage`, and `shouldPushMetaToAGOItemDetails`. Media paths are
resolved locally in resources, without rewriting the narrative or captions. The
requested PGMaps layout adjustment centers the diversity illustration sidecar
(`n-WQCHkO`) using `narrativePanelPosition: "center"`.

The PGMaps application header is outside the document and is intentionally
retained. Publisher identity remains in the original cover byline, content and
credits; it does not replace PGMaps branding or navigation.
