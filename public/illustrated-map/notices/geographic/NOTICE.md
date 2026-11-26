# Geographic illustration source notices

Prepared 25 November 2026 (Vancouver time) for PGMaps' Rainforest to Rockies geographic illustration. Source-retrieval dates are UTC. These notices identify the geographic datasets used in the map and the changes made for display. The sources have separate terms; no single CC, OGL or other blanket licence is asserted over all of them.

## GSHHG coastline and original inland-water hierarchy

Coastlines and inland-water geometry adapted from **GSHHG version 2.3.7**, Paul Wessel (University of Hawaii) and Walter H. F. Smith (NOAA), released **15 June 2017**, under **GNU Lesser General Public License version 3 or later**.

Source: <https://www.soest.hawaii.edu/pwessel/gshhg/>

Release: <https://www.soest.hawaii.edu/pwessel/gshhg/gshhg-shp-2.3.7.zip>

The regional geometry was clipped, projected, repaired and generalized for display. Its marine footprint comes from GSHHG. Within BC, selected official Freshwater Atlas waters replace overlapping older inland-water geometry; source islands and water holes are preserved through shared topology. After nominal 125 m generalization, exact source land/water topology was restored locally around 75 narrow-channel islands that cleanup had merged. The modified regional geometry remains editable, and the preparation method and source hashes accompany the map's provenance.

The following files are included unchanged:

- `GSHHG-LICENSE.TXT` - the release's licence and permission notice.
- `GSHHG-COPYING.LESSERv3` - the release's LGPL version 3 text.
- `GSHHG-README.TXT` - the release's readme and source context.
- `GPL-3.0.txt` - the standard GPL version 3 text, supplied because LGPL version 3 incorporates its terms. This copy comes from the system's standard common-licences distribution; the downloaded shapefile release did not contain the referenced GPL text.

The GSHHG-prefixed files are exact byte copies from the downloaded release. The full source archive is not embedded in the app.

## Statistics Canada digital boundaries

**Adapted from Statistics Canada, 2021 Census Digital Boundary Files, provinces and territories, reference date 1 January 2021. Contains information licensed under the Open Government Licence – Canada.**

Source service: <https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Digital_boundary_files/MapServer/0>

Terms: **Open Government Licence - Canada** - <https://open.canada.ca/en/open-government-licence-canada>

The exact acquired service declares this licence in its `licenseInfo` and descriptive metadata: <https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Digital_boundary_files/MapServer/info/iteminfo>. This source-specific declaration is used rather than substituting a general Statistics Canada website licence. The adapted map does not imply Statistics Canada endorsement.

The selected regional province geometries are projected and jointly simplified at 125 m, then intersected with the common geographic dry-land geometry. Digital province boundaries are not used as a second coastline. The US contextual fill is a regional complement, not a complete national administrative dataset.

## Canadian roads and geographical names

**Contains information licensed under the Open Government Licence – Canada.**

Terms: <https://open.canada.ca/en/open-government-licence-canada>

- Statistics Canada, National Road Network - NRN - GeoBase Series: <https://open.canada.ca/data/en/dataset/3d282116-e556-400c-9306-ca1a3cada77f>
- Natural Resources Canada, Canadian Geographical Names: <https://open.canada.ca/data/en/dataset/e27c6eba-3c5d-4051-9db2-082dc6411c2c>

The NRN subset retains selected numbered through-road geometry, omits explicitly classified ramps/service lanes, and is simplified at 75 m with source segment endpoints preserved. Only exact shared endpoints are merged. Official generalized place coordinates are retained and are not moved onto highways. Neither source is presented as live road status or a navigation service.

## British Columbia inland waters and coastal styling

**Contains information licensed under the Open Government Licence – British Columbia.**

Terms: <https://www2.gov.bc.ca/gov/content/data/policy-standards/data-policies/open-data/open-government-licence-bc>

- Freshwater Atlas - Lakes: <https://catalogue.data.gov.bc.ca/dataset/cb1e3aba-d3fe-4de1-a2d4-b8b6650fb1f6>
- Freshwater Atlas - Manmade Waterbodies: <https://catalogue.data.gov.bc.ca/dataset/055fd71e-b771-4d47-a863-8a54f91a954c>
- BEC Map, version 13.1: <https://catalogue.data.gov.bc.ca/dataset/f358a53b-ffde-4830-a325-a5a03ff672c3>

Freshwater Atlas source waterbody polygons are selected by `AREA_HA >= 100` within a bounded regional query, preserving their interior rings. They are integrated into the shared 125 m land/water generalization. This is not a complete inventory of all small waters. Catalogue modification dates are not represented as survey or geometry dates.

The coastal style extent derives from the CWH, MH and CDF BEC display regions. It is generalized, fills small style exclusions, and extends offshore before being clipped by the common land mask. It is a decorative coverage region, not a current forest inventory or precise ecological boundary.

## Washington State Department of Transportation

**Source and credit: Washington State Department of Transportation.**

State Routes of Washington State 1:24,000 (2025), Unrouted Lines. Snapshot effective **31 December 2025**; metadata publication **27 April 2026**.

Source and full terms: <https://data.wsdot.wa.gov/geospatial/DOT_TDO/LRS/24kLRS.htm>

Service: <https://data.wsdot.wa.gov/arcgis/rest/services/Shared/LRSData/MapServer/4>

The source metadata lists no access constraints and supplies WSDOT's disclaimer concerning liability, consequential loss and fitness for a particular purpose. Positional accuracy is stated as not determined. No CC, OGL or public-domain licence is inferred from the dataset being publicly downloadable.

The map uses mainline route identifier `005`, including both carriageway directions, clipped to the border-through-Seattle study extent and simplified at 75 m while preserving segment endpoints. A small mismatch at the Canadian source boundary is retained rather than joined artificially. Seattle's point is not connected by a fabricated spur.

## United States Census Bureau

**Source: US Census Bureau, 2025 Gazetteer Files, Washington places, Seattle city (GEOID 5363000).**

Documentation: <https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.2025.html>

Source file: <https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_gaz_place_53.txt>

Suggested source citation, following the Census Bureau's geographic-data guidance:

U.S. Census Bureau, “2025_gaz_place_53.txt,” 2025 Gazetteer Files, Places: Washington, 2025, <https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_gaz_place_53.txt>, accessed November 26, 2026.

The map retains the published Seattle incorporated-place internal point, longitude -122.351538 and latitude 47.619335. It is a representative place point, not a downtown address or a sourced road junction.

The Census Bureau's _Research Transparency and Public Access_ policy, DS027, page 9, describes data and works produced by its employees as generally having no copyright protection within the United States. The policy also notes possible foreign-country protection and rights in some nonemployee works. No Gazetteer-specific worldwide public-domain dedication or CC0 status is asserted here.

Official policy: <https://www2.census.gov/foia/ds_policies/ds027.pdf> (signed 9 December 2024).

Official citation guidance: <https://www.census.gov/about/policies/citation.html>

## Included licence text copies

`OGL-CANADA-2.0.txt` and `OGL-BC-2.0.txt` contain complete text from the current official canonical licence pages, retrieved on 26 November 2026, with surrounding site navigation removed. Wording is preserved. Federal page modification: 2 December 2022; BC page update: 11 April 2025. Canonical links above remain authoritative. `source-manifest.json` records these notices' hashes and source URLs.

## Drawing provenance

These data notices concern the geographic sources. The supplied page 8 raster is used for visual comparison; it is not used to extract geographic contours. Scene motifs, tree constructions, shield numerals and hatching are authored editable vectors. Place lettering is assembled from the supplied Great Forest font glyphs. The title is a reconstructed study. Drawing and typography details are documented separately in `docs/illustrated-map-reconstruction.md` and `docs/illustrated-map-geographic.md`.
