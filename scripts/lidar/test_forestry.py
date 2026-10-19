import unittest
import numpy as np
from forestry import normalized_entropy, return_metrics, local_texture, edge_classes


class ForestryMetricsTests(unittest.TestCase):
    def test_entropy_is_normalized_and_empty_is_unknown(self):
        self.assertAlmostEqual(normalized_entropy(np.ones(79)), 1)
        self.assertAlmostEqual(normalized_entropy([0, 0, 100, 0]), 0)
        self.assertIsNone(normalized_entropy(np.zeros(79)))

    def test_strata_boundaries_denominators_and_empty_elevated_profile(self):
        histogram = np.zeros(81, dtype="int64")
        histogram[[0, 1, 2, 4, 5, 9, 10, 19, 20, 29, 30, 80]] = [
            10,
            5,
            2,
            3,
            7,
            1,
            4,
            1,
            3,
            4,
            4,
            2,
        ]
        result = return_metrics(histogram)
        self.assertEqual(result["bands"], [15, 5, 8, 5, 7, 6])
        self.assertEqual(result["returns"], 46)
        self.assertEqual(result["elevated_returns"], 31)
        self.assertEqual(result["low_layer_percent"], round(5 / 31 * 100, 3))
        histogram[2:] = 0
        result = return_metrics(histogram)
        self.assertIsNone(result["low_layer_percent"])
        self.assertIsNone(result["height_entropy"])

    def test_texture_preserves_missing_windows_and_known_sd(self):
        x = np.tile(np.arange(9), (9, 1)).astype(float) * 0.2
        valid = np.ones(x.shape, dtype=bool)
        result = local_texture(x, valid)
        self.assertAlmostEqual(result[4, 4], np.std(np.arange(5) * 0.2))
        self.assertTrue(np.isnan(result[0, 0]))
        valid[4, 4] = False
        result = local_texture(x, valid)
        self.assertTrue(np.isnan(result[4, 4]))
        self.assertTrue(np.isnan(result[2, 2]))
        self.assertAlmostEqual(
            local_texture(np.ones((9, 9)) * 10, np.ones((9, 9), dtype=bool))[4, 4], 0
        )

    def test_edges_interior_and_unknown_partition_exactly(self):
        canopy = np.ones((61, 61), dtype=bool)
        opening = np.zeros_like(canopy)
        opening[:, 0] = True
        canopy[:, 0] = False
        unknown = np.zeros_like(canopy)
        unknown[30, 30] = True
        canopy[30, 30] = False
        edge, interior, censored = edge_classes(canopy, opening, unknown, 10)
        np.testing.assert_array_equal(
            edge.astype(int) + interior + censored, canopy.astype(int)
        )
        self.assertTrue(edge[30, 5])
        self.assertFalse(edge[30, 15])
        self.assertTrue(interior[15, 20])
        self.assertTrue(censored[30, 29])
        self.assertTrue(censored[0, 50])
        self.assertFalse(interior[0, 50])
        _, larger_interior, _ = edge_classes(canopy, opening, unknown, 20)
        self.assertTrue(np.all(~larger_interior | interior))

    def test_no_known_opening_does_not_create_an_edge_or_false_tile_interior(self):
        canopy = np.ones((61, 61), dtype=bool)
        empty = np.zeros_like(canopy)
        edge, interior, censored = edge_classes(canopy, empty, empty, 20)
        self.assertFalse(edge.any())
        self.assertTrue(interior[30, 30])
        self.assertFalse(interior[0, 30])
        self.assertTrue(censored[0, 30])


if __name__ == "__main__":
    unittest.main()
