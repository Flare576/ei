#!/usr/bin/env python3
"""
DRY RUN: Backfill sources on human topics/people from OpenCode quotes.

Loads all text parts from OpenCode SQLite into memory first, then does
in-Python matching — avoids 3,710 full table scans.
"""

import json
import sqlite3
import os
import sys
from datetime import datetime, timezone
from collections import defaultdict

STATE_FILE = os.path.expanduser("~/.local/share/ei/state.json")
OC_DB = os.path.expanduser("~/.local/share/opencode/opencode.db")

SKIP_CHANNELS = {"Beta", "Lena", "Ei", "DJ"}
TIMESTAMP_TOLERANCE_MS = 90_000


def ts_to_ms(iso):
    try:
        return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000)
    except Exception:
        return None


def main():
    print(f"\n=== DRY RUN: Backfill Sources ===")
    print(f"State:  {STATE_FILE}")
    print(f"OC DB:  {OC_DB}\n")

    state = json.loads(open(STATE_FILE).read())
    human = state["human"]
    quotes = human.get("quotes", [])
    topic_by_id = {t["id"]: t for t in human.get("topics", [])}
    person_by_id = {p["id"]: p for p in human.get("people", [])}

    candidates = [
        q for q in quotes
        if not q.get("message_id")
        and q.get("data_item_ids")
        and q.get("channel") not in SKIP_CHANNELS
    ]
    print(f"Candidate quotes: {len(candidates)}")

    print("Loading OpenCode text parts into memory...", file=sys.stderr)
    db = sqlite3.connect(OC_DB)
    rows = db.execute(
        "SELECT session_id, data FROM part WHERE data LIKE '{\"type\":\"text\"%'"
    ).fetchall()
    db.close()

    text_parts = []
    for session_id, data_str in rows:
        try:
            data = json.loads(data_str)
        except Exception:
            continue
        if data.get("type") != "text":
            continue
        text = data.get("text", "")
        part_ms = (data.get("time") or {}).get("start", 0)
        if text:
            text_parts.append((session_id, text, part_ms))

    print(f"Loaded {len(text_parts)} text parts from OpenCode DB.", file=sys.stderr)

    item_sources = defaultdict(set)
    stats = defaultdict(int)

    for i, q in enumerate(candidates):
        if (i + 1) % 500 == 0:
            print(f"  Matching {i+1}/{len(candidates)}...", file=sys.stderr)

        quote_text = (q.get("text") or "").strip()
        if len(quote_text) < 10:
            stats["too_short"] += 1
            continue

        anchor = quote_text[:100]
        quote_ms = ts_to_ms(q.get("timestamp", ""))

        matches = [
            (sid, part_ms)
            for sid, text, part_ms in text_parts
            if anchor in text
        ]

        if not matches:
            stats["not_found"] += 1
            continue

        if len(matches) == 1:
            session_id = matches[0][0]
            stats["exact"] += 1
        elif quote_ms is None:
            stats["ambiguous_no_ts"] += 1
            continue
        else:
            best_sid, best_diff = None, float("inf")
            for sid, part_ms in matches:
                diff = abs(part_ms - quote_ms)
                if diff < best_diff:
                    best_diff = diff
                    best_sid = sid
            if best_diff <= TIMESTAMP_TOLERANCE_MS:
                session_id = best_sid
                stats["disambiguated"] += 1
            else:
                stats["ambiguous"] += 1
                continue

        source = f"opencode:{session_id}"
        for item_id in q["data_item_ids"]:
            item_sources[item_id].add(source)

    print(f"  Done.\n", file=sys.stderr)

    print(f"--- Match Results ---")
    for key, count in sorted(stats.items(), key=lambda x: -x[1]):
        print(f"  {key:30s}: {count}")

    topic_results = []
    person_results = []

    for item_id, new_sources in item_sources.items():
        if item_id in topic_by_id:
            t = topic_by_id[item_id]
            existing = set(t.get("sources") or [])
            adding = len(new_sources - existing)
            if adding:
                topic_results.append({
                    "name": t["name"], "category": t.get("category", ""),
                    "existing": len(existing), "adding": adding,
                    "total": len(existing) + adding,
                })
        elif item_id in person_by_id:
            p = person_by_id[item_id]
            existing = set(p.get("sources") or [])
            adding = len(new_sources - existing)
            if adding:
                person_results.append({
                    "name": p["name"], "relationship": p.get("relationship", ""),
                    "existing": len(existing), "adding": adding,
                    "total": len(existing) + adding,
                })

    topic_results.sort(key=lambda x: -x["total"])
    person_results.sort(key=lambda x: -x["total"])

    print(f"\n=== TOPICS ({len(topic_results)} would be updated) ===")
    print(f"{'Name':<55} {'Cat':<12} {'Exist':>5} {'Add':>5} {'Total':>6}")
    print("-" * 87)
    for t in topic_results:
        name = t["name"][:54] if len(t["name"]) > 54 else t["name"]
        print(f"{name:<55} {t['category']:<12} {t['existing']:>5} {t['adding']:>5} {t['total']:>6}")

    print(f"\n=== PEOPLE ({len(person_results)} would be updated) ===")
    print(f"{'Name':<30} {'Relationship':<22} {'Exist':>5} {'Add':>5} {'Total':>6}")
    print("-" * 70)
    for p in person_results:
        name = p["name"][:29] if len(p["name"]) > 29 else p["name"]
        print(f"{name:<30} {p['relationship']:<22} {p['existing']:>5} {p['adding']:>5} {p['total']:>6}")

    thick = [r for r in topic_results + person_results if r["total"] > 50]
    if thick:
        print(f"\n⚠️  Items with 50+ sources after backfill:")
        for r in thick:
            print(f"   {r['name']} → {r['total']} sources")

    total_new = sum(r["adding"] for r in topic_results + person_results)
    print(f"\n=== SUMMARY ===")
    print(f"Topics updated:  {len(topic_results)}")
    print(f"People updated:  {len(person_results)}")
    print(f"Total new source assignments: {total_new}")
    print(f"\nDRY RUN COMPLETE — nothing was written.")


if __name__ == "__main__":
    main()
