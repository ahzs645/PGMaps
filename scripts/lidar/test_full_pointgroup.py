"""Coverage, seam continuity and original-row ownership checks for full runs."""

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
from merge_full_pointgroup import Components, merge, stitch_tile
from pointgroup_full_runtime import centres_for_core, merge_window


class FullPointGroupTests(unittest.TestCase):
    def test_window_lattice_covers_edges_and_corners(self):
        low = np.array([511450.0, 5971000.0])
        high = low + 50
        centres = np.array([c for c, *_ in centres_for_core([low, high], low)])
        x, y = np.meshgrid(
            np.linspace(low[0], high[0], 101), np.linspace(low[1], high[1], 101)
        )
        points = np.column_stack([x.ravel(), y.ravel()])
        distances = ((points[:, None, :] - centres[None, :, :]) ** 2).sum(2).min(1)
        self.assertLess(float(distances.max()), 8**2)
        self.assertTrue(np.all(centres - 8 >= low - 16))
        self.assertTrue(np.all(centres + 8 <= high + 16))

    def test_overlapping_windows_keep_one_id_and_disjoint_objects_separate(self):
        result, n = merge_window(
            np.array([4, 4, 4, -1, -1, -1]), np.array([8, 8, 8, 8, -1, -1]), 5
        )
        np.testing.assert_array_equal(result, [4, 4, 4, 4, -1, -1])
        self.assertEqual(n, 5)
        result, n = merge_window(result, np.array([-1, -1, -1, -1, 0, 0]), n)
        np.testing.assert_array_equal(result, [4, 4, 4, 4, 5, 5])
        self.assertEqual(n, 6)

    def test_cross_tile_components_join_transitively(self):
        components = Components()
        a = components.add()
        b = components.add()
        mapping, values = stitch_tile(
            components, np.array([a, a, b, b, -1]), np.array([2, 2, 2, 2, 2])
        )
        self.assertEqual(components.root(a), components.root(b))
        self.assertEqual(mapping[2], components.root(a))
        self.assertEqual(len(np.unique(components.resolve(values))), 1)

    def write_fixture(self, root, duplicate_owner=False):
        inputs = root / "input"
        run = root / "run"
        inputs.mkdir()
        run.mkdir()
        source = "fixture-source-hash"
        tiles = [{"x": 0, "y": 0, "returns": 4}, {"x": 1, "y": 0, "returns": 4}]
        (inputs / "manifest.json").write_text(
            json.dumps({"point_count": 8, "source_sha256": source, "tiles": tiles})
        )
        (run / "run.json").write_text(
            json.dumps(
                {
                    "model": "sat",
                    "adapter": "test-shared-adapter",
                    "source_sha256": source,
                }
            )
        )
        (run / "inference-completed.json").write_text(
            json.dumps({"core_returns_processed": 8, "source_sha256": source})
        )
        for key, rows, core, semantic, instance in [
            (
                "0-0",
                [0, 1, 2, 3, 4, 5],
                [1, 1, 1, 1, 0, 0],
                [0, 1, 1, 1, 1, 0],
                [-1, 0, 0, 0, 0, -1],
            ),
            (
                "1-0",
                [2, 3, 4, 5, 6, 7],
                [0, 0, 1, 1, 1, 1],
                [1, 1, 1, 1, 0, 0],
                [3, 3, 3, 3, -1, -1],
            ),
        ]:
            if duplicate_owner and key == "1-0":
                core = [0, 1, 0, 1, 1, 1]
            path = run / f"tile-{key}.npz"
            np.savez_compressed(
                path,
                source_rows=np.array(rows),
                core=np.array(core, dtype=bool),
                semantic=np.array(semantic),
                instance=np.array(instance),
            )
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            (run / f"tile-{key}.json").write_text(
                json.dumps({"point_output_sha256": digest})
            )
        return inputs, run

    def test_full_merge_preserves_every_row_and_deduplicates_boundary_tree(self):
        with tempfile.TemporaryDirectory() as temporary:
            inputs, run = self.write_fixture(Path(temporary))
            merge(inputs, run)
            summary = json.loads((run / "merged/summary.json").read_text())
            self.assertEqual(summary["original_returns"], 8)
            self.assertEqual(summary["missing_returns"], 0)
            self.assertEqual(summary["tree_candidates"], 1)
            np.testing.assert_array_equal(
                np.load(run / "merged/instance.npy"), [-1, 0, 0, 0, 0, 0, -1, -1]
            )
            np.testing.assert_array_equal(
                np.load(run / "merged/semantic.npy"), [0, 1, 1, 1, 1, 1, 0, 0]
            )

    def test_duplicate_core_ownership_prevents_success_marker(self):
        with tempfile.TemporaryDirectory() as temporary:
            inputs, run = self.write_fixture(Path(temporary), True)
            with self.assertRaisesRegex(ValueError, "multiple core owners"):
                merge(inputs, run)
            self.assertFalse((run / "merged/summary.json").exists())

    def test_annotated_laz_preserves_original_fields_and_source_order(self):
        import laspy
        from export_full_pointgroup_comparison import annotate

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            header = laspy.LasHeader(point_format=6, version="1.4")
            header.scales = np.array([0.01, 0.01, 0.01])
            header.offsets = np.array([511450.0, 5971000.0, 500.0])
            header.add_extra_dim(
                laspy.ExtraBytesParams(name="original_extra", type="i2")
            )
            source = laspy.LasData(header)
            source.x = [511450, 511451, 511452]
            source.y = [5971000, 5971001, 5971002]
            source.z = [510, 520, 530]
            source.intensity = [11, 123, 64000]
            source.classification = [2, 5, 18]
            source.withheld = [0, 1, 0]
            source.gps_time = [15.1, 15.2, 15.3]
            source.original_extra = [-4, 7, 19]
            source.write(root / "original.las")
            arrays = {
                "sat_instance": np.array([-1, 2, 3]),
                "sat_semantic": np.array([0, 1, 1]),
                "forainet_instance": np.array([-1, 5, -1]),
                "forainet_semantic": np.array([1, 3, 0]),
            }
            annotate(root / "original.las", root / "classified.laz", arrays, 3)
            result = laspy.read(root / "classified.laz")
            for name in source.point_format.dimension_names:
                np.testing.assert_array_equal(source[name], result[name])
            for name, values in arrays.items():
                np.testing.assert_array_equal(result[name], values)


if __name__ == "__main__":
    unittest.main()
