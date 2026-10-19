import unittest
import numpy as np
from scipy.spatial import cKDTree
from shapely.geometry import box, Polygon
from workflows import gap_labels, plot_metrics, proximity
from package_models import triangulate


class WorkflowTests(unittest.TestCase):
    def test_opening_connectivity_threshold_and_roof_exclusion(self):
        height = np.full((12, 12), 10.0)
        height[1:5, 1:5] = 1
        height[6:10, 6:10] = 4
        valid = np.ones(height.shape, dtype=bool)
        roof = np.zeros(height.shape, dtype=bool)
        roof[2, 2] = True
        valid[3, 3] = False
        labels = gap_labels(height, valid, roof, 2, minimum=10)
        self.assertEqual(int((labels > 0).sum()), 14)
        self.assertEqual(labels[2, 2], 0)
        self.assertEqual(labels[3, 3], 0)
        self.assertEqual(len(np.unique(labels[labels > 0])), 1)
        self.assertEqual(
            int((gap_labels(height, valid, roof, 5, minimum=10) > 0).sum()), 30
        )
        self.assertFalse(gap_labels(height, valid, roof, 2, minimum=15).any())

    def test_plot_denominators_percentiles_and_missing_cells(self):
        height = np.array([[0.0, 2.0], [4.0, np.nan]])
        result = plot_metrics(height, np.isfinite(height), 2, 4)
        self.assertEqual(result["support_percent"], 75)
        self.assertEqual(result["sampled_m2"], 3)
        self.assertEqual(result["median_m"], 2)
        self.assertEqual(result["p95_m"], 3.8)
        self.assertEqual(result["above_2m_percent"], 33.33)
        self.assertEqual(result["crown_candidates_per_ha"], 6666.7)
        self.assertIsNone(plot_metrics(height, np.zeros((2, 2), dtype=bool), 0, 4))

    def test_proximity_measures_polygon_boundary_and_honours_search_limit(self):
        polygon = box(0, 0, 10, 10)
        xy = np.array([[14.0, 5.0], [0.0, 25.0], [11.0, 11.0]])
        heights = np.array([10.0, 15.0, 20.0])
        tree = cKDTree(xy)
        result = proximity(polygon, tree, xy, heights)
        self.assertAlmostEqual(result["distance_m"], 1.41, places=2)
        self.assertEqual(result["candidate_height_m"], 20)
        self.assertEqual(result["cell_distance_min_m"], 0.71)
        self.assertIsNone(proximity(polygon, tree, xy, heights, radius=1))

    def test_constrained_3d_triangulation_preserves_pitched_roof_hole(self):
        outer = [[0, 0, 10], [10, 0, 12], [10, 10, 12], [0, 10, 10]]
        hole = [[3, 3, 10.6], [3, 7, 10.6], [7, 7, 11.4], [7, 3, 11.4]]
        triangles = triangulate([outer, hole])
        area = 0
        for t in triangles:
            np.testing.assert_allclose(t[:, 2], 10 + 0.2 * t[:, 0], atol=1e-8)
            area += np.linalg.norm(np.cross(t[1] - t[0], t[2] - t[0])) / 2
            self.assertFalse(
                Polygon([(p[0], p[1]) for p in hole]).contains(
                    Polygon(t[:, :2]).centroid
                )
            )
        self.assertAlmostEqual(area, (100 - 16) * np.sqrt(1.04), places=7)


if __name__ == "__main__":
    unittest.main()
