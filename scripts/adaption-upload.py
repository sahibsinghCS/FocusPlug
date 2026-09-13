#!/usr/bin/env python3
"""Send the exported drift dataset to Adaption Labs' Adaptive Data, and bring
the improved version back.

    npm run dataset:adapt                 # writes datasets/focusplug-drifts.csv
    pip install adaption
    python scripts/adaption-upload.py     # dry run: shows what it would send
    python scripts/adaption-upload.py --go # actually spends credits

Then score whatever comes back against the model that has to use it:

    npm run prior:adapt -- datasets/focusplug-drifts.improved.csv

This script lives outside the Electron app on purpose. FocusPlug itself makes no
network calls for the adaptive fuse — it learns on-device from drifts it already
sees. This is an offline, developer-run step on an exported file.

FIT WARNING — read before spending credits. The SDK surface below now matches
docs.adaptionlabs.ai/api/python (client `Adaption`, `ADAPTION_API_KEY`,
`datasets.upload.initiate` / `complete`, `datasets.create`, `datasets.augment`,
`datasets.get_status`, `datasets.download`). What is *not* settled is whether
this dataset belongs there at all: Adaptive Data is documented as a platform for
**text, documents and images**, and its recipe library — deduplication, prompt
rephrasing, reasoning-trace generation — is text work. This file is seventeen
columns of numeric behavioural telemetry, with no prompt column and no natural
language in it.

So treat a failure here as "this dataset is the wrong shape for this product",
not "the call is wrong". The local fit (`npm run prior:adapt`) already improves
the prior for free; run that first and make Adaption clear that bar to be worth
paying for.
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT = ROOT / "datasets" / "focusplug-drifts.csv"
DEFAULT_OUTPUT = ROOT / "datasets" / "focusplug-drifts.improved.csv"


def load_env_file(path: Path = ROOT / ".env") -> None:
    """Fold .env into the environment so the key never has to be typed at a prompt.

    Values are read, never printed. Anything already exported wins, so a shell
    variable still overrides the file.
    """
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def describe(path: Path) -> None:
    """Print what is in the file before offering to send it anywhere."""
    with path.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))

    recovered = sum(1 for row in rows if row.get("recovered_after_sec"))
    cohorts = sorted({row.get("cohort", "") for row in rows})

    print(f"  file      {path.relative_to(ROOT)}  ({path.stat().st_size / 1_048_576:.1f} MB)")
    print(f"  rows      {len(rows)}")
    print(f"  recovered {recovered} ({recovered / max(1, len(rows)) * 100:.1f}%)")
    print(f"  censored  {len(rows) - recovered} — fuse fired first, outcome unknown")
    print(f"  cohorts   {', '.join(cohorts)}")
    print()
    print("  Every row is simulated. No real student's data is in this file, and")
    print("  nothing about a real install is uploaded by the app itself.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--go",
        action="store_true",
        help="actually upload. Without it this is a dry run that spends nothing.",
    )
    args = parser.parse_args()

    if not args.input.exists():
        print(f"{args.input} does not exist — run `npm run dataset:adapt` first.")
        return 1

    print("ADAPTIVE DATA UPLOAD")
    print()
    describe(args.input)

    if not args.go:
        print("\n  Dry run. Re-run with --go to upload and spend credits.")
        return 0

    load_env_file()
    api_key = os.environ.get("ADAPTION_API_KEY")
    if not api_key:
        print("\nADAPTION_API_KEY is not set. Put it in .env (see .env.example) or export it.")
        return 1

    try:
        from adaption import Adaption
    except ImportError:
        print("\n`pip install adaption` first.")
        return 1

    client = Adaption(api_key=api_key)

    print(f"\n  uploading {args.input.name} ...")
    # Two-step upload per docs.adaptionlabs.ai/api/python: initiate, then
    # complete. Both names are documented; their exact kwargs are not, so a
    # TypeError here means the signature moved, not that the file is bad.
    started = client.datasets.upload.initiate(filename=args.input.name)
    upload_id = getattr(started, "upload_id", None) or getattr(started, "id", None)
    with args.input.open("rb") as handle:
        client.datasets.upload.complete(upload_id, file=handle)

    dataset = client.datasets.create(upload_id=upload_id, name=args.input.stem)
    dataset_id = getattr(dataset, "dataset_id", None) or getattr(dataset, "id", None)
    print(f"  dataset_id {dataset_id}")

    print("  running the adaptation job ...")
    client.datasets.augment(dataset_id)

    status = client.datasets.get_status(dataset_id)
    print(f"  status     {status}")
    evaluation = getattr(status, "evaluation_summary", None)
    if evaluation is not None:
        print(f"  evaluation {evaluation}")

    url = client.datasets.download(dataset_id)
    print(f"\n  improved dataset: {url}")
    print(f"  save it to {args.output.relative_to(ROOT)}, then:")
    print(f"    npm run prior:adapt -- {args.output.relative_to(ROOT)}")
    print()
    print("  That comparison is the point. A dataset is only better if the held-out")
    print("  log-loss moves; if it does not, do not paste the weights into model.ts.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
