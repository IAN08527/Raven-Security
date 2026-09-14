"""Character error rate (S3, EVALUATION.md §2). Corpus-level CER: total edit
distance across all pairs divided by total reference length, not the mean of
per-pair rates (a few long, hard lines shouldn't be diluted by many short,
easy ones)."""

from __future__ import annotations

from collections.abc import Sequence


def _levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)

    previous_row = list(range(len(b) + 1))
    for i, char_a in enumerate(a, start=1):
        current_row = [i] + [0] * len(b)
        for j, char_b in enumerate(b, start=1):
            cost = 0 if char_a == char_b else 1
            current_row[j] = min(
                previous_row[j] + 1,  # deletion
                current_row[j - 1] + 1,  # insertion
                previous_row[j - 1] + cost,  # substitution
            )
        previous_row = current_row
    return previous_row[-1]


def character_error_rate(pairs: Sequence[tuple[str, str]]) -> float:
    """CER over (reference, hypothesis) pairs: sum(edit distance) / sum(len(reference))."""
    if not pairs:
        raise ValueError("character_error_rate requires at least one (reference, hypothesis) pair")

    total_edits = 0
    total_ref_chars = 0
    for reference, hypothesis in pairs:
        total_edits += _levenshtein(reference, hypothesis)
        total_ref_chars += len(reference)

    if total_ref_chars == 0:
        raise ValueError("character_error_rate: every reference is empty")

    return total_edits / total_ref_chars
