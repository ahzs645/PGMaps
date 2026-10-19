"""Test holdout leakage and optimistic score corruption are rejected."""

import copy
import json
import unittest
from pathlib import Path
from validate_species import validate


class SpeciesTests(unittest.TestCase):
    def setUp(self):
        self.data = json.loads(
            Path("src/pages/dev-lidar/species.generated.json").read_text()
        )
        self.checksums = {
            n: {"sha256": h} for n, h in self.data["input_sha256"].items()
        }

    def check(self, data):
        return validate(
            data,
            "src/pages/dev-lidar/forestry.generated.json",
            "scripts/lidar/sources/species-vri.geojson",
            self.checksums,
            self.data["source_sha256"],
        )

    def test_valid_snapshot(self):
        self.assertEqual(self.check(self.data)["holdouts"], 21)

    def test_rejects_leakage(self):
        s = next(
            f["properties"]
            for f in self.data["stands"]["features"]
            if f["properties"]["model"]
        )
        s["model"]["train_groups"].append(s["feature_id"])
        with self.assertRaises(AssertionError):
            self.check(self.data)

    def test_rejects_optimistic_score(self):
        self.data["experiment"]["model"]["broadleaf_mae_pp"] = 0
        with self.assertRaises(AssertionError):
            self.check(self.data)
