import unittest
import numpy as np
from heatmaps import canopy_cover, rgba


class CanopyHeatmapTests(unittest.TestCase):
    def test_density_is_area_cover_not_point_count_and_uses_strict_height_threshold(
        self,
    ):
        height = np.ones((41, 41)) * 2
        eligible = np.ones_like(height, dtype=bool)
        self.assertEqual(canopy_cover(height, eligible, 2)[20, 20], 0)
        height[10:31, 10:31] = 10
        self.assertAlmostEqual(canopy_cover(height, eligible, 5)[20, 20], 100)
        height[10:31, 10:20] = 0
        self.assertAlmostEqual(canopy_cover(height, eligible, 5)[20, 20], 11 / 21 * 100)

    def test_unknown_cells_are_not_open_canopy_and_excluded_centres_stay_missing(self):
        height = np.ones((41, 41)) * 10
        eligible = np.ones_like(height, dtype=bool)
        eligible[10:12, 10:31] = False
        result = canopy_cover(height, eligible, 5)
        self.assertAlmostEqual(result[20, 20], 100)
        self.assertTrue(np.isnan(result[10, 20]))
        self.assertTrue(np.isnan(result[0, 0]))
        eligible[10:20, 10:31] = False
        self.assertTrue(np.isnan(canopy_cover(height, eligible, 5)[20, 20]))

    def test_palette_endpoints_clipping_and_missing_transparency(self):
        image = rgba(np.array([[0.0, 10.0, 40.0, 60.0, np.nan]]), 40)
        self.assertEqual(image[0, 0].tolist(), [44, 30, 133, 255])
        self.assertEqual(image[0, 1].tolist(), [40, 119, 184, 255])
        self.assertEqual(image[0, 2].tolist(), [239, 59, 44, 255])
        self.assertEqual(image[0, 3].tolist(), [239, 59, 44, 255])
        self.assertEqual(int(image[0, 4, 3]), 0)


if __name__ == "__main__":
    unittest.main()
