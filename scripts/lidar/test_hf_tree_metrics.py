"""Check diagnostic box matching before interpreting the real RGB runs."""

import unittest

from evaluate_rgb_tree_models import box_metrics


class BoxMatchingTests(unittest.TestCase):
    def test_two_predictions_cannot_claim_one_reference_twice(self):
        result = box_metrics(
            [[0, 0, 10, 10], [0, 0, 10, 10]], [0.9, 0.8], [[0, 0, 10, 10]], 0.25
        )
        self.assertEqual((result["true_positives"], result["false_positives"]), (1, 1))
        self.assertEqual(result["recall"], 1)

    def test_zero_predictions_do_not_imply_perfect_precision(self):
        result = box_metrics([], [], [[0, 0, 10, 10]], 0.25)
        self.assertIsNone(result["precision"])
        self.assertEqual((result["missed"], result["recall"]), (1, 0))

    def test_disjoint_prediction_is_not_a_match(self):
        result = box_metrics([[20, 20, 30, 30]], [0.9], [[0, 0, 10, 10]], 0.25)
        self.assertEqual(
            (result["true_positives"], result["false_positives"], result["missed"]),
            (0, 1, 1),
        )

    def test_low_confidence_prediction_is_excluded(self):
        result = box_metrics([[0, 0, 10, 10]], [0.2], [[0, 0, 10, 10]], 0.25)
        self.assertEqual(result["predictions"], 0)
        self.assertEqual(result["missed"], 1)


if __name__ == "__main__":
    unittest.main()
