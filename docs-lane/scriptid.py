"""Per-line script classification (pipeline step 3, FR-2.3, D17).

FIR forms mix English labels with Indic content line by line, so the
script is identified per line crop before recognition: the shared-charset
recogniser is scoped by it, and the D17 gate is evaluated per script.

Training data status (honest, rule 10): the small in-repo CNN (STACK.md
§5) trains on IIIT-INDIC-HW-WORDS, which is DROPPED -- its licence lives
inside the downloadable zip and cannot be verified without downloading
first -- with IAM as a registration-gated alternate. There is therefore
no trained classifier in this tree. `ScriptClassifier.load()` raises
`ScriptModelNotTrained` rather than returning a guess, and
`FixedScriptClassifier` below is a TEST DOUBLE for pipeline tests: it
returns whatever script it was constructed with and is never a
measurement of classification accuracy.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from pydantic import BaseModel, Field


class ScriptPredictionModel(BaseModel):
    """Pydantic boundary for one classification (conventions: Pydantic at
    every model boundary, including internal ones)."""

    script: str = Field(min_length=1)  # ISO 15924, e.g. Latn, Deva, Taml
    confidence: float = Field(ge=0.0, le=1.0)


@dataclass(frozen=True)
class ScriptPrediction:
    script: str
    confidence: float


class ScriptModelNotTrained(RuntimeError):
    """Raised when production script-ID weights are requested but no
    trained model exists (training data DROPPED/registration-gated)."""


class ScriptClassifier(ABC):
    """Stage boundary: line crop (HxW uint8) in, script prediction out."""

    @abstractmethod
    def classify(self, line_crop: np.ndarray) -> ScriptPrediction:
        """Classify one line crop. Raises on empty input, never guesses."""
        raise NotImplementedError

    @classmethod
    def load(cls, weights_path: str | Path) -> ScriptClassifier:
        """Production loader: the small in-repo CNN (STACK.md §5). Raises
        `ScriptModelNotTrained` until training data is available -- a stub
        that silently returned a script would corrupt every downstream
        gate decision (D17) without any error."""
        raise ScriptModelNotTrained(
            "no trained script classifier exists: IIIT-INDIC-HW-WORDS is DROPPED "
            "(licence unverifiable without downloading) and IAM needs registration "
            f"(requested weights: {weights_path}). Train the STACK.md §5 CNN once "
            "data lands; until then use FixedScriptClassifier in tests only."
        )


class FixedScriptClassifier(ScriptClassifier):
    """TEST DOUBLE. Returns the script it was constructed with at the
    given confidence, for pipeline tests that need a deterministic script
    label. Not a classifier: it looks at nothing and measures nothing."""

    def __init__(self, script: str, confidence: float = 1.0) -> None:
        ScriptPredictionModel(script=script, confidence=confidence)
        self._prediction = ScriptPrediction(script=script, confidence=confidence)

    def classify(self, line_crop: np.ndarray) -> ScriptPrediction:
        if line_crop.size == 0:
            raise ValueError("scriptid: refusing an empty line crop")
        return self._prediction
