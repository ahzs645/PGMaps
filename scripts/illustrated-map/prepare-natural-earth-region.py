#!/usr/bin/env python3
"""Prepare a region's inputs for build-geographic-map.py from Natural Earth (public domain).

Requires Shapely and pyproj. Reads Natural Earth 1:10m GeoJSON files you have downloaded
(https://github.com/nvkelso/natural-earth-vector, geojson/) and writes, into --out:

  geography.geojson   kinds: data-coverage (the bounds), land (land and minor islands, lakes cut
                      out), region (the land kept as the illustrated region), coastal-style (dry
                      land within --coast-km of the sea: a decorative coverage, not an inventory)
  roads.geojson       roads whose label matches --road-labels, with route, role and jurisdiction
  places.geojson      populated places, with a stable id, name and coordinate
  land-provenance.json, road-provenance.json   sources, SHA-256 of each input, edition, licence

It never fetches anything. Natural Earth is in the public domain; credit is appreciated, not
required. Its 1:10m data is generalised: small lakes and islands are missing at this scale.

Example (New Zealand's South Island):
  python scripts/illustrated-map/prepare-natural-earth-region.py --ne-dir ~/natural-earth \\
    --bounds 165.8,-47.6,175.2,-40.2 --exclude 174.4,-41.75,176.5,-39.5 --epsg 2193 \\
    --coast-km 25 --road-labels 'SH1,SH6,SH8,SH73,SH94,SH7' --primary-roads SH1,SH6 \\
    --jurisdiction NZ --out /tmp/south-island
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import box, mapping, shape
from shapely.ops import transform, unary_union

LAYERS = {
    "land": "ne_10m_land.geojson",
    "minor-islands": "ne_10m_minor_islands.geojson",
    "lakes": "ne_10m_lakes.geojson",
    "roads": "ne_10m_roads.geojson",
    "places": "ne_10m_populated_places_simple.geojson",
}


def read(path: Path):
    raw = path.read_bytes()
    return json.loads(raw), hashlib.sha256(raw).hexdigest()


def numbers(text: str) -> list[float]:
    return [float(value) for value in text.split(",")]


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--ne-dir", required=True, help="Folder holding the Natural Earth GeoJSON files")
    parser.add_argument("--bounds", required=True, help="west,south,east,north of the data to keep")
    parser.add_argument("--exclude", action="append", default=[],
                        help="west,south,east,north: land parts whose interior point falls here leave the region")
    parser.add_argument("--epsg", type=int, required=True, help="A projected CRS in metres, for the coast buffer")
    parser.add_argument("--coast-km", type=float, default=25)
    parser.add_argument("--road-labels", default="", help="Comma-separated road labels to keep; empty keeps all")
    parser.add_argument("--primary-roads", default="", help="Labels drawn as primary routes")
    parser.add_argument("--jurisdiction", default="", help="Jurisdiction written on the kept roads")
    parser.add_argument("--max-place-rank", type=int, default=9, help="Keep places with scalerank up to this")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    folder = Path(args.ne_dir)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    west, south, east, north = numbers(args.bounds)
    frame = box(west, south, east, north)
    to_metres = Transformer.from_crs(4326, args.epsg, always_xy=True).transform
    to_degrees = Transformer.from_crs(args.epsg, 4326, always_xy=True).transform
    data, hashes = {}, {}
    for key, name in LAYERS.items():
        data[key], hashes[name] = read(folder / name)
    version_file = folder / "VERSION"
    edition = version_file.read_text().strip() if version_file.exists() else "unknown"

    def kept(collection):
        for feature in collection["features"]:
            geometry = shape(feature["geometry"])
            if geometry.intersects(frame):
                yield feature, geometry

    land = unary_union([g.intersection(frame) for _, g in kept(data["land"])] +
                       [g.intersection(frame) for _, g in kept(data["minor-islands"])])
    lakes = unary_union([g.intersection(frame) for _, g in kept(data["lakes"])])
    dry = land.difference(lakes)
    excluded = [box(*numbers(text)) for text in args.exclude]
    parts = list(getattr(land, "geoms", [land]))
    region = unary_union([part for part in parts
                          if not any(zone.contains(part.representative_point()) for zone in excluded)])
    # Land within the buffer of the sea: the sea is the frame less all land, lakes not counted.
    sea = transform(to_metres, frame.difference(land))
    near_coast = transform(to_degrees, sea.buffer(args.coast_km * 1000, resolution=8))
    coastal = region.intersection(near_coast)

    features = [
        {"type": "Feature", "properties": {"kind": "data-coverage"}, "geometry": mapping(frame)},
        {"type": "Feature", "properties": {"kind": "land"}, "geometry": mapping(dry)},
        {"type": "Feature", "properties": {"kind": "region"}, "geometry": mapping(region)},
        {"type": "Feature", "properties": {"kind": "coastal-style"}, "geometry": mapping(coastal)},
    ]
    (out / "geography.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": features}))

    labels = [label for label in args.road_labels.split(",") if label]
    primary = {label for label in args.primary_roads.split(",") if label}
    roads = []
    for index, (feature, geometry) in enumerate(kept(data["roads"])):
        properties = feature["properties"]
        label = properties.get("label") or ""
        if properties.get("type") == "Ferry Route" or (labels and label not in labels):
            continue
        roads.append({"type": "Feature", "geometry": mapping(geometry.intersection(frame)), "properties": {
            "id": f"ne-road-{index}", "route": label, "role": "primary" if label in primary else "secondary",
            "jurisdiction": args.jurisdiction, "source": "Natural Earth ne_10m_roads"}})
    (out / "roads.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": roads}))

    places = []
    # Places on the region's land, with a little room for a town on the shore.
    reach = region.buffer(0.05)
    for feature, geometry in kept(data["places"]):
        properties = feature["properties"]
        if properties.get("scalerank", 99) > args.max_place_rank or not reach.covers(geometry):
            continue
        places.append({"type": "Feature", "geometry": mapping(geometry), "properties": {
            "id": slug(properties["name"]), "name": properties["name"], "role": "primary",
            "source": "Natural Earth ne_10m_populated_places_simple", "scalerank": properties.get("scalerank")}})
    (out / "places.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": places}))

    source = {"publisher": "Natural Earth", "edition": edition, "scale": "1:10m",
              "url": "https://www.naturalearthdata.com/", "licence": "Public domain",
              "inputSha256": hashes}
    (out / "land-provenance.json").write_text(json.dumps({
        **source, "layers": [LAYERS["land"], LAYERS["minor-islands"], LAYERS["lakes"]],
        "construction": f"Land and minor islands within {args.bounds}, lakes cut out. Coastal style: region land within {args.coast_km} km of the sea, buffered in EPSG:{args.epsg}; a decorative coverage, not a forest inventory.",
    }, indent=2) + "\n")
    (out / "road-provenance.json").write_text(json.dumps({
        **source, "layers": [LAYERS["roads"], LAYERS["places"]],
        "selection": {"roadLabels": labels or "all", "primary": sorted(primary), "maxPlaceRank": args.max_place_rank},
    }, indent=2) + "\n")
    print(json.dumps({"out": str(out), "landParts": len(parts), "regionParts": len(getattr(region, "geoms", [region])),
                      "lakes": len(getattr(lakes, "geoms", [lakes])), "roads": len(roads), "places": len(places)}))


if __name__ == "__main__":
    main()
