"""Build an Enron temporal edge list for S5 link prediction (M4, D27).

Source: CMU Enron maildir (FERC public record, research distribution with a
privacy-sensitivity request — terms verified live 2026-09-13, RESULTS.md
S4-dataset-audit/Enron/AVAILABLE). Reads the tarball
eval/datasets/enron/enron_mail_20150507.tar.gz streaming (the 1.7GB monolith
is never fully extracted), or an already-extracted
eval/datasets/enron-mail-20150507/maildir/ tree if present.

Parses From:, To:, Cc: and Date: from every message. Output one row per
(email, recipient): (sender, recipient, timestamp UTC, weight) where To:
recipients weigh 1.0 and Cc: recipients weigh 0.5 each (cc is weaker
signal than direct). sender/recipient are lowercased, stripped email
addresses; messages with no parseable sender, no recipients, or no Date:
are skipped and counted (rule 9: stated reason, never silent).

Dedup note: multiple emails between the same pair in the same snapshot
window are aggregated downstream (eval/s5_link_prediction.py sums decayed
contributions via eval/metrics/graph.py edge_weight), so this file keeps
one row per email-recipient and lets the snapshot step own the window.

Output: eval/datasets/enron_edges.csv with columns src,dst,ts,weight.
Provenance: benchmark (inherited from the Enron source, rule 7).
"""

from __future__ import annotations

import argparse
import csv
import re
import tarfile
from email import message_from_binary_file
from email.utils import getaddresses, parsedate_to_datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
TARBALL = REPO_ROOT / "eval" / "datasets" / "enron" / "enron_mail_20150507.tar.gz"
EXTRACTED = REPO_ROOT / "eval" / "datasets" / "enron-mail-20150507" / "maildir"
OUT_PATH = REPO_ROOT / "eval" / "datasets" / "enron_edges.csv"

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


def clean_address(raw: str) -> str | None:
    """Lowercase, strip, keep only strings containing a real address."""
    candidate = raw.strip().lower()
    match = EMAIL_RE.search(candidate)
    if not match:
        return None
    return match.group(0)


def message_edges(payload: bytes) -> tuple[str, list[tuple[str, float]], str] | None:
    """Return (sender, [(recipient, weight)], ts_iso) or None with the skip
    counted by the caller. To: weighs 1.0, Cc: weighs 0.5."""
    import io

    try:
        msg = message_from_binary_file(io.BytesIO(payload))
    except Exception:  # noqa: BLE001 - one malformed message must not kill a 3M-edge build
        return None
    sender: str | None = None
    for _, address in getaddresses([msg.get("From", "")]):
        sender = clean_address(address)
        if sender:
            break
    if not sender:
        return None
    dated = msg.get("Date", "")
    try:
        moment = parsedate_to_datetime(dated)
    except (TypeError, ValueError):
        return None
    if moment is None:
        return None
    if moment.tzinfo is None:
        # No offset stated: treat as UTC and say so (documented, not guessed
        # per-message — Enron dates overwhelmingly carry offsets).
        from datetime import timezone

        moment = moment.replace(tzinfo=timezone.utc)
    else:
        from datetime import timezone

        moment = moment.astimezone(timezone.utc)
    edges: list[tuple[str, float]] = []
    for _, address in getaddresses([msg.get("To", "")]):
        cleaned = clean_address(address)
        if cleaned and cleaned != sender:
            edges.append((cleaned, 1.0))
    for _, address in getaddresses([msg.get("Cc", "")]):
        cleaned = clean_address(address)
        if cleaned and cleaned != sender:
            edges.append((cleaned, 0.5))
    if not edges:
        return None
    return sender, edges, moment.isoformat()


def iter_tarball(tarball: Path):
    """Yield raw message bytes in archive order; stops at truncation."""
    with tarfile.open(tarball, "r:gz") as archive:
        while True:
            try:
                member = archive.next()
            except (EOFError, OSError):
                break
            if member is None:
                break
            if not member.isfile():
                continue
            parts = Path(member.name).parts
            if len(parts) < 2 or parts[0] != "maildir":
                continue
            try:
                extracted = archive.extractfile(member)
                if extracted is None:
                    continue
                yield extracted.read()
            except (EOFError, OSError):
                break


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=OUT_PATH)
    args = parser.parse_args()

    scanned = 0
    kept = 0
    skipped = 0
    rows: list[tuple[str, str, str, float]] = []

    def handle(payload: bytes) -> None:
        nonlocal scanned, kept, skipped
        scanned += 1
        parsed = message_edges(payload)
        if parsed is None:
            skipped += 1
            return
        sender, edges, ts_iso = parsed
        for recipient, weight in edges:
            rows.append((sender, recipient, ts_iso, weight))
        kept += 1

    if EXTRACTED.is_dir():
        for path in sorted(EXTRACTED.rglob("*")):
            if path.is_file() and "." not in path.name:
                try:
                    handle(path.read_bytes())
                except OSError:
                    skipped += 1
        print(f"source=extracted dir {EXTRACTED}")
    elif TARBALL.exists():
        for payload in iter_tarball(TARBALL):
            handle(payload)
        print(f"source=tarball {TARBALL}")
    else:
        raise SystemExit(f"no Enron source: neither {EXTRACTED} nor {TARBALL} exists")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", newline="", encoding="utf-8") as handle_out:
        writer = csv.writer(handle_out)
        writer.writerow(["src", "dst", "ts", "weight"])
        writer.writerows(
            (src, dst, ts, f"{weight:.1f}") for src, dst, ts, weight in rows
        )

    nodes = {src for src, _, _, _ in rows} | {dst for _, dst, _, _ in rows}
    stamps = sorted({ts for _, _, ts, _ in rows})
    print(f"scanned={scanned} kept={kept} skipped={skipped} edges={len(rows)} nodes={len(nodes)}")
    if stamps:
        print(f"range={stamps[0]} .. {stamps[-1]}")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
