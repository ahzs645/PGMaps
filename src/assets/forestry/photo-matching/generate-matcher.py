"""Create the cosine nearest-neighbor matcher used with the XFeat descriptors."""

from pathlib import Path

from onnx import TensorProto, checker, helper, save


def tensor(name, dtype, shape):
    return helper.make_tensor_value_info(name, dtype, shape)


nodes = [
    helper.make_node("Transpose", ["target"], ["target_t"], perm=[1, 0]),
    helper.make_node("MatMul", ["reference", "target_t"], ["similarities"]),
    helper.make_node("TopK", ["similarities", "k"], ["ref_score", "ref_index"], axis=1),
    helper.make_node("TopK", ["similarities", "k"], ["target_score_t", "target_index_t"], axis=0),
    helper.make_node("Transpose", ["target_score_t"], ["target_score"], perm=[1, 0]),
    helper.make_node("Transpose", ["target_index_t"], ["target_index"], perm=[1, 0]),
]
inputs = [
    tensor("reference", TensorProto.FLOAT, ["n", 64]),
    tensor("target", TensorProto.FLOAT, ["m", 64]),
]
outputs = [
    tensor("ref_score", TensorProto.FLOAT, ["n", 2]),
    tensor("ref_index", TensorProto.INT64, ["n", 2]),
    tensor("target_score", TensorProto.FLOAT, ["m", 2]),
    tensor("target_index", TensorProto.INT64, ["m", 2]),
]
graph = helper.make_graph(
    nodes, "pgmaps_cosine_neighbors", inputs, outputs,
    [helper.make_tensor("k", TensorProto.INT64, [1], [2])],
)
model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 16)], ir_version=8)
checker.check_model(model)
save(model, Path(__file__).with_name("matching.onnx"))
