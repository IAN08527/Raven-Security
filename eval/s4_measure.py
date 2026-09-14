"""S4-rerun extraction-quality measurement (EVALUATION.md experiment S4,
D11-A surface-then-resolve).

Runs the production EntityExtractor (docs-lane/extract.py, OllamaBackend
qwen2.5:1.5b, warmup=True) over every row of the REVIEWED reference set
eval/splits/s4_enron_20.json (provenance benchmark, 430 annotations) and
scores with eval/metrics/extraction.py.

D11-A difference vs the original S4 run: the model returns {type, value}
surfaces only; `SpanResolver` grounds each surface via str.find() with
occurrence-index disambiguation. True positive = correct type AND exact
resolved span. No partial credit.

Reports separately (one RESULTS.md row per metric, Exp S4-rerun):
- timeout_rate (transport failures after all retries / N)
- extraction_rate (items that got a model answer / N)
- span_resolution_rate (surfaces found in text / all predicted surfaces)
- entity precision/recall/F1 by type on resolved spans
- span_exact_match_accuracy, micro precision/recall/F1

Quarantined items contribute zero predictions; the quarantine count is
recorded in the row notes. Type precision below 0.7 is flagged in the
note column, never suppressed. Timeout rate above 20% is flagged
separately as infrastructure, not model quality.

Writes predictions to eval/outputs/s4_enron_20_rerun_predictions.json
(audit artifact) and appends rows to docs/RESULTS.md via the harness
writer (D24 format). Raw model output for every attempt lands in
eval/outputs/{file_id}_{attempt}.json via the extractor (D11-A audit).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "docs-lane"))
sys.path.insert(0, str(REPO_ROOT / "eval"))

from extract import EntityExtractor, Extracted, OllamaBackend, Quarantined
from metrics.extraction import entity_prf_by_type, span_exact_match_rate
from run_all import append_result_row, check_provenance

SPLIT_PATH = REPO_ROOT / "eval" / "splits" / "s4_enron_20.json"
OUTPUTS_DIR = REPO_ROOT / "eval" / "outputs"
PREDICTIONS_PATH = OUTPUTS_DIR / "s4_enron_20_rerun_predictions.json"

EXPERIMENT = "S4-rerun"
DATASET = "enron-s4-20"
SPLIT = "s4-annotation-set"

# Item namespaces must not collide: texts are capped at 3000 chars.
NAMESPACE = 10_000_000

TRANSPORT_HINTS = ("unreachable", "exhausted", "timeout", "timed out", "transport")


def gold_mentions(row: dict) -> set[tuple[str, int, int]]:
    return {(a["type"], a["char_start"], a["char_end"]) for a in row["annotations"]}


def predicted_mentions(extraction) -> set[tuple[str, int, int]]:
    mentions: set[tuple[str, int, int]] = set()
    for entity in extraction.entities:
        mentions.add((entity.type, entity.char_start, entity.char_end))
    for identifier in extraction.identifiers:
        mentions.add((identifier.type, identifier.char_start, identifier.char_end))
    return mentions


def is_transport_quarantine(reason: str, last_error: str) -> bool:
    blob = f"{reason} {last_error}".lower()
    return any(hint in blob for hint in TRANSPORT_HINTS)


def main() -> int:
    split = json.loads(SPLIT_PATH.read_text(encoding="utf-8"))
    check_provenance(split["rows"], context=str(SPLIT_PATH.relative_to(REPO_ROOT)))

    backend = OllamaBackend(model="qwen2.5:1.5b", warmup=True)
    pooled_gold: set[tuple[str, int, int]] = set()
    pooled_pred: set[tuple[str, int, int]] = set()
    per_item: list[dict] = []
    quarantined = 0
    timeouts = 0
    extracted_n = 0
    surfaces_found = 0
    surfaces_total = 0
    span_not_found_items = 0
    for index, row in enumerate(split["rows"]):
        extractor = EntityExtractor(backend=backend)
        result = extractor.extract(row["text"], file_id=row["id"])
        gold = gold_mentions(row)
        if isinstance(result, Quarantined):
            quarantined += 1
            pred: set[tuple[str, int, int]] = set()
            transport = is_transport_quarantine(result.reason, result.last_error)
            if transport:
                timeouts += 1
            status: dict = {
                "status": "quarantined",
                "transport": transport,
                "reason": result.reason,
            }
        else:
            extracted_n += 1
            assert isinstance(result, Extracted)
            pred = predicted_mentions(result.extraction)
            found_n = len(pred)
            unfound_n = len(result.review_items)
            surfaces_found += found_n
            surfaces_total += found_n + unfound_n
            if unfound_n:
                span_not_found_items += 1
            status = {
                "status": "extracted",
                "attempts": result.attempts,
                "found": found_n,
                "span_not_found": unfound_n,
            }
        pooled_gold |= {(t, NAMESPACE * index + s, NAMESPACE * index + e) for t, s, e in gold}
        pooled_pred |= {(t, NAMESPACE * index + s, NAMESPACE * index + e) for t, s, e in pred}
        per_item.append(
            {
                "id": row["id"],
                "gold_n": len(gold),
                "pred_n": len(pred),
                "hits": len(gold & pred),
                **status,
            }
        )
        print(f"{row['id']}: gold={len(gold)} pred={len(pred)} hits={len(gold & pred)} {status['status']}")

    n_items = len(split["rows"])
    timeout_rate = timeouts / n_items if n_items else 0.0
    extraction_rate = extracted_n / n_items if n_items else 0.0
    span_resolution_rate = surfaces_found / surfaces_total if surfaces_total else 0.0

    gold_list = sorted(pooled_gold)
    pred_list = sorted(pooled_pred)
    table = entity_prf_by_type(gold_list, pred_list)
    span_acc = span_exact_match_rate(gold_list, pred_list)
    hits = len(set(gold_list) & set(pred_list))
    micro_p = hits / len(pred_list) if pred_list else 0.0
    micro_r = hits / len(gold_list) if gold_list else 0.0
    micro_f1 = 2 * micro_p * micro_r / (micro_p + micro_r) if micro_p + micro_r else 0.0

    OUTPUTS_DIR.mkdir(exist_ok=True)
    PREDICTIONS_PATH.write_text(
        json.dumps(
            {
                "experiment": EXPERIMENT,
                "dataset": DATASET,
                "split": SPLIT,
                "model": "qwen2.5:1.5b",
                "backend": "OllamaBackend(warmup=True)",
                "contract": "D11-A surface-then-resolve",
                "quarantined_items": quarantined,
                "timeout_items": timeouts,
                "extracted_items": extracted_n,
                "surfaces_found": surfaces_found,
                "surfaces_total": surfaces_total,
                "span_not_found_items": span_not_found_items,
                "items": per_item,
                "pooled_gold_n": len(gold_list),
                "pooled_pred_n": len(pred_list),
                "pooled_hits": hits,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"predictions audit artifact: {PREDICTIONS_PATH.relative_to(REPO_ROOT)}")

    base_note = (
        "D11-A surface-then-resolve EntityExtractor/OllamaBackend qwen2.5:1.5b "
        f"warmup=True over reviewed s4_enron_20 ({n_items} items, {len(gold_list)} "
        f"gold mentions, {len(pred_list)} predicted resolved spans, {quarantined} "
        f"quarantined of which {timeouts} transport timeouts, {extracted_n} extracted, "
        f"span resolution {surfaces_found}/{surfaces_total}). "
        "Exact type+span on resolved spans, no partial credit."
    )
    if timeout_rate > 0.20:
        base_note += (
            " FLAG-INFRA: timeout rate above 20% -- infrastructure problem, not model quality."
        )

    append_result_row(
        experiment=EXPERIMENT,
        dataset=DATASET,
        split=SPLIT,
        metric="timeout_rate",
        value=timeout_rate,
        note=base_note,
    )
    append_result_row(
        experiment=EXPERIMENT,
        dataset=DATASET,
        split=SPLIT,
        metric="extraction_rate",
        value=extraction_rate,
        note=base_note,
    )
    append_result_row(
        experiment=EXPERIMENT,
        dataset=DATASET,
        split=SPLIT,
        metric="span_resolution_rate",
        value=span_resolution_rate,
        note=base_note,
    )
    below = sorted(t for t, v in table.items() if v["precision"] < 0.7)
    for typ in sorted(table):
        values = table[typ]
        for metric in ("precision", "recall", "f1"):
            note = (
                f"{base_note} gold_n={values['gold_n']:.0f} pred_n={values['pred_n']:.0f}."
            )
            if metric == "precision" and typ in below:
                note += " FLAG: precision below 0.7."
            append_result_row(
                experiment=EXPERIMENT,
                dataset=DATASET,
                split=SPLIT,
                metric=f"entity_{typ}_{metric}",
                value=values[metric],
                note=note,
            )
    append_result_row(
        experiment=EXPERIMENT,
        dataset=DATASET,
        split=SPLIT,
        metric="span_exact_match_accuracy",
        value=span_acc,
        note=base_note,
    )
    for metric, value in (
        ("micro_precision", micro_p),
        ("micro_recall", micro_r),
        ("micro_f1", micro_f1),
    ):
        append_result_row(
            experiment=EXPERIMENT,
            dataset=DATASET,
            split=SPLIT,
            metric=metric,
            value=value,
            note=base_note,
        )
    print(
        f"S4-rerun: timeout={timeout_rate:.4f} extracted={extraction_rate:.4f} "
        f"resolved={span_resolution_rate:.4f} span_acc={span_acc:.4f} "
        f"micro_f1={micro_f1:.4f} below_0.7={below}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
