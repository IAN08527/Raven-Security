"""Select 20 Enron emails for the S4 annotation set (M4-T6, Session 10).

Reads the CMU tarball (eval/datasets/enron/, gitignored, pulled once --
a partial download suffices: maildir members stream alphabetically and
only leading members are needed). Writes eval/splits/s4_enron_20.json:
[{id, text, source, provenance}] with provenance "benchmark" (real
public-record signal, D19/Corpus A). Annotation (spans) is Session 10's
human task; this script selects TEXT only.

Selection rules, all documented so the set is reproducible:
- plain single messages, 300-4000 chars (headers + body; headers carry
  address identifiers, bodies carry names/orgs/phones);
- NER density: a phone-like digit run, or 3+ capitalized tokens;
- at most 3 emails per user mailbox (diversity across senders);
- privacy (CMU distributor's explicit request): skip subjects matching
  family/health/legal-personal patterns, skip empty bodies.
"""

from __future__ import annotations

import argparse
import json
import re
import tarfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
TARBALL = REPO_ROOT / "eval" / "datasets" / "enron" / "enron_mail_20150507.tar.gz"
OUT_PATH = REPO_ROOT / "eval" / "splits" / "s4_enron_20.json"

WANT = 20
MAX_CHARS = 3000
MAX_PER_USER = 3
MAX_PER_SENDER = 2

PHONE_RE = re.compile(r"(\+?1[-.\s]?)?(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|\d{10,})")
CAPITALIZED_RE = re.compile(r"\b[A-Z][a-z]{2,}\b")
SUBJECT_RE = re.compile(r"^Subject:\s*(.*)$", re.MULTILINE | re.IGNORECASE)
FROM_RE = re.compile(r"^From:\s*(.*)$", re.MULTILINE | re.IGNORECASE)

# Vendor blasts, hobby mail and outright spam pass the density filter
# (brand names are capitalized) but carry almost no annotatable persons,
# phones or locations -- the stated NER targets. Excluded by subject so
# the set stays realistic rather than merely dense.
WEAK_SUBJECT_RE = re.compile(
    r"fantasy|newsletter|news from|fantastic gift|unsubscribe|"
    r"sweepstakes|viagra|mortgage|refinance|free money|click here",
    re.IGNORECASE,
)

# CMU asks users to be sensitive to the privacy of the people involved:
# family, health and legal-personal mail is out even when public.
PRIVATE_SUBJECT_RE = re.compile(
    r"birthday|doctor|hospital|funeral|divorce|wedding|baby|medical|"
    r"prescription|therapy|obituary|christmas|thanksgiving.*famil|eulogy",
    re.IGNORECASE,
)


def split_body(raw: str) -> tuple[str, str, str]:
    """Return (subject, sender, text). Text is the full raw message: the
    Session 10 annotator works on exactly these bytes."""
    subject = SUBJECT_RE.search(raw)
    sender = FROM_RE.search(raw)
    return (
        subject.group(1).strip() if subject else "(no subject)",
        sender.group(1).strip() if sender else "(unknown sender)",
        raw,
    )


def acceptable(raw: str) -> tuple[bool, str, str]:
    """Return (ok, subject, sender). Weak-subject and private mail are
    out before the density check so the set stays annotatable."""
    subject_match = SUBJECT_RE.search(raw)
    subject = subject_match.group(1).strip() if subject_match else ""
    sender_match = FROM_RE.search(raw)
    sender = sender_match.group(1).strip() if sender_match else ""
    if not 300 <= len(raw) <= 4000:
        return False, subject, sender
    if PRIVATE_SUBJECT_RE.search(subject) or WEAK_SUBJECT_RE.search(subject):
        return False, subject, sender
    if PHONE_RE.search(raw):
        return True, subject, sender
    return len(CAPITALIZED_RE.findall(raw)) >= 3, subject, sender


def iter_messages(tarball: Path):
    """Yield (user, raw) in archive order, stopping at the first
    truncation error (partial downloads end mid-stream; leading members
    are intact and independently usable)."""
    try:
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
                    raw = extracted.read().decode("utf-8", errors="replace")
                except (EOFError, OSError):
                    break
                yield parts[1], raw
    except (FileNotFoundError, tarfile.TarError) as exc:
        raise SystemExit(f"cannot read {tarball}: {exc}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=WANT)
    args = parser.parse_args()

    chosen: list[dict[str, str]] = []
    per_user: dict[str, int] = {}
    per_sender: dict[str, int] = {}
    scanned = 0
    for user, raw in iter_messages(TARBALL):
        scanned += 1
        if len(chosen) >= args.limit:
            break
        if per_user.get(user, 0) >= MAX_PER_USER:
            continue
        ok, subject, sender = acceptable(raw)
        if not ok:
            continue
        if per_sender.get(sender, 0) >= MAX_PER_SENDER:
            continue
        _, _, text = split_body(raw)
        per_user[user] = per_user.get(user, 0) + 1
        per_sender[sender] = per_sender.get(sender, 0) + 1
        chosen.append(
            {
                "id": f"enron-s4-{len(chosen) + 1:02d}",
                "text": text[:MAX_CHARS],
                "source": "enron",
                "provenance": "benchmark",
                "mailbox": user,
                "subject": subject,
                "sender": sender,
            }
        )
    if len(chosen) < args.limit:
        raise SystemExit(f"only {len(chosen)} acceptable messages in {scanned} scanned; aborting")

    payload = {
        "experiment": "S4",
        "dataset": "enron-s4-20",
        "split": "s4-annotation-set",
        "provenance": "benchmark",
        "note": (
            "20 real Enron emails (CMU 2015-05-07 corpus, FERC public record, "
            "research distribution with privacy-sensitivity request) selected by "
            "tools/select_s4_enron.py for hand annotation in Session 10. Text "
            "unmodified except a 3000-char cap. NOT annotated yet: no spans, no "
            "metrics computed over this file (rule 4/10)."
        ),
        "rows": [
            {"id": item["id"], "text": item["text"], "source": "enron", "provenance": "benchmark"}
            for item in chosen
        ],
    }
    OUT_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"scanned={scanned} selected={len(chosen)} users={len(per_user)} -> {OUT_PATH}")
    for item in chosen:
        print(f"- {item['id']} [{item['mailbox']}] from={item['sender'][:40]!r} subj={item['subject'][:60]!r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
