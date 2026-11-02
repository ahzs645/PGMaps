#!/usr/bin/env python3
"""Offline, pinned cartographic adaptation for the BEC protected-area story.

Install preparation dependencies: pip install shapely==2.1.2 pyproj==3.7.2
Run: python scripts/prepare-bec-story-geometry.py /path/to/bec-v13-1-open-map-generalized-100m.geojson

This command makes no network requests. The corporate source stays outside the
application repository. Only the compressed, authored story map is deployed.
"""
import argparse
import gzip
import hashlib
import json
from collections import defaultdict
from pathlib import Path

import pyproj
import shapely
from shapely.geometry import MultiPolygon, mapping, shape
from shapely.ops import transform

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "public/data/bec-representation"
INPUT_SHA256 = "4c9ca76bb62f330aea319480c077e003926512d783adbd74821d1378f2deb80f"
TOLERANCE_METERS = 750
MAX_AREA_CHANGE_PERCENT = 5


def digest(data):
    return hashlib.sha256(data).hexdigest()


def polygon_parts(geometry):
    if geometry.geom_type == "Polygon":
        return [geometry]
    if geometry.geom_type in ("MultiPolygon", "GeometryCollection"):
        return [polygon for part in geometry.geoms for polygon in polygon_parts(part)]
    # make_valid can also return zero-area lines/points from collapsed rings.
    return []


def polygonal(geometry):
    parts = polygon_parts(geometry)
    if not parts:
        raise ValueError("A BEC code lost all polygon area")
    result = shapely.union_all(parts)
    if result.geom_type == "Polygon":
        result = MultiPolygon([result])
    if result.geom_type != "MultiPolygon" or not result.is_valid or result.is_empty:
        raise ValueError("Invalid or empty polygon after geometric normalization")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Exact acquired corporate source; SHA-256 is checked")
    parser.add_argument("--raw-output", type=Path, help="Optional uncompressed preview outside the repository")
    args = parser.parse_args()
    if shapely.__version__ != "2.1.2" or pyproj.__version__ != "3.7.2":
        raise ValueError("Use pinned preparation dependencies: shapely==2.1.2 pyproj==3.7.2")
    raw = args.input.read_bytes()
    if digest(raw) != INPUT_SHA256:
        raise ValueError("Input does not match the pinned BEC v13.1 acquisition")
    source = json.loads(raw)
    if source.get("crs", {}).get("properties", {}).get("name") != "EPSG:3005" or len(source.get("features", [])) != 17870:
        raise ValueError("Expected all 17,870 source polygons in BC Albers")
    study = json.loads((TARGET / "representation.json").read_text())
    study_codes = {unit["code"] for unit in study["units"]}
    groups = defaultdict(list)
    code_metadata = {}
    object_ids = set()
    repaired_source_polygons = 0
    for feature in source["features"]:
        properties = feature["properties"]
        code = properties["MAP_LABEL"].translate(str.maketrans("", "", " \t\n\r"))
        if not code or not properties["ZONE"] or not properties["ZONE_NAME"]:
            raise ValueError("Missing code/zone/name in source")
        if properties["OBJECTID"] in object_ids:
            raise ValueError("Duplicate source OBJECTID")
        object_ids.add(properties["OBJECTID"])
        metadata = {"zone": properties["ZONE"], "zoneName": properties["ZONE_NAME"]}
        if code in code_metadata and code_metadata[code] != metadata:
            raise ValueError(f"Conflicting zone attribution for {code}")
        code_metadata[code] = metadata
        geometry = shape(feature["geometry"])
        if not geometry.is_valid:
            repaired_source_polygons += 1
            geometry = shapely.make_valid(geometry)
        groups[code].extend(polygon_parts(geometry))

    to_wgs84 = pyproj.Transformer.from_crs(3005, 4326, always_xy=True).transform
    to_albers = pyproj.Transformer.from_crs(4326, 3005, always_xy=True).transform
    features = []
    diagnostics = []
    for code, polygons in sorted(groups.items()):
        original = polygonal(shapely.union_all(polygons))
        # Narrow parkland and woodland polygons need a smaller tolerance than
        # large regional units. Bound area distortion of this display relative
        # to the acquired shape; never use this QA as a study area calculation.
        for tolerance in [TOLERANCE_METERS / 2**step for step in range(7)] + [0]:
            simplified = original.simplify(tolerance, preserve_topology=True)
            # GEOS valid-output precision reduction preserves valid output;
            # tiny collapsed non-area pieces may disappear, never a whole code.
            display = polygonal(shapely.set_precision(transform(to_wgs84, simplified), 0.00001, mode="valid_output"))
            display = shapely.normalize(display)
            display_albers = transform(to_albers, display)
            area_change_pct = (display_albers.area / original.area - 1) * 100
            if abs(area_change_pct) <= MAX_AREA_CHANGE_PERCENT:
                break
        else:
            raise ValueError(f"Unable to meet the cartographic area tolerance for {code}")
        if not display.is_valid or display.is_empty:
            raise ValueError(f"Invalid output for {code}")
        if not (-142 < display.bounds[0] < display.bounds[2] < -113 and 47 < display.bounds[1] < display.bounds[3] < 61):
            raise ValueError(f"Coordinates outside B.C. context for {code}")
        bbox_change = max(abs(a - b) for a, b in zip(display_albers.bounds, original.bounds))
        diagnostics.append({
            "code": code,
            "simplificationMeters": tolerance,
            "sourceAreaSqKm": round(original.area / 1e6, 6),
            "displayAreaSqKm": round(display_albers.area / 1e6, 6),
            "areaChangePercent": round(area_change_pct, 6),
            "maxExtentChangeMeters": round(bbox_change, 3),
            "sourcePolygonParts": len(original.geoms),
            "displayPolygonParts": len(display.geoms),
            "sourceCoordinateCount": int(shapely.get_num_coordinates(original)),
            "displayCoordinateCount": int(shapely.get_num_coordinates(display)),
        })
        metadata = code_metadata[code]
        details = (
            "BEC v13.1 boundary context (July 2026). The 2023 study attributes load separately; this is not the original BEC v12 analysis geometry."
            if code in study_codes else
            "BEC v13.1 boundary context (July 2026). This exact code has no row in the 2023 study. No historical percentage is assigned and no split or renamed unit is inferred."
        )
        coordinates = mapping(display)["coordinates"]
        # Emit short decimal numbers; validity was checked at the same precision.
        coordinates = [[[[round(x, 5), round(y, 5)] for x, y in ring] for ring in polygon] for polygon in coordinates]
        emitted = shape({"type": "MultiPolygon", "coordinates": coordinates})
        if not emitted.is_valid or emitted.is_empty:
            raise ValueError(f"Invalid emitted coordinates for {code}")
        features.append({
            "type": "Feature",
            "id": code,
            "properties": {
                "code": code,
                **metadata,
                "display": f"{code} · 2026 BEC boundary context",
                "title": f"{code} · {metadata['zoneName']}",
                "details": details,
                "representationClass": "not-in-study",
                "representationLabel": "Current code absent from 2023 study",
            },
            "geometry": {"type": "MultiPolygon", "coordinates": coordinates},
        })
        print(f"Prepared {len(features)}/{len(groups)}: {code}", flush=True)

    data = (json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":"), ensure_ascii=False) + "\n").encode()
    compressed = gzip.compress(data, compresslevel=9, mtime=0)
    (TARGET / "bec-units.geojson.gz").write_bytes(compressed)
    if args.raw_output:
        args.raw_output.parent.mkdir(parents=True, exist_ok=True)
        args.raw_output.write_bytes(data)
    current_codes = {feature["properties"]["code"] for feature in features}
    missing_study_codes = sorted(study_codes - current_codes)
    current_codes_without_study = sorted(current_codes - study_codes)
    provenance = {
        "schema": "bec-story-geometry-v1",
        "purpose": "Cartographic context for an authored story; not for area calculation or boundary decisions.",
        "attribution": "Contains information licensed under the Open Government Licence – British Columbia.",
        "source": {
            "title": "BEC Map",
            "organization": "Province of British Columbia",
            "catalogueId": "f358a53b-ffde-4830-a325-a5a03ff672c3",
            "catalogueUrl": "https://catalogue.data.gov.bc.ca/dataset/f358a53b-ffde-4830-a325-a5a03ff672c3",
            "featureClass": "WHSE_FOREST_VEGETATION.BEC_BIOGEOCLIMATIC_POLY",
            "serviceUrl": "https://maps.gov.bc.ca/arcgis/rest/services/whse/bcgw_pub_whse_forest_vegetation/MapServer/21",
            "version": "13.1",
            "publishedDate": "2026-07-08",
            "acquiredDate": "2026-11-02",
            "license": "Open Government Licence - British Columbia",
            "licenseUrl": "https://www2.gov.bc.ca/gov/content?id=A519A56BC2BF44E4A008B33FCF527F61",
            "rawSha256": INPUT_SHA256,
            "rawBytes": len(raw),
            "polygonCount": len(source["features"]),
            "acquisition": {
                "idsQuery": "query?where=1%3D1&returnIdsOnly=true&f=json",
                "pageSize": 500,
                "pageOrder": "Ascending OBJECTID; exact requested ID set checked on each page",
                "query": {"outFields": "OBJECTID,MAP_LABEL,ZONE,ZONE_NAME", "outSR": 3005, "maxAllowableOffset": 100, "returnGeometry": True, "f": "geojson"},
                "assembly": "FeatureCollection in EPSG:3005; pages in ascending OBJECTID order; compact Python JSON serialization.",
            },
        },
        "geometry": {
            "asset": "/data/bec-representation/bec-units.geojson.gz",
            "featureCount": len(features),
            "bytes": len(data),
            "sha256": digest(data),
            "compressedBytes": len(compressed),
            "compressedSha256": digest(compressed),
            "coordinateSystem": "EPSG:4326",
            "sourceGeneralizationMeters": 100,
            "sourcePolygonRepairs": repaired_source_polygons,
            "dissolve": "Make valid if needed, discard non-area line/point residues, union by exact MAP_LABEL with ASCII whitespace removed.",
            "displaySimplificationMeters": TOLERANCE_METERS,
            "displaySimplificationRule": "Start at 750 m, then halve per code until the final display area differs by at most 5% from repaired, dissolved acquired geometry; this is cartographic QA only.",
            "maxAreaChangePercentLimit": MAX_AREA_CHANGE_PERCENT,
            "topology": "GEOS topology-preserving simplification per dissolved code; valid-output precision reduction; all 222 emitted geometries are nonempty and valid. Shared boundaries between different codes are not an analytical coverage.",
            "coordinateDecimalPlaces": 5,
            "displayCoordinateCount": sum(row["displayCoordinateCount"] for row in diagnostics),
            "maxAbsoluteAreaChangePercent": max(abs(row["areaChangePercent"]) for row in diagnostics),
            "maxExtentChangeMeters": max(row["maxExtentChangeMeters"] for row in diagnostics),
            "dependencies": {"shapely": shapely.__version__, "GEOS": shapely.geos_version_string, "pyproj": pyproj.__version__, "PROJ": pyproj.proj_version_str},
            "analyticUse": False,
        },
        "crosswalk": {
            "method": "Exact BEC code match only; no aliases, successor aggregation or inferred assignments.",
            "studyBoundaryVersion": "12",
            "displayBoundaryVersion": "13.1",
            "studyUnitCount": len(study_codes),
            "currentUnitCount": len(current_codes),
            "matchedStudyUnitCount": len(study_codes & current_codes),
            "missingStudyCodes": missing_study_codes,
            "currentCodesWithoutStudy": current_codes_without_study,
        },
        "limitations": [
            "The original study does not publish its BEC v12 analysis geometry; v13.1 shapes are contextual only.",
            "Revisions to BEC boundaries and definitions are not evidence of ecosystems physically moving over time.",
            "The source deliberately extends across oceans, lakes and glaciers; no terrestrial mask was added to this display.",
            "The map is generalized for regional viewing (maximum zoom 9), not local boundary interpretation.",
            "Do not use the display or its cartographic diagnostics to recalculate the 2023 study areas or percentages.",
            "Study units absent from v13.1 remain in the table; current codes without a study row have no historical percentage.",
            "The Access Only official 1:250,000 generalized service is not redistributed; this derives from the separately openly licensed BEC Map.",
        ],
        "cartographicDiagnostics": {
            "purpose": "Geometry preparation checks only. These are not the study's protected areas or percentages.",
            "areaReference": "Repaired, dissolved acquired geometry in EPSG:3005; includes the corporate overwater extensions.",
            "units": diagnostics,
        },
    }
    (TARGET / "geometry-provenance.json").write_text(json.dumps(provenance, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({"features": len(features), "bytes": len(data), "compressedBytes": len(compressed), "vertices": provenance["geometry"]["displayCoordinateCount"], "crosswalk": provenance["crosswalk"]}, indent=2))


if __name__ == "__main__":
    main()
