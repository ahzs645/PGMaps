#!/usr/bin/env python3
"""Package actual Roofer CityJSON meshes, per-surface facets and topology diagnostics."""

import argparse, hashlib, json
from collections import Counter
from pathlib import Path
import numpy as np
from pyproj import Transformer
from shapely.geometry import Polygon
from shapely import constrained_delaunay_triangles


def triangulate(rings):
    """Project planar 3D rings onto their best-fit plane; constrained triangulate holes."""
    points = np.array([p for ring in rings for p in ring], dtype=float)
    origin = points.mean(axis=0)
    _, _, vh = np.linalg.svd(points - origin, full_matrices=False)
    basis = vh[:2]
    projected = [(np.asarray(ring) - origin) @ basis.T for ring in rings]
    polygon = Polygon(projected[0], projected[1:])
    if polygon.area < 1e-9:
        return []
    if not polygon.is_valid:
        raise ValueError("Invalid projected model surface")
    triangles = constrained_delaunay_triangles(polygon)
    return [np.asarray(t.exterior.coords)[:3] @ basis + origin for t in triangles.geoms]


def package(work, analysis, output, city_output):
    files = list((work / "output").glob("*.city.jsonl"))
    if len(files) != 1:
        raise ValueError("Expected one Roofer tile")
    lines = [json.loads(line) for line in files[0].read_text().splitlines()]
    header = lines[0]
    scale = np.array(header["transform"]["scale"])
    translation = np.array(header["transform"]["translate"])
    ll = Transformer.from_crs(3157, 4326, always_xy=True)
    records = []
    for feature in lines[1:]:
        vertices = np.array(feature["vertices"]) * scale + translation
        parent = feature["CityObjects"][feature["id"]]
        attributes = parent["attributes"]
        faces = []
        facets = []
        edges = Counter()
        surface_count = 0
        skipped_surfaces = 0
        for child_id in parent.get("children", []):
            for geometry in feature["CityObjects"][child_id].get("geometry", []):
                if geometry.get("lod") != "2.2":
                    continue
                if geometry["type"] != "Solid":
                    raise ValueError("Expected Solid")
                for shell_index, shell in enumerate(geometry["boundaries"]):
                    for index, surface in enumerate(shell):
                        rings = [vertices[ring].tolist() for ring in surface]
                        semantic = geometry["semantics"]["values"][shell_index][index]
                        kind = geometry["semantics"]["surfaces"][semantic]["type"]
                        for ring in surface:
                            for a, b in zip(ring, ring[1:] + ring[:1]):
                                edges[
                                    tuple(
                                        sorted((tuple(vertices[a]), tuple(vertices[b])))
                                    )
                                ] += 1
                        triangles = triangulate(rings)
                        surface_count += 1
                        if not triangles:
                            skipped_surfaces += 1
                        for triangle in triangles:
                            coordinates = []
                            for x, y, z in triangle:
                                lon, lat = ll.transform(x, y)
                                coordinates.append(
                                    [round(lon, 8), round(lat, 8), round(float(z), 3)]
                                )
                            faces.append({"kind": kind, "vertices": coordinates})
                        if kind == "RoofSurface":
                            points = np.asarray(rings[0])
                            normal = np.linalg.svd(
                                points - points.mean(axis=0), full_matrices=False
                            )[2][-1]
                            pitch = float(np.degrees(np.arccos(min(1, abs(normal[2])))))
                            facets.append(
                                {"pitch_deg": round(pitch, 2), "surface_index": index}
                            )
        ground = float(attributes.get("rf_h_ground", vertices[:, 2].min()))
        lon, lat = ll.transform(
            float(vertices[:, 0].mean()), float(vertices[:, 1].mean())
        )
        records.append(
            {
                "id": feature["id"],
                "area_m2": round(float(attributes["area_m2"]), 1),
                "centre": [round(lon, 7), round(lat, 7)],
                "ground_m": round(ground, 3),
                "success": bool(attributes.get("rf_success", False)),
                "mode": attributes.get("rf_extrusion_mode"),
                "rmse_m": (
                    round(float(attributes.get("rf_rmse_lod22", 0)), 3)
                    if attributes.get("rf_rmse_lod22") is not None
                    else None
                ),
                "roof_planes": attributes.get("rf_roof_planes"),
                "roof_type": attributes.get("rf_roof_type"),
                "closed_edge_incidence": bool(edges)
                and all(v == 2 for v in edges.values()),
                "nonmanifold_edges": sum(v != 2 for v in edges.values()),
                "surface_count": surface_count,
                "skipped_degenerate_surfaces": skipped_surfaces,
                "facets": facets,
                "triangles": faces,
            }
        )
        parent["attributes"][
            "pgmaps_input_status"
        ] = "unverified roof-like patch, not a validated building footprint"
    summary = json.loads((analysis / "summary.json").read_text())
    header.setdefault("metadata", {})[
        "title"
    ] = "PGMaps experimental Roofer models from unverified roof-like patches"
    city_output.write_text(
        "\n".join(
            json.dumps(line, separators=(",", ":"), allow_nan=False) for line in lines
        )
        + "\n"
    )
    report = {
        "schema_version": 1,
        "source_sha256": summary["source_sha256"],
        "candidate_sha256": hashlib.sha256(
            (analysis / "building-candidates.geojson").read_bytes()
        ).hexdigest(),
        "cityjson_sha256": hashlib.sha256(city_output.read_bytes()).hexdigest(),
        "engine": json.loads((work / "run.json").read_text()),
        "records": records,
        "limitations": [
            "All input roof patches are unverified, may split buildings or include non-buildings.",
            "Point class 6 was assigned by height within patches, not by a trained building classifier.",
            "Low model-to-point residual is fit consistency, not survey accuracy or building confidence.",
            "Edge incidence checks closed topology only, not self-intersection or semantic correctness.",
            "Local ground origin is for visualization; exported elevations retain CGVD2013.",
        ],
    }
    output.write_text(json.dumps(report, separators=(",", ":"), allow_nan=False) + "\n")
    print(
        json.dumps(
            {
                "models": len(records),
                "successful": sum(r["success"] for r in records),
                "closed": sum(r["closed_edge_incidence"] for r in records),
                "roof_facets": sum(len(r["facets"]) for r in records),
                "triangles": sum(len(r["triangles"]) for r in records),
                "skipped_degenerate_surfaces": sum(
                    r["skipped_degenerate_surfaces"] for r in records
                ),
                "bytes": output.stat().st_size,
            }
        )
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("work", "analysis", "output", "city-output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    package(args.work, args.analysis, args.output, args.city_output)
