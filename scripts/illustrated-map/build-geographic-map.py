#!/usr/bin/env python3
"""Fit local geographic inputs to the illustrated map's vector artboard.

Requires Shapely and pyproj. Acquisition and full source archives are separate:
this builder only reads supplied WGS84 GeoJSON, projects it, intersects the
region and hatch-coverage areas with the one dry-land geometry, and writes small
app-owned drawing paths. It never reads or traces a reference image.

The region is configuration. Without --region it builds the British Columbia map
exactly as before (EPSG:3005, the Rainforest to Rockies frame, motifs, shields
and checkpoints). With --region region.json, any of these keys replace the BC
values: name, frame {width,height}, viewBounds [west,south,east,north], margin,
footer, epsg, regionKind, coverageKind, roadJurisdiction, compass [x,y],
motifs, trees, shields, checkpoints [[id, lon, lat, isLand]].

The geography GeoJSON holds features whose "kind" is "land", "data-coverage",
the region kind (default "bc") and the coverage kind (default "coastal-style").
The painted hatch is coverage intersected with dry land; lakes are holes in land.

Example:
  python scripts/illustrated-map/build-geographic-map.py \
    --geography geography.geojson --land-provenance land-provenance.json \
    --roads roads.geojson --places anchors.geojson \
    --road-provenance road-provenance.json [--region region.json]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

from pyproj import CRS, Transformer
from shapely import make_valid
from shapely.geometry import Point, box, shape
from shapely.ops import nearest_points, transform, unary_union

ROOT = Path(__file__).resolve().parents[2]
FRAME = {"width": 1536, "height": 1040}
VIEW_BOUNDS = [-129.5, 47.0, -112.5, 54.8]
MARGIN = 18
FOOTER = 36
EPSG = 3005

# Illustration locations are regional design anchors, not recorded observations.
# Their coordinates let the illustrations move with the geographic composition.
MOTIFS = [
    {"id": "bear", "coordinate": [-124.18, 50.75], "scale": 0.9},
    {"id": "birds", "coordinate": [-126.7, 50.7], "scale": 0.82},
    {"id": "fishing-boat", "coordinate": [-124.7, 49.65], "scale": 0.85},
    {"id": "gondola", "coordinate": [-122.95, 50.12], "scale": 0.82, "offset": [-38, -35]},
    {"id": "grove", "coordinate": [-121.65, 49.42], "scale": 0.7, "offset": [-48, -34]},
    {"id": "hiker", "coordinate": [-119.45, 52.2], "scale": 0.8, "offset": [-26, -14]},
    {"id": "waterfall", "coordinate": [-120.1, 52.0], "scale": 0.9, "offset": [-44, -2]},
    {"id": "hot-springs", "coordinate": [-116.2, 50.6], "scale": 0.72, "offset": [-26, 14]},
    {"id": "mountain-range", "coordinate": [-117.5, 51.75], "scale": 0.85, "offset": [-6, -64]},
    {"id": "orca", "coordinate": [-125.55, 48.8], "scale": 0.95},
    {"id": "wine-glasses", "coordinate": [-119.6, 49.92], "scale": 0.7, "offset": [28, -22]},
    {"id": "cyclist", "coordinate": [-118.25, 49.3], "scale": 0.77, "offset": [10, -38]},
    {"id": "wave-coast-north", "coordinate": [-128.4, 52.3], "scale": 0.9},
    {"id": "wave-coast-west", "coordinate": [-127.2, 49.0], "scale": 0.85},
    {"id": "wave-coast-orca", "coordinate": [-124.65, 48.15], "scale": 0.7},
]

TREE_ANCHORS = [
    [-128.1, 53.8], [-126.7, 53.5], [-125.2, 53.1], [-127.1, 52.2],
    [-125.4, 51.6], [-124.4, 51.8], [-125.7, 50.5], [-126.3, 49.85],
    [-125.1, 49.45], [-123.9, 49.2], [-122.9, 51.3], [-122.6, 52.5],
    [-121.3, 52.1], [-120.7, 50.4], [-118.4, 50.15], [-116.8, 49.8],
    [-115.6, 50.05], [-118.9, 53.5], [-124.0, 53.9], [-123.55, 48.75],
]

# These candidates are snapped to the corresponding real road centreline.
SHIELDS = [
    {"id": "shield-1-west", "route": "1", "coordinate": [-121.45, 50.25]},
    {"id": "shield-1-east", "route": "1", "coordinate": [-118.42, 51.03]},
    {"id": "shield-3-west", "route": "3", "coordinate": [-120.57, 49.47]},
    {"id": "shield-3-east", "route": "3", "coordinate": [-115.6, 49.5]},
    {"id": "shield-5-south", "route": "5", "coordinate": [-121.01, 49.9]},
    {"id": "shield-5-north", "route": "5", "coordinate": [-120.05, 51.65]},
    {"id": "shield-99", "route": "99", "coordinate": [-122.73, 50.62]},
]

CHECKPOINTS = [
    ("vancouver-land", -123.12, 49.26, True),
    ("victoria-land", -123.36, 48.42, True),
    ("strait-of-georgia-water", -123.7, 49.2, False),
    ("juan-de-fuca-water", -123.6, 48.2, False),
    ("okanagan-lake-water", -119.48, 50.05, False),
    # Interior of official FWA WATERBODY_POLY_ID 700207584. The first guessed
    # coordinate (-120.75, 50.75) lies outside that polygon, so it is not a
    # defensible lake checkpoint.
    ("kamloops-lake-water", -120.6778579733, 50.7497060812, False),
    ("whistler-land", -122.97, 50.12, True),
    ("calgary-land", -114.07, 51.04, True),
]


REGION_KEYS = {"name", "frame", "viewBounds", "margin", "footer", "epsg", "regionKind", "coverageKind",
               "roadJurisdiction", "compass", "motifs", "trees", "shields", "checkpoints"}


def bc_region():
    """The British Columbia map: the defaults every other region overrides."""
    return {"name": "British Columbia", "frame": FRAME, "viewBounds": VIEW_BOUNDS, "margin": MARGIN,
            "footer": FOOTER, "epsg": EPSG, "regionKind": "bc", "coverageKind": "coastal-style",
            "roadJurisdiction": "BC", "compass": [155, 165], "motifs": MOTIFS, "trees": TREE_ANCHORS,
            "shields": SHIELDS, "checkpoints": [list(c) for c in CHECKPOINTS]}


def load_region(path):
    region = bc_region()
    if not path:
        return region, False
    config, _ = read(path)
    unknown = set(config) - REGION_KEYS
    if unknown:
        raise ValueError(f"Unknown region settings: {', '.join(sorted(unknown))}")
    region.update(config)
    frame = region["frame"]
    if not (frame.get("width", 0) > 0 and frame.get("height", 0) > 0):
        raise ValueError("Region frame needs a positive width and height")
    west, south, east, north = region["viewBounds"]
    if not (west < east and south < north):
        raise ValueError("Region viewBounds must be [west, south, east, north]")
    for checkpoint in region["checkpoints"]:
        if len(checkpoint) != 4 or not isinstance(checkpoint[3], bool):
            raise ValueError(f"Checkpoint must be [id, lon, lat, isLand]: {checkpoint}")
    return region, True


def read(path):
    raw = Path(path).read_bytes()
    return json.loads(raw), hashlib.sha256(raw).hexdigest()


def polygons(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == "Polygon":
        return [geometry]
    if hasattr(geometry, "geoms"):
        return [p for g in geometry.geoms for p in polygons(g)]
    return []


def lines(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == "LineString":
        return [geometry]
    if hasattr(geometry, "geoms"):
        return [line for g in geometry.geoms for line in lines(g)]
    return []


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--geography", required=True)
    parser.add_argument("--land-provenance", required=True)
    parser.add_argument("--roads", required=True)
    parser.add_argument("--places", required=True)
    parser.add_argument("--road-provenance", required=True)
    parser.add_argument("--region", help="JSON of region settings; BC when omitted")
    parser.add_argument("--output", default=str(ROOT / "src/lib/illustratedMap/geography.generated.json"))
    args = parser.parse_args()
    region, configured = load_region(args.region)
    epsg = region["epsg"]
    to_metres = Transformer.from_crs(4326, epsg, always_xy=True)
    to_wgs84 = Transformer.from_crs(epsg, 4326, always_xy=True)
    frame = region["frame"]
    margin, footer = region["margin"], region["footer"]
    geography, geography_hash = read(args.geography)
    roads, roads_hash = read(args.roads)
    places, places_hash = read(args.places)
    land_provenance, _ = read(args.land_provenance)
    road_provenance, _ = read(args.road_provenance)

    west, south, east, north = region["viewBounds"]
    border = []
    for i in range(129):
        f = i / 128
        border.extend([(west + (east - west) * f, south), (west + (east - west) * f, north),
                       (west, south + (north - south) * f), (east, south + (north - south) * f)])
    border = [to_metres.transform(*p) for p in border]
    min_x, min_y = min(p[0] for p in border), min(p[1] for p in border)
    max_x, max_y = max(p[0] for p in border), max(p[1] for p in border)
    scale = min((frame["width"] - margin * 2) / (max_x - min_x),
                (frame["height"] - margin * 2 - footer) / (max_y - min_y))
    left = (frame["width"] - (max_x - min_x) * scale) / 2
    top = margin + (frame["height"] - margin * 2 - footer - (max_y - min_y) * scale) / 2
    drawing_extent = box(min_x - left / scale, max_y - (frame["height"] - footer - top) / scale,
                         min_x + (frame["width"] - left) / scale, max_y + top / scale)

    def xy(point):
        return [round(left + (point[0] - min_x) * scale, 3), round(top + (max_y - point[1]) * scale, 3)]

    def coordinate_xy(coordinate):
        return xy(to_metres.transform(*coordinate[:2]))

    def path_geometry(geometry):
        paths = []
        for polygon in polygons(geometry):
            for ring in [polygon.exterior, *polygon.interiors]:
                points = [xy(p) for p in ring.coords]
                paths.append(" ".join(("M" if i == 0 else "L") + f"{p[0]},{p[1]}" for i, p in enumerate(points)) + " Z")
        if geometry.is_empty:
            bounds = [0, 0, 0, 0]
        else:
            x0, y0, x1, y1 = geometry.bounds
            bounds = [*xy([x0, y1]), *xy([x1, y0])]
        return {"d": " ".join(paths), "bounds": bounds, "polygons": len(polygons(geometry)),
                "holes": sum(len(p.interiors) for p in polygons(geometry)),
                "vertices": sum(len(r.coords) for p in polygons(geometry) for r in [p.exterior, *p.interiors])}

    kinds = {}
    for feature in geography["features"]:
        kind = feature["properties"]["kind"]
        geometry = make_valid(transform(to_metres.transform, shape(feature["geometry"])))
        kinds.setdefault(kind, []).append(geometry)
    kinds = {key: unary_union(value) for key, value in kinds.items()}
    # Check the full drawing frame, including the area beyond the requested
    # geographic view that the uniform fit exposes. Missing source coverage
    # must never silently become ocean in the rendered map.
    source_coverage = kinds["data-coverage"]
    missing_coverage = drawing_extent.difference(source_coverage).area
    if missing_coverage > 1:
        raise ValueError(f"Source land/water coverage misses {missing_coverage:.1f} square metres of the drawing frame")
    for kind in ("land", region["regionKind"], region["coverageKind"]):
        if kind not in kinds:
            raise ValueError(f"The geography has no features of kind {kind!r}")
    land = kinds["land"].intersection(drawing_extent)
    bc_land = land.intersection(kinds[region["regionKind"]])
    coastal = kinds[region["coverageKind"]].intersection(drawing_extent)
    coastal_land = bc_land.intersection(coastal)
    assert land.is_valid and bc_land.is_valid and coastal_land.is_valid
    assert not land.is_empty and not bc_land.is_empty and not coastal_land.is_empty

    route_drawings, route_geometries = [], {}
    for feature in roads["features"]:
        properties = feature["properties"]
        geometry = transform(to_metres.transform, shape(feature["geometry"]))
        route = str(properties["route"])
        if properties.get("jurisdiction") == region["roadJurisdiction"]:
            route_geometries.setdefault(route, []).append(geometry)
        paths = []
        for line in lines(geometry.intersection(drawing_extent)):
            points = [xy(p) for p in line.coords]
            paths.append(" ".join(("M" if i == 0 else "L") + f"{p[0]},{p[1]}" for i, p in enumerate(points)))
        if paths:
            route_drawings.append({"id": properties["id"], "route": route,
                                   "jurisdiction": properties.get("jurisdiction", ""),
                                   "role": properties.get("role", "primary"), "d": " ".join(paths)})
    route_geometries = {key: unary_union(parts) for key, parts in route_geometries.items()}
    assert route_drawings

    anchors = []
    for feature in places["features"]:
        properties = feature["properties"]
        coordinate = feature["geometry"]["coordinates"]
        anchors.append({**properties, "coordinate": coordinate, "point": coordinate_xy(coordinate)})
    motifs = [{"offset": [0, 0], **m, "point": coordinate_xy(m["coordinate"])} for m in region["motifs"]]
    tree_anchors = []
    for i, coordinate in enumerate(region["trees"]):
        point = Point(to_metres.transform(*coordinate))
        if bc_land.covers(point):
            tree_anchors.append({"id": f"geo-tree-{i + 1}", "coordinate": coordinate,
                                 "point": xy(point.coords[0]), "phase": round(i * 0.73, 3),
                                 "moss": i % 4 == 1})
    shields = []
    for shield in region["shields"]:
        if shield["route"] not in route_geometries:
            raise ValueError(f"No {region['roadJurisdiction']} road geometry for shield {shield['id']}")
        candidate = Point(to_metres.transform(*shield["coordinate"]))
        snapped = nearest_points(candidate, route_geometries[shield["route"]])[1]
        if candidate.distance(snapped) > 50000:
            raise ValueError(f"Shield too far from its route: {shield['id']}")
        shields.append({"id": shield["id"], "route": shield["route"], "point": xy(snapped.coords[0]),
                        "coordinate": list(to_wgs84.transform(*snapped.coords[0])),
                        "snapDistanceMetres": round(candidate.distance(snapped), 1)})

    checkpoints = []
    for name, lon, lat, expected in region["checkpoints"]:
        point = Point(to_metres.transform(lon, lat))
        actual = land.covers(point)
        if actual != expected:
            raise ValueError(f"Land/water checkpoint disagrees: {name}: {actual}")
        checkpoints.append({"id": name, "coordinate": [lon, lat], "point": xy(point.coords[0]), "land": expected})

    compass_x, compass_y = region["compass"]
    compass_xy = [min_x + (compass_x - left) / scale, max_y - (compass_y - top) / scale]
    compass_coordinate = to_wgs84.transform(*compass_xy)
    compass_north = to_metres.transform(compass_coordinate[0], compass_coordinate[1] + 0.01)
    north_rotation = math.degrees(math.atan2(compass_north[0] - compass_xy[0], compass_north[1] - compass_xy[1]))
    projection_name = "NAD83 / BC Albers" if epsg == 3005 else CRS.from_epsg(epsg).name
    result = {
        "version": 1,
        "artboard": frame,
        "projection": {"name": projection_name, "epsg": epsg, "sourceEpsg": 4326,
                       "requestedBoundsWgs84": region["viewBounds"], "boundsMetres": [min_x, min_y, max_x, max_y],
                       "drawingExtentMetres": list(drawing_extent.bounds),
                       "sourceCoverageMissingSquareMetres": round(missing_coverage, 6),
                       "scale": scale, "left": left, "top": top, "footer": footer,
                       "northArrowReferenceCoordinate": compass_coordinate,
                       "northArrowRotationDegrees": north_rotation},
        "land": path_geometry(land), "bcLand": path_geometry(bc_land),
        "coastalCoverage": path_geometry(coastal), "coastalLand": path_geometry(coastal_land),
        "roads": route_drawings, "places": anchors, "motifs": motifs, "trees": tree_anchors,
        "shields": shields, "checkpoints": checkpoints,
        "provenance": {"land": land_provenance, "roads": road_provenance,
                       "inputSha256": {"geography": geography_hash, "roads": roads_hash, "places": places_hash},
                       "construction": f"Project source geometry once to EPSG:{epsg}; use one uniform scale for every feature. Province regions and decorative coverage are intersected with one shared dry-land geometry. No coastal inset or white shore stroke.",
                       "motifPlacement": "Decorative regional motifs, not recorded observations or inventories. Route badges are snapped to the corresponding real centreline.",
                       "pathRoundingDrawingUnits": 0.001},
    }
    if configured:
        # Only a configured region records itself, so the BC output stays byte-identical.
        result["region"] = {"name": region["name"], "regionKind": region["regionKind"],
                            "coverageKind": region["coverageKind"]}
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, separators=(",", ":"), ensure_ascii=False) + "\n")
    print(json.dumps({"output": str(output), "bytes": output.stat().st_size,
                      "landPolygons": result["land"]["polygons"], "landHoles": result["land"]["holes"],
                      "roads": len(route_drawings), "places": len(anchors), "shields": len(shields),
                      "checkpoints": len(checkpoints)}))


if __name__ == "__main__":
    main()
