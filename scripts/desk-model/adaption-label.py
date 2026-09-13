#!/usr/bin/env python3
"""Label the desk-data pack for *attention* with Adaption Labs' Adaptive Data.

The pack's own `distracted` class ("person on phone / looking away") is mostly
phone product shots, crowds and street scenes, and a few of its images show
people plainly working. It cannot train "is the person at the desk on their
phone". This script asks Adaptive Data to look at every image and say what is
actually in it; `train-attention.ts` then fits an on-device head on the answers.

    python scripts/desk-model/adaption-label.py build  --name main            # no network
    python scripts/desk-model/adaption-label.py submit --name main            # upload + free estimate
    python scripts/desk-model/adaption-label.py submit --name main --go       # spends credits
    python scripts/desk-model/adaption-label.py fetch  --name main            # poll, download, parse
    python scripts/desk-model/adaption-label.py build  --name v3 --exclude-run main   # only new images
    python scripts/desk-model/adaption-label.py export --name main v3         # merge runs into the CSV

Offline and developer-run, like scripts/adaption-upload.py. The Electron app
never calls Adaption and never reads the key: only the trained weights ship.
Images are sent without their filenames (which contain the pack label), so the
annotator cannot copy the answer.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parents[2]
IMAGE_SIDE = 512

PROMPT = """You are labelling one photo for a classifier that watches a student through a desk webcam. It must tell whether they are focused on their work, distracted by their phone, or unfocused.

Look only at the attached image. Reply with exactly one JSON object and nothing else:
{"id": "<copy the id field>", "person": "face_or_body" | "hands_only" | "none", "workspace": true | false, "phone": "in_use" | "idle" | "none", "attention": "work" | "phone" | "camera" | "elsewhere" | "unclear", "note": "<at most 12 words>"}

Definitions:
- person: "face_or_body" if any part of a person above the hands is visible; "hands_only" if only hands or arms; "none" if no person.
- workspace: true if the main person is at a desk, table, computer or study surface.
- phone: "in_use" if the main person holds a phone while looking at it, typing on it, or talking on it; "idle" if a phone is visible but not being used; "none" otherwise. A tablet, e-reader, smartwatch or VR headset is not a phone.
- attention, for the main person: "work" if their face or eyes are directed at a laptop, monitor, tablet, book, notebook or paper; "phone" if directed at a phone; "camera" if they look straight into the camera (a desk webcam sits on the screen, so this is NOT looking away); "elsewhere" if they look away from any work (at another person, out of frame, into the distance, eyes closed, head in hands); "unclear" if it cannot be judged.
If several people are visible, judge the most prominent one. Do not guess beyond what is visible."""

BLUEPRINT = "Reply with a single JSON object that follows the schema in the instruction. No prose, no markdown fences."


def load_env_file(path: Path = ROOT / ".env") -> None:
    """Fold .env into the environment. Values are read, never printed."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def data_root() -> Path:
    root = os.environ.get("FOCUSPLUG_DESK_DATA")
    if not root or not (Path(root) / "labels.json").exists():
        sys.exit("FOCUSPLUG_DESK_DATA must point at the extracted focusplug-desk-data pack.")
    return Path(root)


def work_dir(name: str) -> Path:
    path = data_root() / ".cache" / "attention" / name
    path.mkdir(parents=True, exist_ok=True)
    return path


def opaque_id(pack_path: str) -> str:
    return "img_" + hashlib.sha256(pack_path.encode()).hexdigest()[:12]


def client():
    load_env_file()
    if not os.environ.get("ADAPTION_API_KEY"):
        sys.exit("ADAPTION_API_KEY is not set. Put it in .env (see .env.example).")
    from adaption import Adaption

    return Adaption(api_key=os.environ["ADAPTION_API_KEY"])


def cmd_build(args: argparse.Namespace) -> None:
    import random

    import pyarrow as pa
    import pyarrow.parquet as pq
    from PIL import Image

    root = data_root()
    pack = json.loads((root / "labels.json").read_text(encoding="utf-8"))
    items = [item for item in pack["items"] if item["bucket"] in args.bucket]
    # Never pay twice: skip images an earlier run already labelled.
    labelled = {
        json.loads(line)["id"]
        for run in args.exclude_run
        for line in (work_dir(run) / "labels.jsonl").read_text(encoding="utf-8").splitlines()
        if line
    }
    items = [item for item in items if opaque_id(item["path"]) not in labelled]
    if args.limit:
        items = random.Random(args.seed).sample(items, min(args.limit, len(items)))

    ids, images, key = [], [], []
    for item in items:
        with Image.open(root / item["path"]) as image:
            image = image.convert("RGB")
            image.thumbnail((IMAGE_SIDE, IMAGE_SIDE))
            buffer = io.BytesIO()
            image.save(buffer, "JPEG", quality=85)
        image_id = opaque_id(item["path"])
        ids.append(image_id)
        images.append({"bytes": buffer.getvalue(), "path": None})
        key.append({"id": image_id, "path": item["path"], "label": item["label"], "split": item["split"]})

    image_type = pa.struct([("bytes", pa.binary()), ("path", pa.string())])
    table = pa.table({"id": pa.array(ids), "image": pa.array(images, type=image_type)})
    out = work_dir(args.name)
    pq.write_table(table, out / "images.parquet")
    # The key (with pack labels) never leaves the machine.
    (out / "key.json").write_text(json.dumps(key, indent=1), encoding="utf-8")
    size_mb = (out / "images.parquet").stat().st_size / 1_048_576
    print(f"built {len(ids)} rows ({size_mb:.1f} MB) -> {out}")


def run_kwargs(name: str) -> dict:
    return {
        "column_mapping": {"universal_prompt": PROMPT, "context": ["id", "image"], "image": "image"},
        "recipe_specification": {
            "recipes": {"prompt_rephrase": False, "deduplication": False, "reasoning_traces": False}
        },
        "brand_controls": {"length": "minimal", "hallucination_mitigation": False, "blueprint": BLUEPRINT},
        "training_type": "instruction_dataset",
        "job_specification": {"idempotency_key": f"focusplug-attention-{name}"},
    }


def cmd_submit(args: argparse.Namespace) -> None:
    import httpx

    out = work_dir(args.name)
    parquet = out / "images.parquet"
    state_file = out / "submit.json"
    if not parquet.exists():
        sys.exit(f"{parquet} missing — run build first.")
    api = client()
    state = json.loads(state_file.read_text()) if state_file.exists() else {}

    if "dataset_id" not in state:
        started = api.datasets.upload.initiate(name=f"focusplug-attention-{args.name}", file_format="parquet")
        # initiate returns only the presigned URL; the s3 key is its path.
        s3_key = unquote(urlparse(started.upload_url).path).lstrip("/")
        body = parquet.read_bytes()
        put = httpx.put(started.upload_url, content=body, timeout=600)
        if put.status_code >= 300:
            sys.exit(f"upload PUT failed {put.status_code}: {put.text[:400]}")
        done = api.datasets.upload.complete(
            s3_key=s3_key,
            name=f"focusplug-attention-{args.name}",
            file_format="parquet",
            file_size_bytes=len(body),
        )
        state["dataset_id"] = getattr(done, "dataset_id", None) or getattr(done, "id")
        state_file.write_text(json.dumps(state, indent=1))
        print(f"uploaded dataset {state['dataset_id']}")

    dataset_id = state["dataset_id"]
    status = wait_for(api, dataset_id, {"awaiting_input", "succeeded", "failed"}, "ingest")
    if status.status != "awaiting_input" and not args.go:
        print(f"dataset is {status.status}; nothing to estimate")
        return

    quote = api.datasets.run(dataset_id, estimate=True, **run_kwargs(args.name))
    extra = getattr(quote, "model_extra", None) or {}
    print(
        f"estimate: {quote.estimated_credits_consumed} credits, ~{quote.estimated_minutes} min, "
        f"multimodal={quote.multimodal_pricing_applied}, available={extra.get('available_credits', '?')}"
    )
    if not args.go:
        print("dry run — re-run with --go to start the job")
        return
    started = api.datasets.run(dataset_id, **run_kwargs(args.name))
    state["run_id"] = getattr(started, "run_id", None)
    state_file.write_text(json.dumps(state, indent=1))
    print(f"started run {state['run_id']} — `fetch --name {args.name}` when it finishes")


def wait_for(api, dataset_id: str, terminal: set[str], label: str, poll: float = 15.0):
    while True:
        status = api.datasets.get_status(dataset_id)
        progress = status.progress.percent if status.progress else None
        print(f"  {label}: {status.status}" + (f" {progress}%" if progress is not None else ""), flush=True)
        if status.status in terminal:
            if status.error_data:
                print(f"  error: {status.error_data.message}")
            return status
        time.sleep(poll)


JSON_OBJECT = re.compile(r"\{[^{}]*\"phone\"[^{}]*\}", re.S)


def find_answer(row: dict) -> dict | None:
    """The completion lives under a pipeline-chosen key; take the last JSON object that names `phone`."""
    found = None
    for value in row.values():
        if not isinstance(value, str):
            continue
        for match in JSON_OBJECT.finditer(value):
            try:
                candidate = json.loads(match.group(0))
            except json.JSONDecodeError:
                continue
            if isinstance(candidate, dict) and "attention" in candidate:
                found = candidate
    return found


def cmd_fetch(args: argparse.Namespace) -> None:
    out = work_dir(args.name)
    state = json.loads((out / "submit.json").read_text())
    api = client()
    status = wait_for(api, state["dataset_id"], {"succeeded", "failed"}, "run", poll=30.0)
    raw = api.datasets.download(state["dataset_id"], file_format="jsonl").read().decode("utf-8")
    (out / "raw.jsonl").write_text(raw, encoding="utf-8")

    key = {entry["id"]: entry for entry in json.loads((out / "key.json").read_text())}
    labels, unparsed = {}, 0
    for line in raw.splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        answer = find_answer(row)
        image_id = (answer or {}).get("id") or row.get("id")
        if not answer or image_id not in key:
            unparsed += 1
            continue
        labels[image_id] = {**key[image_id], "adaption": answer}
    with (out / "labels.jsonl").open("w", encoding="utf-8") as handle:
        for entry in labels.values():
            handle.write(json.dumps(entry) + "\n")
    missing = len(key) - len(labels)
    print(f"{status.status}: {len(labels)} labelled, {unparsed} unparsed rows, {missing} images without a label")


def attention_class(answer: dict) -> str | None:
    """Collapse one annotation into the head's classes; None = not a usable attention example."""
    person = answer.get("person")
    if person == "none":
        return None
    if answer.get("phone") == "in_use" or answer.get("attention") == "phone":
        return "phone"
    if person != "face_or_body":
        return None
    if answer.get("attention") == "work":
        return "focused"
    if answer.get("attention") == "elsewhere" and answer.get("workspace") is True:
        return "unfocused"
    return None


def dhash(path: Path, side: int = 8) -> int:
    from PIL import Image

    with Image.open(path) as image:
        pixels = image.convert("L").resize((side + 1, side), Image.LANCZOS).tobytes()
    bits = 0
    for row in range(side):
        for col in range(side):
            offset = row * (side + 1) + col
            bits = (bits << 1) | int(pixels[offset] > pixels[offset + 1])
    return bits


def cmd_export(args: argparse.Namespace) -> None:
    """Write the committed label file, with near-duplicates kept on one side of the split.

    The pack reuses stock photos under different filenames, sometimes across
    train and eval. A group of near-duplicates (dHash within 6 bits) goes to
    eval if any member is a pack eval image, so train never holds a copy of an
    eval image.
    """
    import csv

    root = data_root()
    # Later runs win for an image labelled twice.
    by_id: dict[str, dict] = {}
    for name in args.name:
        for line in (work_dir(name) / "labels.jsonl").read_text(encoding="utf-8").splitlines():
            if line:
                entry = json.loads(line)
                by_id[entry["id"]] = entry
    entries = list(by_id.values())
    hashes = [dhash(root / entry["path"]) for entry in entries]
    parent = list(range(len(entries)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for a in range(len(entries)):
        for b in range(a + 1, len(entries)):
            if bin(hashes[a] ^ hashes[b]).count("1") <= 6:
                parent[find(a)] = find(b)
    groups: dict[int, list[int]] = {}
    for i in range(len(entries)):
        groups.setdefault(find(i), []).append(i)

    out = ROOT / "datasets" / "desk-attention-labels.csv"
    fields = ["path", "split", "group", "attention", "person", "workspace", "phone", "gaze", "note", "pack_label"]
    counts: dict[tuple[str, str], int] = {}
    with out.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for members in sorted(groups.values(), key=lambda m: min(entries[i]["id"] for i in m)):
            split = "eval" if any(entries[i]["split"] == "eval" for i in members) else "train"
            group = min(entries[i]["id"] for i in members)
            for i in sorted(members, key=lambda i: entries[i]["path"]):
                entry, answer = entries[i], entries[i]["adaption"]
                attention = attention_class(answer) or ""
                counts[(split, attention or "-")] = counts.get((split, attention or "-"), 0) + 1
                writer.writerow({
                    "path": entry["path"], "split": split, "group": group, "attention": attention,
                    "person": answer.get("person", ""), "workspace": answer.get("workspace", ""),
                    "phone": answer.get("phone", ""), "gaze": answer.get("attention", ""),
                    "note": answer.get("note", ""), "pack_label": entry["label"],
                })
    moved = sum(1 for m in groups.values() for i in m if entries[i]["split"] == "train" and any(entries[j]["split"] == "eval" for j in m))
    print(f"wrote {out.relative_to(ROOT)}: {len(entries)} images, {len(groups)} groups, {moved} train images moved to eval")
    for key in sorted(counts):
        print(f"  {key[0]:5} {key[1]:9} {counts[key]}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    build = sub.add_parser("build")
    build.add_argument("--name", required=True)
    build.add_argument("--bucket", nargs="+", default=["main"])
    build.add_argument("--limit", type=int, default=0)
    build.add_argument("--seed", type=int, default=7)
    build.add_argument("--exclude-run", nargs="*", default=[], help="skip images these runs already labelled")
    submit = sub.add_parser("submit")
    submit.add_argument("--name", required=True)
    submit.add_argument("--go", action="store_true", help="start the job; without it only the free estimate runs")
    fetch = sub.add_parser("fetch")
    fetch.add_argument("--name", required=True)
    export = sub.add_parser("export")
    export.add_argument("--name", required=True, nargs="+", help="one or more runs to merge")
    args = parser.parse_args()
    {"build": cmd_build, "submit": cmd_submit, "fetch": cmd_fetch, "export": cmd_export}[args.command](args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
