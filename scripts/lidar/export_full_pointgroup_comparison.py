#!/usr/bin/env python3
"""Export completed source-row predictions as comparison maps and annotated LAZ."""

import argparse
import gzip
import json
from pathlib import Path

import laspy
import numpy as np
from prepare_full_tile import DTYPE, atomic_json
from pyproj import Transformer


def annotate(source, destination, arrays, count):
    temporary = destination.with_name(destination.stem + ".tmp.laz")
    fields = [
        ("sat_instance", "<i4"),
        ("sat_semantic", "i1"),
        ("forainet_instance", "<i4"),
        ("forainet_semantic", "i1"),
    ]
    row = 0
    with laspy.open(source) as reader:
        header = reader.header.copy()
        for name, dtype in fields:
            if name in header.point_format.dimension_names:
                raise ValueError(
                    "Prediction dimension already exists in original source"
                )
            header.add_extra_dim(
                laspy.ExtraBytesParams(name=name, type=np.dtype(dtype))
            )
        with laspy.open(temporary, mode="w", header=header, do_compress=True) as writer:
            for chunk in reader.chunk_iterator(500_000):
                n = len(chunk)
                points = laspy.ScaleAwarePointRecord.zeros(n, header=header)
                points.copy_fields_from(chunk)
                for name, _dtype in fields:
                    points[name] = arrays[name][row : row + n]
                writer.write_points(points)
                row += n
    if row != count:
        raise ValueError("Annotated LAZ source-row count mismatch")
    with laspy.open(temporary) as check:
        if check.header.point_count != count:
            raise ValueError("Written LAZ point count mismatch")
    temporary.replace(destination)


def export(input_dir, root):
    manifest = json.loads((input_dir / "manifest.json").read_text())
    count = manifest["point_count"]
    summaries = {
        m: json.loads((root / m / "merged/summary.json").read_text())
        for m in ["sat", "forainet"]
    }
    for summary in summaries.values():
        if (
            summary["source_sha256"] != manifest["source_sha256"]
            or summary["predicted_returns"] != count
            or summary["missing_returns"]
        ):
            raise ValueError(
                "Export requires verified full-source predictions from both models"
            )
    arrays = {
        f"{m}_{kind}": np.load(root / m / "merged" / f"{kind}.npy", mmap_mode="r")
        for m in summaries
        for kind in ["instance", "semantic"]
    }
    origin = np.asarray(manifest["origin_xy"])
    size = manifest["tile_size_m"]
    projection = Transformer.from_crs(3157, 4326, always_xy=True)
    cells = []
    disagreement = {
        "both_assigned": 0,
        "sat_only": 0,
        "forainet_only": 0,
        "neither_assigned": 0,
    }
    accum = {
        m: {
            k: np.zeros(summaries[m]["tree_candidates"], dtype=np.float64)
            for k in ["x", "y", "n"]
        }
        for m in summaries
    }
    for tile in manifest["tiles"]:
        key = f"{tile['x']}-{tile['y']}"
        a = json.loads((root / "sat" / f"tile-{key}.json").read_text())["window_inputs"]
        b = json.loads((root / "forainet" / f"tile-{key}.json").read_text())[
            "window_inputs"
        ]
        if len(a) != len(b):
            raise ValueError("Models used different window inputs")
        for x, y in zip(a, b, strict=True):
            for name in [
                "x_index",
                "y_index",
                "raw_returns",
                "representatives",
                "representative_source_ids_sha256",
            ]:
                if x[name] != y[name]:
                    raise ValueError("Models used different source representatives")
        records = np.memmap(input_dir / tile["file"], mode="r", dtype=DTYPE)
        rows = records["row"]
        xyz = np.column_stack([records["X"], records["Y"]]).astype(
            np.float64
        ) * np.asarray(manifest["scales"][:2]) + np.asarray(manifest["offsets"][:2])
        ids = {m: np.asarray(arrays[f"{m}_instance"][rows]) for m in summaries}
        assigned = {m: ids[m] >= 0 for m in summaries}
        s, f = assigned["sat"], assigned["forainet"]
        disagreement["both_assigned"] += int((s & f).sum())
        disagreement["sat_only"] += int((s & ~f).sum())
        disagreement["forainet_only"] += int((~s & f).sum())
        disagreement["neither_assigned"] += int((~s & ~f).sum())
        for m in summaries:
            labels = ids[m][assigned[m]]
            if len(labels):
                unique, inverse = np.unique(labels, return_inverse=True)
                accum[m]["x"][unique] += np.bincount(
                    inverse, weights=xyz[assigned[m], 0]
                )
                accum[m]["y"][unique] += np.bincount(
                    inverse, weights=xyz[assigned[m], 1]
                )
                accum[m]["n"][unique] += np.bincount(inverse)
        lo = origin + np.array([tile["x"], tile["y"]]) * size
        hi = lo + size
        ring = [
            projection.transform(*p)
            for p in [lo, [hi[0], lo[1]], hi, [lo[0], hi[1]], lo]
        ]
        n = len(rows)
        cells.append(
            {
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [ring]},
                "properties": {
                    "tile": key,
                    "original_returns": n,
                    "sat_assigned_return_share": float(s.mean()),
                    "forainet_assigned_return_share": float(f.mean()),
                    "assignment_share_difference": float(s.mean() - f.mean()),
                    "forainet_stem_return_share": float(
                        (arrays["forainet_semantic"][rows] == 2).mean()
                    ),
                    "sat_candidate_ids_touching_cell": len(np.unique(ids["sat"][s])),
                    "forainet_candidate_ids_touching_cell": len(
                        np.unique(ids["forainet"][f])
                    ),
                },
            }
        )
    output = root / "comparison"
    output.mkdir(exist_ok=True)
    atomic_json(
        output / "coverage-grid.geojson",
        {"type": "FeatureCollection", "features": cells},
    )
    for model, values in accum.items():
        features = []
        for candidate in range(len(values["n"])):
            n = values["n"][candidate]
            if not n:
                raise ValueError("Merged candidate has no original returns")
            lon, lat = projection.transform(
                values["x"][candidate] / n, values["y"][candidate] / n
            )
            features.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [lon, lat]},
                    "properties": {
                        "model": model,
                        "candidate_id": candidate,
                        "assigned_returns": int(n),
                        "reviewed": False,
                    },
                }
            )
        with gzip.open(
            output / f"{model}-candidate-centroids.geojson.gz", "wt"
        ) as stream:
            json.dump(
                {"type": "FeatureCollection", "features": features},
                stream,
                separators=(",", ":"),
            )
    annotate(
        Path(manifest["source_path"]),
        output / "source-with-model-labels.laz",
        arrays,
        count,
    )
    atomic_json(
        output / "summary.json",
        {
            "stage": "full_tile_comparison_completed",
            "source_sha256": manifest["source_sha256"],
            "original_returns": count,
            "same_window_inputs_verified_all_tiles": True,
            "models": summaries,
            "assignment_agreement_return_counts": disagreement,
            "accuracy_measured": False,
            "grid_measure": "shares of original returns assigned to a candidate, not area canopy cover",
            "candidate_centroids": "centroids of assigned returns, not measured stem locations",
            "annotated_laz": "source-with-model-labels.laz",
            "original_las_attributes_preserved": True,
        },
    )


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input", type=Path, required=True)
    p.add_argument("--run", type=Path, required=True)
    a = p.parse_args()
    export(a.input, a.run)
