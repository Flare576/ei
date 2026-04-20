#!/usr/bin/env python3
"""
Backfill sources on human topics/people from OpenCode quotes.

Three passes:
  1. Upgrade old-style "opencode:ses_*" sources to "opencode:{machineId}:ses_*"
     for sessions that exist in the local OpenCode DB.
  2. For each quote with no message_id, matching a text part in the local DB:
     - restore message_id on the quote
     - add fully-qualified "opencode:{machineId}:{sessionId}" to sources on
       all linked items
  3. Write updated state.json (unless --dry-run).

Machine ID is always hostname (first segment, lowercased) — same as Ei's
importers use. Run this script on each machine separately after syncing data.

Usage:
  python3 backfill-sources.py [--dry-run]
"""

import json
import sqlite3
import os
import sys
import socket
from datetime import datetime, timezone
from collections import defaultdict

STATE_FILE = os.path.expanduser("~/.local/share/ei/state.json")
OC_DB = os.path.expanduser("~/.local/share/opencode/opencode.db")

SKIP_CHANNELS = {"Beta", "Lena", "Ei", "DJ"}
TIMESTAMP_TOLERANCE_MS = 90_000

def parse_args():
    dry_run = "--dry-run" in sys.argv
    machine_id = socket.gethostname().split(".")[0].lower()
    return machine_id, dry_run

def ts_to_ms(iso):
    try:
        return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000)
    except Exception:
        return None

def load_text_parts(db):
    rows = db.execute(
        "SELECT session_id, id, data FROM part WHERE data LIKE '{\"type\":\"text\"%'"
    ).fetchall()
    parts = []
    session_ids = set()
    for session_id, part_id, data_str in rows:
        try:
            data = json.loads(data_str)
        except Exception:
            continue
        if data.get("type") != "text":
            continue
        text = data.get("text", "")
        part_ms = (data.get("time") or {}).get("start", 0)
        if text:
            parts.append((session_id, part_id, text, part_ms))
            session_ids.add(session_id)
    return parts, session_ids

def find_session(text_parts, quote_text, quote_ms):
    anchor = quote_text[:100]
    matches = [
        (sid, pid, part_ms)
        for sid, pid, text, part_ms in text_parts
        if anchor in text
    ]
    if not matches:
        return None, None, "not_found"
    if len(matches) == 1:
        return matches[0][0], matches[0][1], "exact"
    if quote_ms is None:
        return None, None, "ambiguous_no_ts"

    best_sid, best_pid, best_diff = None, None, float("inf")
    for sid, pid, part_ms in matches:
        diff = abs(part_ms - quote_ms)
        if diff < best_diff:
            best_diff = diff
            best_sid = sid
            best_pid = pid

    if best_diff <= TIMESTAMP_TOLERANCE_MS:
        return best_sid, best_pid, f"disambiguated({len(matches)})"
    return None, None, f"ambiguous({len(matches)},diff={round(best_diff/1000)}s)"

def main():
    machine_id, dry_run = parse_args()
    mode = "DRY RUN" if dry_run else "LIVE"

    print(f"\n=== Source Backfill [{mode}] — machine: {machine_id} ===")
    print(f"State:  {STATE_FILE}")
    print(f"OC DB:  {OC_DB}\n")

    state = json.loads(open(STATE_FILE).read())
    human = state["human"]
    quotes = human.get("quotes", [])
    topics = human.get("topics", [])
    people = human.get("people", [])

    topic_by_id = {t["id"]: t for t in topics}
    person_by_id = {p["id"]: p for p in people}

    print("Loading OpenCode text parts into memory...", file=sys.stderr)
    db = sqlite3.connect(OC_DB)
    text_parts, local_session_ids = load_text_parts(db)
    db.close()
    print(f"Loaded {len(text_parts)} text parts ({len(local_session_ids)} sessions).\n", file=sys.stderr)

    # ── PASS 1: Upgrade old-style sources ─────────────────────────────────────
    print("--- Pass 1: Upgrading old-style sources ---")
    upgraded = 0
    skipped_other_machine = 0

    def upgrade_sources(sources):
        nonlocal upgraded, skipped_other_machine
        if not sources:
            return sources, False
        new_sources = []
        changed = False
        for s in sources:
            if s.startswith("opencode:") and not s.startswith("opencode:" + machine_id + ":"):
                parts = s.split(":")
                if len(parts) == 2:
                    session_id = parts[1]
                    if session_id in local_session_ids:
                        new_sources.append(f"opencode:{machine_id}:{session_id}")
                        upgraded += 1
                        changed = True
                    else:
                        new_sources.append(s)
                        skipped_other_machine += 1
                else:
                    new_sources.append(s)
            else:
                new_sources.append(s)
        return new_sources, changed

    for item in topics + people:
        new_sources, changed = upgrade_sources(item.get("sources"))
        if changed:
            item["sources"] = new_sources

    print(f"  Upgraded: {upgraded} sources to fully-qualified format")
    print(f"  Skipped (other machine): {skipped_other_machine} sources")

    # ── PASS 2: Quote matching → restore message_id + add sources ─────────────
    print("\n--- Pass 2: Quote matching ---")

    candidates = [
        q for q in quotes
        if not q.get("message_id")
        and q.get("data_item_ids")
        and q.get("channel") not in SKIP_CHANNELS
    ]
    print(f"  Candidate quotes (null message_id): {len(candidates)}")

    stats = defaultdict(int)
    quotes_updated = 0
    item_sources_added = defaultdict(set)

    for i, q in enumerate(candidates):
        if (i + 1) % 500 == 0:
            print(f"  Matching {i+1}/{len(candidates)}...", file=sys.stderr)

        quote_text = (q.get("text") or "").strip()
        if len(quote_text) < 10:
            stats["too_short"] += 1
            continue

        quote_ms = ts_to_ms(q.get("timestamp", ""))
        session_id, part_id, outcome = find_session(text_parts, quote_text, quote_ms)
        stats[outcome.split("(")[0]] += 1

        if not session_id:
            continue

        fq_source = f"opencode:{machine_id}:{session_id}"

        q["message_id"] = part_id
        quotes_updated += 1

        for item_id in q["data_item_ids"]:
            item_sources_added[item_id].add(fq_source)

    print(f"  Done.\n", file=sys.stderr)

    for key, count in sorted(stats.items(), key=lambda x: -x[1]):
        print(f"  {key:30s}: {count}")
    print(f"  Quotes with message_id restored: {quotes_updated}")

    # Apply new sources to items
    items_updated = 0
    new_source_count = 0
    for item_id, new_sources in item_sources_added.items():
        item = topic_by_id.get(item_id) or person_by_id.get(item_id)
        if not item:
            continue
        existing = set(item.get("sources") or [])
        to_add = new_sources - existing
        if to_add:
            item["sources"] = sorted(existing | to_add)
            items_updated += 1
            new_source_count += len(to_add)

    print(f"\n  Items updated with new sources: {items_updated}")
    print(f"  New source entries added: {new_source_count}")

    # ── PASS 3: Write ──────────────────────────────────────────────────────────
    print(f"\n--- Pass 3: {'[DRY RUN — skipping write]' if dry_run else 'Writing state.json'} ---")

    if not dry_run:
        backup = STATE_FILE + ".pre-backfill"
        import shutil
        shutil.copy2(STATE_FILE, backup)
        print(f"  Backed up to: {backup}")

        with open(STATE_FILE, "w") as f:
            json.dump(state, f, ensure_ascii=False)
        print(f"  Written: {STATE_FILE}")
    else:
        print(f"  Would write {STATE_FILE} (dry run, skipped)")

    print(f"\n=== DONE [{mode}] ===")
    print(f"  Pass 1 — sources upgraded:      {upgraded}")
    print(f"  Pass 2 — quotes message_id set: {quotes_updated}")
    print(f"  Pass 2 — item sources added:    {new_source_count} across {items_updated} items")

if __name__ == "__main__":
    main()
