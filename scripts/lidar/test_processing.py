import unittest
import numpy as np
from process import interpolate_ground


class TerrainInterpolationTests(unittest.TestCase):
    def test_sloping_ground_under_a_roof_is_interpolated_not_flattened(self):
        row, col = np.indices((41, 41))
        plane = 600 + col * 0.2 + row * 0.1
        terrain = plane.copy()
        terrain[12:29, 12:29] = np.nan
        result, distance, filled = interpolate_ground(
            terrain, np.ones(terrain.shape, dtype=bool), 1
        )
        self.assertTrue(filled[20, 20])
        self.assertGreater(distance[20, 20], 5)
        np.testing.assert_allclose(result, plane, atol=1e-6)

    def test_a_wide_unsupported_hole_remains_no_data(self):
        terrain = np.full((61, 61), 600.0)
        terrain[5:56, 5:56] = np.nan
        observed = np.ones(terrain.shape, dtype=bool)
        result, _, _ = interpolate_ground(
            terrain, observed, 1, max_distance=5, max_edge=20
        )
        self.assertTrue(np.isnan(result[30, 30]))
        self.assertTrue(np.isfinite(result[4, 30]))

    def test_missing_cells_outside_the_observed_footprint_stay_missing(self):
        terrain = np.full((31, 31), 600.0)
        terrain[:4] = np.nan
        observed = np.ones(terrain.shape, dtype=bool)
        observed[:4] = False
        result, _, filled = interpolate_ground(terrain, observed, 1)
        self.assertTrue(np.isnan(result[:4]).all())
        self.assertFalse(filled[:4].any())


if __name__ == "__main__":
    unittest.main()
