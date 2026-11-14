#!/usr/bin/env python3
"""Turn the "Words" tab of the CAT sheet into words.json for the app.

Input is either the tab's published CSV (a URL or a local .csv file) or a
local .json file holding the tab as a list of rows (what the Sheets API
returns). Column A is the word, column B is the AI-written blob
("Meaning: … / Hindi Word: … / Daily Life Example: …"), and anything in
later columns is a personal note (or a pronunciation if it looks like /…/).

Rows with no word, or no meaning yet (the =AI() cell still empty), are
skipped, so a half-added word simply shows up on the next sync.

Usage:
  python3 tools/build_words.py <csv-url | file.csv | rows.json> [out=words.json]
"""

import csv
import io
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone

LABELS = [
    ("meaning", re.compile(r"^\**\s*meaning\s*\**\s*[:\-–]\s*", re.I)),
    ("hindi", re.compile(r"^\**\s*hindi(\s+word)?\s*\**\s*[:\-–]\s*", re.I)),
    ("example", re.compile(r"^\**\s*(daily\s*(life)?\s*)?ex(ample)?\.?\s*\**\s*[:\-–]\s*", re.I)),
]


def key_of(word):
    return re.sub(r"\s+", " ", word.strip().lower())


def parse_blob(text):
    out = {"meaning": "", "hindi": "", "example": "", "notes": []}
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        for name, rx in LABELS:
            if rx.match(line):
                out[name] = rx.sub("", line).strip().strip("*").strip()
                break
        else:
            # Any unlabelled line is something you typed under the AI text.
            out["notes"].append(line)
    return out


def load_rows(src):
    if src.startswith("http"):
        req = urllib.request.Request(src, headers={"User-Agent": "wordstreak-sync"})
        with urllib.request.urlopen(req, timeout=30) as r:
            text = r.read().decode("utf-8")
        return list(csv.reader(io.StringIO(text)))
    if src.endswith(".json"):
        with open(src, encoding="utf-8") as f:
            data = json.load(f)
        return data.get("values", data) if isinstance(data, dict) else data
    with open(src, encoding="utf-8", newline="") as f:
        return list(csv.reader(f))


def build(rows):
    words, seen = [], {}
    for row in rows:
        row = list(row) + [""] * 2
        word = (row[0] or "").strip()
        body = (row[1] or "").strip()
        if not word or "meaning" not in body.lower():
            continue
        card = parse_blob(body)
        if not card["meaning"]:
            continue
        pron = ""
        for extra in row[2:]:
            extra = (extra or "").strip()
            if not extra:
                continue
            if extra.startswith("/") and extra.endswith("/"):
                pron = extra
            else:
                card["notes"].append(extra)
        k = key_of(word)
        if k in seen:  # same word added twice: keep the first, keep the extra notes
            first = seen[k]
            for n in card["notes"]:
                if n not in first["notes"]:
                    first["notes"].append(n)
            continue
        entry = {
            "id": k,
            "word": word,
            "meaning": card["meaning"],
            "hindi": card["hindi"],
            "example": card["example"],
            "notes": card["notes"],
        }
        if pron:
            entry["pron"] = pron
        seen[k] = entry
        words.append(entry)
    return words


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    out = sys.argv[2] if len(sys.argv) > 2 else "words.json"
    words = build(load_rows(sys.argv[1]))
    if not words:
        sys.exit("No words parsed - refusing to overwrite words.json with an empty list.")
    try:
        with open(out, encoding="utf-8") as f:
            old = json.load(f)
    except (OSError, ValueError):
        old = {}
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    changed = old.get("words") != words
    # "checked" moves on every run (and keeps the scheduled workflow alive);
    # "updated" only moves when the word list itself changed.
    payload = {
        "updated": now if changed else old.get("updated", now),
        "checked": now,
        "count": len(words),
        "words": words,
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"Wrote {len(words)} words to {out} ({'changed' if changed else 'no change'}).")


if __name__ == "__main__":
    main()
