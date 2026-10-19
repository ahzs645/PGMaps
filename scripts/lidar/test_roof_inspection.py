import unittest
import numpy as np
from rasterio.transform import from_origin
from shapely.geometry import box
from inspect_roofs import plane_metrics, sample_profile


class RoofInspectionTests(unittest.TestCase):
    def test_known_roof_pitch_and_downslope_direction(self):
        x, y = np.meshgrid(np.arange(10.), np.arange(10.))
        plane = plane_metrics(x.ravel(), y.ravel(), (100 + .5 * x).ravel())
        self.assertAlmostEqual(plane["pitch_deg"], 26.565, places=2)
        self.assertAlmostEqual(plane["downslope_aspect_deg"], 270)
        self.assertLess(plane["plane_rmse_m"], .001)

    def test_gabled_roof_does_not_look_like_a_good_flat_plane(self):
        x, y = np.meshgrid(np.arange(11.), np.arange(11.))
        roof = 105 - np.abs(x - 5)
        self.assertGreater(plane_metrics(x.ravel(), y.ravel(), roof.ravel())["plane_rmse_m"], 1)
        self.assertIsNone(plane_metrics(x.ravel(), y.ravel(), np.ones(x.size) * 100)["downslope_aspect_deg"])

    def test_profile_keeps_missing_terrain_and_outside_grid_samples_missing(self):
        terrain = np.ones((10, 10)) * 100
        terrain[3:7, 3:7] = np.nan
        profile = sample_profile(box(3, 3, 7, 7), terrain, np.ones((10, 10)) * 105, from_origin(0, 10, 1, 1))
        self.assertTrue(any(row["surface_m"] is None for row in profile))
        self.assertTrue(any(row["inside_patch"] and row["terrain_m"] is None and row["surface_m"] == 105 for row in profile))


if __name__ == "__main__": unittest.main()
