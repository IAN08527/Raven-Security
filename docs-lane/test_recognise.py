"""M3-3. Recogniser boundary tests: missing weights raise with a stated
reason, never a download and never invented text."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np  # noqa: E402
import pytest  # noqa: E402

import recognise  # noqa: E402


def test_load_without_cached_weights_raises() -> None:
    recognizer = recognise.ONNXCRNNRecognizer("models/htr_crnn_multiscript.onnx")
    with pytest.raises(recognise.RecognizerWeightsNotCached, match="never downloaded at runtime"):
        recognizer.load()


def test_recognise_without_load_raises() -> None:
    recognizer = recognise.ONNXCRNNRecognizer("models/htr_crnn_multiscript.onnx")
    crop = np.full((32, 128), 200, dtype=np.uint8)
    with pytest.raises(recognise.RecognizerWeightsNotCached, match="not loaded"):
        recognizer.recognise(crop)


def test_recognise_empty_crop_raises() -> None:
    recognizer = recognise.ONNXCRNNRecognizer("models/htr_crnn_multiscript.onnx")
    with pytest.raises(ValueError, match="empty"):
        recognizer.recognise(np.zeros((0, 0), dtype=np.uint8))


def test_normalise_line_height_preserves_aspect() -> None:
    crop = np.full((64, 256), 128, dtype=np.uint8)
    resized = recognise.normalise_line_height(crop)
    assert resized.shape == (32, 128)


def test_normalise_line_height_rejects_empty() -> None:
    with pytest.raises(ValueError, match="empty"):
        recognise.normalise_line_height(np.zeros((0, 0), dtype=np.uint8))


def test_provider_order_prefers_cuda_falls_back_to_cpu() -> None:
    assert recognise.ORT_PROVIDERS[0] == "CUDAExecutionProvider"
    assert recognise.ORT_PROVIDERS[-1] == "CPUExecutionProvider"
