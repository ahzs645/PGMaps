#!/usr/bin/env python3
"""Experimental stand-held-out species-composition regression against weak VRI labels."""

import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
import rasterio
from rasterio.features import shapes
from pyproj import Transformer
from shapely import transform, union_all
from shapely.geometry import shape, mapping
from sklearn.ensemble import RandomForestRegressor
import sklearn

SPECIES = {
    "AC": "Poplar",
    "AT": "Trembling aspen",
    "BL": "Subalpine fir",
    "EP": "Paper birch",
    "FDI": "Interior Douglas-fir",
    "PLI": "Interior lodgepole pine",
    "SX": "Hybrid spruce",
}
BROADLEAF = {"AC", "AT", "EP"}
FEATURES = ["canopy_percent", "surface_p95_m", "surface_sd_m", "rugosity_m"] + [
    f"{kind}_{name}"
    for kind in ("all", "first")
    for name in (
        "entropy",
        "low_layer",
        "band0",
        "band1",
        "band2",
        "band3",
        "band4",
        "band5",
    )
]


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def vector(p):
    result = [
        p["canopy_percent"],
        p["surface_p95_m"],
        p["surface_sd_m"],
        p["rugosity_m"],
    ]
    for kind in ("all", "first"):
        r = p["profiles"][kind]
        result += [r["height_entropy"], r["low_layer_percent"]]
        result += [100 * n / r["returns"] if r["returns"] else None for n in r["bands"]]
    return result


def grouped_predictions(x, y, groups):
    """Each stand has equal training weight; no held-out stand enters fitting."""
    records = []
    for group in sorted(set(groups)):
        train, test = groups != group, groups == group
        train_groups, counts = np.unique(groups[train], return_counts=True)
        weights = {g: 1 / n for g, n in zip(train_groups, counts)}
        model = RandomForestRegressor(
            n_estimators=128,
            min_samples_leaf=5,
            max_features=1.0,
            random_state=42,
            n_jobs=1,
        )
        model.fit(x[train], y[train], sample_weight=[weights[g] for g in groups[train]])
        prediction = model.predict(x[test]).mean(axis=0)
        baseline = np.mean(
            [y[train][groups[train] == g][0] for g in train_groups], axis=0
        )
        records.append(
            {
                "group": str(group),
                "plots": int(test.sum()),
                "train_groups": [str(g) for g in train_groups],
                "observed": y[test][0].tolist(),
                "predicted": prediction.tolist(),
                "baseline": baseline.tolist(),
            }
        )
    return records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--analysis", type=Path, required=True)
    parser.add_argument(
        "--inventory",
        type=Path,
        default=Path("scripts/lidar/sources/species-vri.geojson"),
    )
    parser.add_argument(
        "--forestry",
        type=Path,
        default=Path("src/pages/dev-lidar/forestry.generated.json"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("src/pages/dev-lidar/species.generated.json"),
    )
    args = parser.parse_args()
    forest = json.loads(args.forestry.read_text())
    inventory = json.loads(args.inventory.read_text())
    to_metric = Transformer.from_crs(4326, 3157, always_xy=True).transform
    to_geo = Transformer.from_crs(3157, 4326, always_xy=True).transform
    project = lambda g: transform(g, to_metric, interleaved=False)
    with rasterio.open(args.analysis / "height-1m.tif") as src:
        valid = ~np.ma.getmaskarray(src.read(1, masked=True))
        footprint = union_all(
            [
                shape(g)
                for g, v in shapes(
                    valid.astype("uint8"), mask=valid, transform=src.transform
                )
                if v
            ]
        )
    stands = []
    codes = sorted(SPECIES)
    for feature in inventory["features"]:
        p = feature["properties"]
        geometry = project(shape(feature["geometry"])).intersection(footprint)
        if geometry.is_empty or geometry.area < 1:
            continue
        composition = {c: 0 for c in codes}
        for slot in range(1, 7):
            code, pct = p.get(f"SPECIES_CD_{slot}"), p.get(f"SPECIES_PCT_{slot}")
            if code:
                if code not in SPECIES:
                    raise ValueError(f"Unknown code: {code}")
                composition[code] += float(pct or 0)
        treed = p["BCLCS_LEVEL_2"] == "T"
        labelled = treed and abs(sum(composition.values()) - 100) < 0.01
        props = {
            "id": f"vri-{p['FEATURE_ID']}",
            "feature_id": str(p["FEATURE_ID"]),
            "area_m2": round(geometry.area, 2),
            "treed": treed,
            "labelled": labelled,
            "composition": composition,
            "leading": p.get("SPECIES_CD_1"),
            "broadleaf_percent": (
                sum(composition[c] for c in BROADLEAF) if labelled else None
            ),
            "reference_year": p.get("REFERENCE_YEAR"),
            "interpretation_date": p.get("INTERPRETATION_DATE"),
            "projected_date": p.get("PROJECTED_DATE"),
            "model": None,
        }
        stands.append((geometry, props))
    # Exclude plots crossing stand boundaries. Geometry overlap uses full 50 m plots;
    # prior support and canopy screens are independent LiDAR-only measurements.
    x, y, groups, plot_ids = [], [], [], []
    for plot in forest["plots"]["features"]:
        p = plot["properties"]
        values = vector(p)
        if (
            p["support_percent"] < 95
            or p["canopy_percent"] < 40
            or any(v is None for v in values)
        ):
            continue
        g = project(shape(plot["geometry"]))
        overlap, label = max(
            ((g.intersection(g2).area / g.area, p2) for g2, p2 in stands),
            key=lambda t: t[0],
        )
        if overlap < 0.8 or not label["labelled"]:
            continue
        x.append(values)
        y.append([label["composition"][c] for c in codes])
        groups.append(label["feature_id"])
        plot_ids.append(p["id"])
    x, y, groups = np.array(x), np.array(y), np.array(groups)
    if len(set(groups)) < 10:
        raise ValueError("Too few independent stands")
    records = grouped_predictions(x, y, groups)
    by_group = {r["group"]: r for r in records}
    broad = [codes.index(c) for c in BROADLEAF]
    for _, props in stands:
        props["model"] = by_group.get(props["feature_id"])
        if props["model"]:
            r = props["model"]
            r["broadleaf_percent"] = float(sum(r["predicted"][i] for i in broad))
            r["baseline_broadleaf_percent"] = float(
                sum(r["baseline"][i] for i in broad)
            )
    observed = np.array([r["observed"] for r in records])
    predicted = np.array([r["predicted"] for r in records])
    baseline = np.array([r["baseline"] for r in records])

    def scores(estimate):
        return {
            "species_mae_pp": float(np.abs(estimate - observed).mean()),
            "broadleaf_mae_pp": float(
                np.abs(
                    estimate[:, broad].sum(axis=1) - observed[:, broad].sum(axis=1)
                ).mean()
            ),
        }

    total = sum(p["area_m2"] for _, p in stands if p["labelled"])
    mix = {
        c: sum(p["area_m2"] * p["composition"][c] for _, p in stands if p["labelled"])
        / total
        for c in codes
    }
    result = {
        "schema_version": 1,
        "source_sha256": forest["source_sha256"],
        "input_sha256": forest["input_sha256"],
        "forestry_sha256": sha(args.forestry),
        "inventory_sha256": sha(args.inventory),
        "inventory_metadata": inventory["metadata"],
        "species": SPECIES,
        "species_order": codes,
        "coverage": {
            "supported_m2": float(footprint.area),
            "labelled_m2": total,
            "other_m2": sum(p["area_m2"] for _, p in stands if not p["labelled"]),
            "unmapped_m2": max(
                0, footprint.area - sum(p["area_m2"] for _, p in stands)
            ),
        },
        "area_weighted_inventory_index": mix,
        "experiment": {
            "algorithm": "RandomForestRegressor",
            "sklearn_version": sklearn.__version__,
            "trees": 128,
            "min_samples_leaf": 5,
            "seed": 42,
            "features": FEATURES,
            "evaluation": "Leave one whole VRI stand out; equal stand weight in fitting and scoring. No hyperparameter selection.",
            "plots": len(x),
            "stands": len(records),
            "model": scores(predicted),
            "baseline": scores(baseline),
            "assignments": [
                {"plot": pid, "stand": group} for pid, group in zip(plot_ids, groups)
            ],
            "status": "exploratory_weak_labels",
        },
        "stands": {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": mapping(transform(g, to_geo, interleaved=False)),
                    "properties": p,
                }
                for g, p in stands
            ],
        },
    }
    args.output.write_text(json.dumps(result, separators=(",", ":"), allow_nan=False))
    print(
        json.dumps(
            {
                k: result["experiment"][k]
                for k in ("plots", "stands", "model", "baseline")
            }
        )
    )


if __name__ == "__main__":
    main()
