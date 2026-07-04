# reference: curation recipes

Pick the recipe that matches the task. Every recipe assumes you have already **assessed**
the record(s) and **disambiguated** the quotes (`references/provenance.md`), and that you
will **confirm with the user** (`references/talking-to-the-user.md`) before writing and
**verify** after. All writes follow the full-record round-trip rule in `references/cli.md`.

Command mechanics live in `references/cli.md`; this file is the *sequence and judgment* for
each operation.

---

## Recipe A — Split one record into two (a bad merge)

**Symptom:** one record is really two people/topics wearing one name (its quotes and/or
description describe two different subjects). This is the most common and most delicate fix.

**Worked example (real):** a person record named "Jeff Kirk" had accreted a second person —
its description blended a hiring/sales R&P employee with an AS400 vendor engineer, and one of
its quotes (spoken in `#akrochem-qa`) actually belonged to the vendor. The record was *mostly*
Kirk, *contaminated* by "Jeff Nickles."

**Steps:**

1. **Decide which identity the existing record keeps.** Keep the majority/most-established
   identity on the existing id (preserves its history and links); extract the *minority*
   identity into a **new** record. In the example: keep the record as Kirk, create Nickles.

2. **Create the extracted person.** Supply real, *distinct* identifiers so the two can never
   re-merge (see the prevention note below). Capture the returned id.
   ```
   ei create person --json '{ name, description, relationship, sentiment,
                              identifiers:[ {Full Name…}, {Slack:"handle"}, {Email:"…"} ] }'
   → returns { id: "<new-id>", … }   # CAPTURE <new-id>
   ```

3. **Re-point the "moves" quotes** (from your disambiguation buckets). For each quote that
   belongs to the extracted identity: read it, set `data_item_ids` to the new id (preserving
   any *other* ids already in the array — a quote can link multiple people/topics — and
   de-duping), write it back.
   ```
   ei --id <quote-id>                                  # read full record
   # data_item_ids: replace the OLD person id with <new-id>, keep the rest
   ei update quote <quote-id> --json '<full record with fixed data_item_ids>'
   ```

4. **Clean the original record.** Full-record `update` that:
   - rewrites the `description` to describe **only** the identity that stays,
   - **removes the identifier that caused the merge** and adds a distinct one,
   - drops any `sources` that belong to the extracted identity (leave the rest; don't invent).

5. **Verify.** Re-read both people and each moved quote. Confirm `linked_quotes` shifted from
   the original to the new record, the descriptions/identifiers are clean, and nothing else
   changed.

> **Prevention (do not skip):** bad merges usually come from a **too-generic identifier** —
> a bare first name like `Slack: "Jeff"`. If you leave it, Ei will re-merge them. Remove the
> generic identifier and give **each** record a *distinct* one (a real Slack handle, an
> email). This is the difference between fixing the symptom and fixing the cause.

---

## Recipe B — Merge two records into one (a duplicate)

**Symptom:** two records are the same person/topic (Ei failed to match them).

**Steps:**

1. **Choose the survivor.** Keep the one with the richer history / more correct identifiers;
   the other is the "loser."
2. **Move every quote off the loser.** For each of the loser's `linked_quotes`: read it,
   replace the loser id in `data_item_ids` with the survivor id (preserve/de-dupe others),
   write it back.
3. **Fold in detail.** Full-record `update` the survivor to absorb any correct identifiers
   and description nuance the loser had (don't lose real information).
4. **Remove the loser** (`ei remove …`) — only *after* its quotes are moved, or you'll orphan
   them.
5. **Verify** the survivor now carries all the quotes and correct identifiers; confirm the
   loser is gone.

---

## Recipe C — Rename / relabel a person

**Symptom:** right person, wrong name or wrong/missing identifiers (but not a merge).

1. `ei --id <id>` → read the full record.
2. Fix `name` and/or `identifiers` (add the real handle/email; fix a misspelled name; set the
   correct `is_primary`). Prefer **adding** a distinct identifier over leaving a generic one.
3. `ei update person <id> --json '<full record>'`.
4. Verify the read-back.

---

## Recipe D — Correct a field (fact value, topic/person description)

**Symptom:** the record is the right entity, but a value/description is wrong or stale.

1. `ei --id <id>` → read.
2. Change only the offending field (`description`, a fact's `description`/value, a topic's
   `description`; preserve a topic's `category` unless you mean to change it).
3. `ei update <type> <id> --json '<full record>'`.
4. Verify. (Ei re-embeds on write, so search reflects the new text.)

---

## Recipe E — Re-point a single quote

**Symptom:** one quote is attached to the wrong person/topic.

The canonical three-step (see `references/cli.md`):
```
ei --id <quote-id>                 # 1. read
# 2. set data_item_ids to the correct id(s)
ei update quote <quote-id> --json '<full record with fixed data_item_ids>'   # 3. write
```
Then re-read the quote and the affected person(s) to confirm the link moved.

---

## Recipe F — Remove a junk or empty record

**Symptom:** a record is genuinely spurious (a mis-extracted "person" that's actually a
company name, an empty duplicate, noise).

1. **First, rescue any real quotes** — if it has `linked_quotes` that belong to a real
   entity, re-point them (Recipe E) so removing this record doesn't destroy them.
2. Confirm with the user that the record is truly junk (removal has no undo).
3. `ei remove <type> <id>`.
4. Verify it no longer appears in `ei --id` / search.

---

## If a write looks wrong afterward

There's no undo, but the data isn't stuck — you fix a bad write with another write:
- Wrong field value → `update` it again with the correct full record.
- Re-pointed the wrong quote → `update` the quote again to the right id.
- Removed something you shouldn't have → re-`create` it (note: new id; re-point its quotes to
  the new id). Tell the user this happened and what the new id is.

Inspect `~/.local/share/ei/corrections.json` (or `$EI_DATA_PATH/corrections.json`) to see the
exact log of what you recorded. Then re-verify and re-report.
