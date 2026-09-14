"""M3-2. Script-ID boundary tests: the double is deterministic, the
production loader refuses to guess."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np  # noqa: E402
import pytest  # noqa: E402
from pydantic import ValidationError  # noqa: E402

import scriptid  # noqa: E402


def test_fixed_double_returns_its_script() -> None:
    classifier = scriptid.FixedScriptClassifier("Deva", confidence=0.9)
    crop = np.full((32, 128), 200, dtype=np.uint8)
    prediction = classifier.classify(crop)
    assert prediction.script == "Deva"
    assert prediction.confidence == pytest.approx(0.9)


def test_fixed_double_rejects_empty_crop() -> None:
    classifier = scriptid.FixedScriptClassifier("Latn")
    with pytest.raises(ValueError, match="empty"):
        classifier.classify(np.zeros((0, 0), dtype=np.uint8))


def test_production_loader_raises_pointing_at_training_data() -> None:
    with pytest.raises(scriptid.ScriptModelNotTrained, match="IIIT-INDIC-HW-WORDS"):
        scriptid.ScriptClassifier.load("models/scriptid_cnn.pt")


def test_invalid_confidence_rejected_at_construction() -> None:
    with pytest.raises(ValidationError):
        scriptid.FixedScriptClassifier("Latn", confidence=1.5)
