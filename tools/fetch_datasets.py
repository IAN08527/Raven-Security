"""M0-T7. Dataset licence audit and download scripts (S0, EVALUATION.md §1.1).

Every licence and status below was checked against the dataset's actual
source page on 2026-09-11, not guessed (CLAUDE.md rule 10). `--list` prints
licence and status for each entry; only entries with status OK actually
download anything. DROPPED entries have no fetch function at all -- S0's
decision rule is "anything without a clear licence is dropped, not used and
explained later," not stubbed and left half-working.
"""

from __future__ import annotations

import argparse
import sys
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DATASETS_DIR = REPO_ROOT / "eval" / "datasets"


class DatasetUnavailable(RuntimeError):
    """Raised by a stub instead of attempting a download."""


@dataclass(frozen=True)
class DatasetEntry:
    name: str
    status: str  # OK | STUB_REGISTRATION | STUB_LICENCE_CHECK | DROPPED
    licence: str
    note: str
    fetch: Callable[[], None] | None = None


def _target_dir(name: str) -> Path:
    return DATASETS_DIR / name


def fetch_police_uk() -> None:
    """OGL v3.0 (confirmed data.police.uk/about/, 2026-09-11): permissive,
    attribution required, commercial use and redistribution allowed, no
    registration. Saves the archive index; data.police.uk publishes monthly
    CSV archives rather than one fixed dataset URL, so picking which months
    to pull is a human decision, not this function's."""
    target = _target_dir("police-uk-street-crime")
    if target.exists() and any(target.iterdir()):
        print(f"police-uk-street-crime: already present at {target}, skipping")
        return
    target.mkdir(parents=True, exist_ok=True)
    index_url = "https://data.police.uk/data/"
    dest = target / "archives-index.html"
    print(f"police-uk-street-crime: fetching archive index from {index_url}")
    urllib.request.urlretrieve(index_url, dest)
    print(f"police-uk-street-crime: saved index to {dest}; pick and download the months you need")


def fetch_mmptrack() -> None:
    raise DatasetUnavailable(
        "MMPTrack requires a signed Terms & Conditions form emailed to "
        "iccv2021mmp@outlook.com (https://iccv2021-mmp.github.io/subpage/dataset.html) "
        "before any download link is issued. This cannot be automated; complete that "
        f"process yourself, then place the files under {_target_dir('mmptrack')}."
    )


def fetch_iam() -> None:
    raise DatasetUnavailable(
        "IAM Handwriting Database requires a free account at "
        "https://fki.tic.heia-fr.ch/databases/download-the-iam-handwriting-database "
        "(licence: free for non-commercial research use only). Register, accept the "
        f"terms, download manually, then place the files under {_target_dir('iam')}."
    )


def fetch_elliptic() -> None:
    raise DatasetUnavailable(
        "Elliptic Bitcoin transaction graph is CC BY-NC-ND 4.0 "
        "(https://www.kaggle.com/datasets/ellipticco/elliptic-data-set): non-commercial "
        "use only, no derivative redistribution. That conflicts with shipping a bundled "
        "or modified copy, so this is a deliberate manual gate, not an automation gap: "
        "confirm the NC/ND terms are acceptable for your use before fetching (via "
        "`kaggle datasets download ellipticco/elliptic-data-set`, which needs your own "
        f"Kaggle API credentials), then place the files under {_target_dir('elliptic')}."
    )


DATASETS: list[DatasetEntry] = [
    DatasetEntry(
        name="caviar",
        status="DROPPED",
        licence="none found",
        note=(
            "Hosted at the UCINET covert-networks collection "
            "(sites.google.com/site/ucinetsoftware/datasets/covert-networks/caviar). "
            "Page gives provenance (Montreal drug-trafficking trial transcripts) and a "
            "citation; no licence or terms-of-use statement anywhere."
        ),
    ),
    DatasetEntry(
        name="ndrangheta",
        status="DROPPED",
        licence="none found",
        note=(
            "Same UCINET collection (.../ndrangheta-mafia-2). Derived from Italian "
            "judicial documents (public record), but no licence or redistribution "
            "statement found on the page or elsewhere."
        ),
    ),
    DatasetEntry(
        name="wildtrack",
        status="DROPPED",
        licence="no licence stated",
        note=(
            "Canonical page (cvlab.epfl.ch/data/wildtrack, redirects to "
            "epfl.ch/labs/cvlab/data-wildtrack) 404'd during the M0-T7 audit. Rechecked "
            "2026-09-11 (M1-T8): the page is back online and describes the dataset with "
            "download links, but states no licence or terms of use anywhere. Only the "
            "companion analysis toolkit on GitHub is confirmed GPLv3, and that licenses "
            "the code, not the data. S0's decision rule still drops it."
        ),
    ),
    DatasetEntry(
        name="mmptrack",
        status="STUB_REGISTRATION",
        licence="research use only, signed Terms & Conditions required",
        note=(
            "iccv2021-mmp.github.io/subpage/dataset.html: requires downloading and "
            "emailing a signed T&C form to iccv2021mmp@outlook.com before a download "
            "link is issued. Full T&C text is not published online."
        ),
        fetch=fetch_mmptrack,
    ),
    DatasetEntry(
        name="market-1501",
        status="DROPPED",
        licence="unverifiable: official host is dead",
        note=(
            "Original homepage (liangzheng.org) is now a parked domain. The Kaggle "
            "mirror (pengcw1/market-1501) and Academic Torrents both list no licence "
            "field. No formal licence text locatable anywhere despite being a "
            "widely-used benchmark."
        ),
    ),
    DatasetEntry(
        name="msmt17",
        status="DROPPED",
        licence="unverifiable: official host is dead",
        note=(
            "Official host (pkuvmc.com/publications/msmt17.html) returned 404. "
            "Secondary sources reference 'complying with all licenses of MSMT17' "
            "without quoting actual terms; no independently verifiable licence."
        ),
    ),
    DatasetEntry(
        name="iiit-indic-hw-words",
        status="DROPPED",
        licence="unverifiable: gated behind download",
        note=(
            "cvit.iiit.ac.in/research/projects/cvit-projects/iiit-indic-hw-words states "
            "terms are 'in the README file' inside the downloadable zip -- not "
            "independently verifiable without downloading first."
        ),
    ),
    DatasetEntry(
        name="iam",
        status="STUB_REGISTRATION",
        licence="free for non-commercial research use only, registration required",
        note=(
            "fki.tic.heia-fr.ch/databases/download-the-iam-handwriting-database "
            "confirms 'freely available for non-commercial research purposes'; account "
            "required at fki.inf.unibe.ch."
        ),
        fetch=fetch_iam,
    ),
    DatasetEntry(
        name="elliptic",
        status="STUB_LICENCE_CHECK",
        licence="CC BY-NC-ND 4.0",
        note=(
            "kaggle.com/datasets/ellipticco/elliptic-data-set: "
            "Attribution-NonCommercial-NoDerivatives. Licence is clear but "
            "restrictive -- no commercial use, no redistribution of modified copies -- "
            "so fetching is a deliberate manual gate."
        ),
        fetch=fetch_elliptic,
    ),
    DatasetEntry(
        name="police-uk-street-crime",
        status="OK",
        licence="Open Government Licence v3.0",
        note=(
            "data.police.uk/about/ states 'licence: Open Government Licence v3.0'. "
            "Permissive: attribution required, commercial use and redistribution "
            "allowed, no registration."
        ),
        fetch=fetch_police_uk,
    ),
]


def print_table() -> None:
    name_w = max(len(d.name) for d in DATASETS)
    status_w = max(len(d.status) for d in DATASETS)
    licence_w = max(len(d.licence) for d in DATASETS)
    header = f"{'Dataset':<{name_w}}  {'Status':<{status_w}}  {'Licence':<{licence_w}}"
    print(header)
    print("-" * len(header))
    for d in DATASETS:
        print(f"{d.name:<{name_w}}  {d.status:<{status_w}}  {d.licence:<{licence_w}}")
        print(f"{'':<{name_w}}  note: {d.note}")


def fetch_all() -> int:
    exit_code = 0
    for entry in DATASETS:
        if entry.fetch is None:
            continue
        try:
            entry.fetch()
        except DatasetUnavailable as e:
            print(f"{entry.name}: SKIPPED -- {e}", file=sys.stderr)
            exit_code = 1
    return exit_code


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Raven dataset licence audit and fetcher (M0-T7).")
    parser.add_argument("--list", action="store_true", help="Print the licence/status table and exit.")
    args = parser.parse_args(argv)

    if args.list:
        print_table()
        return 0

    return fetch_all()


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
