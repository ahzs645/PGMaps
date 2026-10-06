# The Diverse Prague — imported reference content

The project at `/dev/projects/example-prague` recreates the user-supplied
[The Diverse Prague](https://storymaps.arcgis.com/stories/3ed83ef359d346618510764c6222ac01)
reference from the Institute of Planning and Development (IPR Prague). The story's
native content graph, original wording, captions, author credits, image ordering,
map states, and theme settings are retained. PGMaps supplies its own renderer.

## Reproducible import

```sh
node scripts/import-storymap-har.mjs \
  '/path/to/desktop.har' \
  3ed83ef359d346618510764c6222ac01 \
  public/data/story-documents/prague \
  --fetch-missing
```

The importer works with a selected ArcGIS story item in a user-supplied HAR. It
copies only referenced content and authored Noto Sans fonts, not the original
application's executable JavaScript or general browser traffic. It removes
analytics settings, authentication fields, request/response headers, cookies,
and credential/tracking query parameters. Source archives remain outside this
repository. Documents live outside `public/data/projects`, whose JSON files are
reserved for project package envelopes.

`story.json` contains the 257-node graph, 59 native resources, 15 preserved action records,
and source metadata. Seven action records are referenced by the current inline
text and have a target node; eight stale source records remain in the imported
graph for provenance but are not exposed as usable actions. The manifest
`actionInventory` records both sets. Each image/video resource has a `data.url`; each captured
webmap resource has a `data.webmapUrl`. The theme resource includes the captured
`data.theme` object, with its logo resource resolved locally.

`manifest.json` records clean source URLs, media hashes, dimensions, capture
origin, local URLs and any omissions. There are 40 local media files: 38 story
images, the 14,862,950-byte cover video, and the theme logo. These total
43,449,864 bytes. Six local Noto Sans font files reproduce the authored font.
All 19 referenced webmap definitions are captured in `maps/`.

The HAR contains complete bodies for all visible story media. One uncaptured
social-preview image (`AAJnmUGGc3tkGrlOJ8Hxk.png`) was retrieved from its public
ArcGIS item-resource URL. For images requested by the original viewer in a
resized form, the largest captured response is retained; the manifest records
both original declared dimensions and captured dimensions. Tiny duplicate
thumbnail bodies do not replace full captured responses. The cover video is
accepted only when its byte range covers the complete file.

Map definitions retain their original services, symbology, visible-layer states,
and attribution. The PGMaps MapLibre adapter renders those service layers and
viewpoints without loading the ArcGIS JavaScript SDK. The story stays inside
the PGMaps application shell, with its standard navigation available. Service tiles and feature requests remain live dependencies;
this is not an offline copy of the source mapping services. Source media and
content retain the original publisher's rights and credits. Noto Sans is the
original authored theme font, distributed by Google under the SIL Open Font
License.

## Original service gaps recorded in the capture

The supplied capture already contains failures for three original map services.
It has no successful metadata, tiles, or export images from these services to
recover. The importer derives `manifest.sourceAvailability.unavailableServices`
from referenced service URLs and captured error responses; this is separate from
`omissions`, which records missing imported media or webmap definitions.

| Original service                                             | Captured failure                                              | Affected webmap item IDs                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `ags.cuzk.cz/.../ortofoto_wm/MapServer`                      | HTTP 200 containing ArcGIS error 404, “Service not found”     | `76c6af0d4f9d47979c540a2ebfc40b0f`                                     |
| `gs-pub.praha.eu/.../arch/mapove_podklady_archiv/MapServer`  | HTTP 200 containing ArcGIS error 500, “Service … not started” | `ade8c8c9e4c74a9982e838e76164f139`, `e35362e8bfd74fe0b0009039f418eda6` |
| `gp.iprpraha.cz/.../arch/arch_plan_juttner_1816/ImageServer` | HTTP 404 with no response body                                | `cd71f36d3ad442f79daae02a0bf9a23f`                                     |

The definitions preserve these original service URLs. Current replacement aerial
imagery or a different historical map would change the source material and is
not presented as an exact recovery of these unavailable layers.

## Content audit

A direct comparison with the supplied capture confirms that every one of the
257 node IDs and the root’s 69 ordered children is preserved. All content nodes
retain the original prose, image captions, links, tour stops, map actions, and
closing credits. Three root analytics/publication-management fields were removed.
The requested PGMaps presentation adjustment centers the diversity illustration
sidecar (`n-WQCHkO`, `narrativePanelPosition: "center"`); its seven slides and
content remain intact. Reimporting the source requires reapplying that layout preference.

The wrapper now selects `workspace.document.basemap: "pgmaps"`: PGMaps owns
the theme-aware cartography, with dark paints in `public/map-styles/story-charcoal.json`, using its usual
CARTO/OSM vector tiles. Captured WebMaps remain unmodified; only their basemap is
replaced at render time. Original thematic services and historical imagery remain
external dependencies. Feature geometry loads progressively in bounded parallel
batches; no diversity values or classifications are recomputed.

The app theme now also controls story prose, cards, navigation, and map paint.
Original media keeps its source colors; theme changes preserve reading position
and loaded map data.

## Delivery copies

`story.json` retains every source resource URL and adds `data.deliveryUrl` to
eight JPEG photos and the muted cover video. The browser serves content-hashed
1920-pixel WebP photos and a 1280×720 H.264 video with its MP4 index at the front.
These nine assets total 6,161,486 bytes instead of 37,830,837 (84% less); the video
alone is 1,638,806 bytes instead of 14,862,950. The 40 captured media files and
`manifest.json` remain intact; PNG/SVG diagrams retain their exact source pixels.
Publisher attribution is unchanged.

Regenerate with `node scripts/optimize-story-media.mjs public/data/story-documents/prague`
(requires ffmpeg and ffprobe). `delivery.json` records source/delivery hashes,
sizes, dimensions and the encoding recipe, and matching verified copies are
reused on repeat runs. Ordinary builds serve checked-in copies without encoding.
