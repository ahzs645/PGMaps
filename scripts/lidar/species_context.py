#!/usr/bin/env python3
"""Link source LiDAR plots to supported inventory geometry; no species inference."""

import argparse
import hashlib
import json
from pathlib import Path
from pyproj import Transformer
from shapely import transform
from shapely.geometry import shape
from shapely.strtree import STRtree


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--species",
        type=Path,
        default=Path("src/pages/dev-lidar/species.generated.json"),
    )
    p.add_argument(
        "--forestry",
        type=Path,
        default=Path("src/pages/dev-lidar/forestry.generated.json"),
    )
    p.add_argument(
        "--output",
        type=Path,
        default=Path("src/pages/dev-lidar/species-context.generated.json"),
    )
    a = p.parse_args()
    species, forest = json.loads(a.species.read_text()), json.loads(
        a.forestry.read_text()
    )
    assert species["source_sha256"] == forest["source_sha256"]
    forward = Transformer.from_crs(4326, 3157, always_xy=True).transform
    inverse = Transformer.from_crs(3157, 4326, always_xy=True).transform
    project = lambda g: transform(g, forward, interleaved=False)
    stands = species["stands"]["features"]
    geometries = [project(shape(f["geometry"])) for f in stands]
    tree = STRtree(geometries)
    links = {}
    for f in forest["plots"]["features"]:
        g = project(shape(f["geometry"]))
        candidates = [
            (g.intersection(geometries[i]).area / g.area, int(i)) for i in tree.query(g)
        ]
        fraction, index = max(candidates, default=(0, None))
        links[f["properties"]["id"]] = {
            "stand_id": stands[index]["properties"]["id"] if fraction >= 0.8 else None,
            "overlap_percent": round(fraction * 100, 5),
        }
    points = {}
    for f, g in zip(stands, geometries):
        point = g.representative_point()
        lon, lat = inverse(point.x, point.y)
        points[f["properties"]["id"]] = [lon, lat]
    out = {
        "schema_version": 1,
        "source_sha256": species["source_sha256"],
        "species_sha256": digest(a.species),
        "forestry_sha256": digest(a.forestry),
        "method": "Full 50 m plot geometry must overlap one supported VRI intersection by >=80%; ties deterministic. No nearest-stand fallback. Field coordinates are points inside supported stand geometry, not access or safe survey locations.",
        "plots": links,
        "field_points": points,
    }
    a.output.write_text(json.dumps(out, separators=(",", ":"), allow_nan=False))
    print(
        json.dumps(
            {
                "plots": len(links),
                "linked": sum(bool(p["stand_id"]) for p in links.values()),
                "stand_points": len(points),
            }
        )
    )


if __name__ == "__main__":
    main()
