"""Provenance and original-return joins for the bounded method comparison."""

import hashlib
import json
from pathlib import Path
import unittest

import numpy as np

from benchmark_tree_methods import original_flags, sample_indexes

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = ROOT / "src/pages/dev-lidar/treeBenchmarks.generated.json"


class FlagFixture:
    points = [1, 2, 3, 4]
    withheld = np.array([0, 1, 0, 0], dtype=np.uint8)
    overlap = np.array([0, 0, 1, 0], dtype=np.uint8)


class BenchmarkTests(unittest.TestCase):
    def test_original_las_flags_are_boolean_before_negation(self):
        withheld, overlap = original_flags(FlagFixture())
        self.assertEqual(withheld.dtype, np.dtype(bool))
        self.assertEqual(np.flatnonzero(~withheld & ~overlap).tolist(), [0, 3])

    def test_display_sampling_is_bounded_unique_and_deterministic(self):
        indexes = sample_indexes(65019)
        self.assertEqual(len(indexes), 2800)
        self.assertEqual(len(np.unique(indexes)), 2800)
        self.assertEqual(indexes[0], 0)
        self.assertEqual(indexes[-1], 65018)
        self.assertTrue(np.array_equal(indexes, sample_indexes(65019)))

    @unittest.skipUnless(SNAPSHOT.exists(), "run tree benchmark generator first")
    def test_all_methods_use_same_original_return_join_and_keep_unassigned(self):
        data = json.loads(SNAPSHOT.read_text())
        self.assertEqual(data["schema_version"], 1)
        self.assertEqual(len(data["plots"]), 3)
        self.assertEqual(
            data["source_sha256"],
            "f5246f351e8d5923bf8a5dfddc0753032dbe8cb6e687ae58818cc701cb398ecf",
        )
        current = ROOT / "src/pages/dev-lidar/treeIsolation.generated.json"
        self.assertEqual(
            data["segmentation_sha256"],
            hashlib.sha256(current.read_bytes()).hexdigest(),
        )
        source = json.loads(current.read_text())
        self.assertEqual(data["label_grid_sha256"], source["label_grid_sha256"])
        self.assertEqual(
            data["input_sha256"]["dtm-1m.tif"], source["input_sha256"]["dtm-1m.tif"]
        )
        dtm = ROOT / "public/data/lidar-analysis/bc-093g086/dtm-1m.tif"
        if dtm.exists():
            self.assertEqual(
                data["input_sha256"]["dtm-1m.tif"],
                hashlib.sha256(dtm.read_bytes()).hexdigest(),
            )
        generator = ROOT / "scripts/lidar/benchmark_tree_methods.py"
        self.assertEqual(
            data["generator_sha256"], hashlib.sha256(generator.read_bytes()).hexdigest()
        )
        for plot in data["plots"]:
            self.assertLessEqual(plot["examined_returns"], 750000)
            self.assertGreater(plot["accepted_returns"], plot["sample"]["sampled"])
            sample = plot["sample"]
            self.assertLessEqual(sample["sampled"], 2800)
            self.assertEqual(sample["total"], plot["accepted_returns"])
            self.assertEqual(len(sample["points"]), sample["sampled"])
            identities = [(row[4], row[5]) for row in sample["points"]]
            self.assertEqual(len(identities), len(set(identities)))
            self.assertTrue(any(row[3] < 2 for row in sample["points"]))
            self.assertTrue(all(-0.501 <= row[3] <= 80 for row in sample["points"]))
            self.assertTrue(
                all(0 <= row[4] < len(sample["nodes"]) for row in sample["points"])
            )
            self.assertEqual(
                {m["id"] for m in plot["methods"]},
                {"watershed", "dalponte2016", "li2012", "pointtree-treex"},
            )
            for method in plot["methods"]:
                self.assertEqual(method["status"], "completed", method.get("reason"))
                self.assertEqual(method["input_sha256"], plot["input_sha256"])
                self.assertEqual(len(method["labels"]), len(sample["points"]))
                self.assertTrue(
                    all(
                        isinstance(label, int) and label >= -1
                        for label in method["labels"]
                    )
                )
                self.assertEqual(
                    method["assigned_points"] + method["unassigned_points"],
                    method["eligible_core_points"],
                )
                self.assertEqual(method["instances_buffer"], len(method["tops"]))
                self.assertEqual(
                    method["instances_core"],
                    sum(not top["edge"] for top in method["tops"]),
                )
                self.assertGreaterEqual(method["runtime_seconds"], 0)
                if method["id"] != "watershed":
                    self.assertGreater(method["peak_rss_mb"], 0)
            for pair in plot["pairwise_agreement"]:
                self.assertLessEqual(
                    pair["common_assigned_points"], pair["eligible_core_points"]
                )
                if pair["adjusted_rand_index"] is not None:
                    self.assertGreaterEqual(pair["adjusted_rand_index"], -1)
                    self.assertLessEqual(pair["adjusted_rand_index"], 1)

    @unittest.skipUnless(
        Path("/workspace/scratch/tree-benchmarks/manifest.json").exists(),
        "original benchmark arrays unavailable in ordinary checkout",
    )
    def test_display_samples_and_method_labels_match_full_processing_arrays(self):
        data = json.loads(SNAPSHOT.read_text())
        work = Path("/workspace/scratch/tree-benchmarks")
        for plot in data["plots"]:
            raw = np.load(work / f"{plot['id']}.npz")["points"]
            indexes = sample_indexes(len(raw))
            display = np.asarray(plot["sample"]["points"])
            self.assertTrue(np.allclose(display[:, :4], raw[indexes, :4], atol=0.00051))
            self.assertTrue(np.array_equal(display[:, 4:], raw[indexes, 4:]))
            for method in plot["methods"]:
                if method["id"] == "watershed":
                    continue
                labels = np.loadtxt(
                    work / f"{plot['id']}-{method['id']}.labels", dtype=np.int64
                )
                self.assertEqual(method["labels"], labels[indexes].tolist())
                self.assertEqual(
                    method["output_sha256"],
                    hashlib.sha256(labels.astype("<i8").tobytes()).hexdigest(),
                )


if __name__ == "__main__":
    unittest.main()
