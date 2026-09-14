"""M0-T6. Evaluation harness: discovers eval/metrics/*.py, runs the fixed,
committed splits under eval/splits/, and appends one row per result to
docs/RESULTS.md. Refuses to compute over provenance='synthetic' rows (D19,
CLAUDE.md rule 4) -- enforced here, in code, not left to the caller.
"""

from __future__ import annotations

import argparse
import datetime
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
METRICS_DIR = REPO_ROOT / "eval" / "metrics"
SPLITS_DIR = REPO_ROOT / "eval" / "splits"
RESULTS_MD = REPO_ROOT / "docs" / "RESULTS.md"
FIRST_ROW_PLACEHOLDER = "first row lands at M0-T6"

ALLOWED_PROVENANCE = {"benchmark", "collected"}


class ProvenanceError(RuntimeError):
    """Raised when eval data carries (or is missing) an allowed provenance
    value. D19 / CLAUDE.md rule 4: metrics never touch synthetic rows, and
    this is enforced here rather than trusted to the caller."""


def check_provenance(rows: list[dict[str, Any]], context: str) -> None:
    for row in rows:
        value = row.get("provenance")
        if value == "synthetic":
            raise ProvenanceError(
                f"{context}: refusing to compute a metric over a "
                "provenance='synthetic' row (D19, CLAUDE.md rule 4)"
            )
        if value not in ALLOWED_PROVENANCE:
            raise ProvenanceError(
                f"{context}: row has no recognised provenance ({value!r}); "
                f"expected one of {sorted(ALLOWED_PROVENANCE)}"
            )


def git_commit() -> str:
    result = subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    commit = result.stdout.strip()
    return commit if commit else "uncommitted"


def append_result_row(
    *,
    experiment: str,
    dataset: str,
    split: str,
    metric: str,
    value: float,
    note: str = "",
) -> None:
    date = datetime.datetime.now(tz=datetime.UTC).date().isoformat()
    commit = git_commit()
    row = f"| {date} | {commit} | {experiment} | {dataset} | {split} | {metric} | {value:.4f} | {note} |\n"

    text = RESULTS_MD.read_text(encoding="utf-8")
    lines = text.splitlines(keepends=True)
    placeholder_index = next(
        (i for i, line in enumerate(lines) if FIRST_ROW_PLACEHOLDER in line), None
    )
    if placeholder_index is not None:
        lines[placeholder_index] = row
    else:
        lines.append(row)
    RESULTS_MD.write_text("".join(lines), encoding="utf-8")


def run_cer_fast() -> None:
    sys.path.insert(0, str(METRICS_DIR))
    from cer import character_error_rate

    fixture_path = SPLITS_DIR / "cer_fixture.json"
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    check_provenance(fixture["rows"], context=str(fixture_path.relative_to(REPO_ROOT)))

    pairs = [(row["reference"], row["hypothesis"]) for row in fixture["rows"]]
    value = character_error_rate(pairs)

    append_result_row(
        experiment=fixture["experiment"],
        dataset=fixture["dataset"],
        split=fixture["split"],
        metric="CER",
        value=value,
        note=fixture.get("note", ""),
    )
    print(f"CER = {value:.4f} over {len(pairs)} pairs; appended to {RESULTS_MD.relative_to(REPO_ROOT)}")


def discover_metric_scripts() -> list[Path]:
    return sorted(p for p in METRICS_DIR.glob("*.py") if p.name != "__init__.py")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Raven evaluation harness (M0-T6).")
    parser.add_argument(
        "--fast", action="store_true", help="Run only the CI-fast subset (currently: CER fixture)."
    )
    args = parser.parse_args(argv)

    if args.fast:
        run_cer_fast()
        return 0

    print("Discovered metric scripts:")
    for script in discover_metric_scripts():
        print(f"  {script.relative_to(REPO_ROOT)}")
    print(
        "Full harness runs are wired in as each experiment's dataset and split land "
        "(S1-S7, EVALUATION.md §2); only --fast (CER) is implemented end to end today."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
