# reference: persona-authoring recipes

Pick the recipe that matches the task. Every recipe assumes you have already **found and
read** the persona's full record, and that you will **confirm with the user**
(`references/talking-to-the-user.md`) before writing and **verify** after. All writes
follow the full-record round-trip rule in `references/cli.md`.

Command mechanics live in `references/cli.md`; this file is the *sequence and judgment*
for each operation.

---

## Recipe A — Add a trait

**Symptom:** "give [persona] a new trait about being sarcastic" / "make Ei more playful"
translated into a concrete new character trait.

**Steps:**

1. `ei --id <persona-id>` → read the full record. Look at the existing `traits[]` so the
   new one doesn't duplicate or contradict one that's already there.
2. Turn the request into a concrete trait: a short `name`, a `description` of what it
   looks like in behavior (not just a label), a `sentiment` (-1..1, how the persona feels
   about having it), and optionally a `strength` (0..1, how consistently it shows up). If
   the user's request is vague ("sarcastic"), propose the concrete wording and get their
   yes before writing — don't silently decide how sarcastic is "sarcastic."
3. Append the new trait object to the existing `traits[]` array — **don't invent an
   `id`**, it's auto-assigned. Leave every other trait, and every other field, untouched.
4. `ei update persona <persona-id> --json '<full record with the trait appended>'`.
5. Verify: re-read, confirm the new trait is present with the values you intended and
   every prior trait is still there.

---

## Recipe B — Adjust a trait's strength, sentiment, or description

**Symptom:** "[persona] should be more/less sarcastic" for a trait that already exists, or
"the sarcasm trait's description doesn't feel right anymore."

**Steps:**

1. `ei --id <persona-id>` → read. Find the matching entry in `traits[]` by name.
2. Change only the field(s) that need to change on that one trait object — `strength`
   and/or `sentiment` (both stay within their bounds, -1..1 for sentiment, 0..1 for
   strength) and/or `description`. Leave `id` and `name` as-is unless the user explicitly
   wants a rename.
3. `ei update persona <persona-id> --json '<full record with only that trait changed>'`.
4. Verify the read-back shows the new value and every other trait unchanged.

---

## Recipe C — Remove a trait

**Symptom:** "[persona] shouldn't be so formal anymore" meaning a trait should go away
entirely, not just weaken.

**Steps:**

1. `ei --id <persona-id>` → read.
2. Build the new `traits[]` array with that one entry filtered out — everything else in
   the array, and the rest of the record, unchanged.
3. `ei update persona <persona-id> --json '<full record with the trait removed>'`.
4. Verify: re-read, confirm the trait is gone and nothing else moved.

> If you're not sure whether the user wants the trait **gone** or just **weaker**, ask —
> Recipe B (weaken) and Recipe C (remove) are different edits.

---

## Recipe D — Add / adjust / remove a topic

**Symptom:** "[persona] should care about X" (add), "[persona]'s take on X has changed"
(adjust), or "[persona] shouldn't talk about X anymore" (remove/reduce).

Topics are the persona's *stance* on a subject — `perspective`, `approach`,
`personal_stake`, `sentiment`, `exposure_current`, `exposure_desired` — not just a label,
so a "shouldn't talk about X" request usually means one of two different things: **remove
the topic** entirely, or **lower `exposure_desired`** so the persona still holds the
opinion but doesn't bring it up. Ask which the user means if it's not obvious.

**Add:**
1. `ei --id <persona-id>` → read.
2. Build the new topic: `name`, `perspective` (their view), `approach` (how they engage
   with it), `personal_stake` (why it matters to them), `sentiment` (-1..1),
   `exposure_current` and `exposure_desired` (both 0..1). No `id` needed — auto-assigned.
3. Append to `topics[]`, leaving everything else untouched.
4. `ei update persona <persona-id> --json '<full record with the topic appended>'`.
5. Verify.

**Adjust:** same shape as Recipe B, applied to the matching entry in `topics[]` — change
only the field(s) that need to change (commonly `sentiment`, `exposure_desired`, or the
prose fields), preserve `id`.

**Remove:** same shape as Recipe C, applied to `topics[]`.

---

## Recipe E — Rewrite short/long description

**Symptom:** "make Ei talk like Yoda" and similar — a request that changes *how the
persona presents itself* at the character level, not just one trait.

This is the recipe for the acceptance case of this skill: a broad character directive
that mostly lands in `long_description` (and sometimes `short_description`), possibly
alongside a trait or two.

**Steps:**

1. `ei --id <persona-id>` → read the full record, including current
   `short_description`/`long_description` and existing `traits[]`/`topics[]`.
2. Translate the directive into a concrete rewrite:
   - "talk like Yoda" is primarily a **voice/manner** instruction — it belongs in
     `long_description` ("speaks with inverted syntax, object before subject; sparse,
     aphoristic; calls the user 'young padawan' or similar"), not a fabricated backstory.
     Don't invent unrelated character facts (age, home planet, opinions) the user didn't
     ask for.
   - If the directive also implies a durable trait (e.g. "speaks in riddles" is arguably
     a trait, not just a description line), you may propose adding one — but say so
     explicitly when confirming, don't fold it in silently.
   - Keep `short_description` a short label-level summary consistent with the new
     `long_description`; update it too if the old one now reads as inconsistent (e.g. a
     `short_description` of "concise and formal" contradicts a Yoda voice).
3. Draft the new field value(s) and confirm with the user in plain language *before*
   writing — this is a visible, felt change to how the persona talks, and it deserves a
   clear description of the new voice, not raw text to approve blind.
4. `ei update persona <persona-id> --json '<full record with only description field(s) changed>'`.
5. Verify: re-read, and if you can, exercise the persona (or describe how the user can)
   to confirm the new voice reads the way they wanted.

---

## Recipe F — Create a brand-new persona

**Symptom:** "create a new assistant persona for me" / "I want a persona that specializes
in X."

**Steps:**

1. Work out the essentials with the user first: `display_name` (checked against the
   reserved-name list — can't be `new` or `clone`), and enough of a character brief to
   write a `short_description`/`long_description` and a starting `traits[]`/`topics[]`
   set. There is **no minimum count** and **no auto-generation fallback** on this path —
   whatever character the persona has is whatever you and the user put in the payload.
2. Draft the full creation payload: `display_name` plus whichever of
   `short_description`, `long_description`, `traits`, `topics`, `model`, `group_primary`,
   `groups_visible`, `tools` the user wants set at creation. Omit `id` on every
   trait/topic — auto-assigned.
3. Confirm the plan in plain language (name + character summary) before writing.
4. `ei create persona --json '<payload>'` → **capture the returned `id`.**
5. Verify: `ei --id <new-id>` and confirm the record matches what you intended. Tell the
   user the persona now exists and how to reach it (e.g. `/persona <name>` if that's how
   personas are selected in their client).

---

## Recipe G — Archive a persona (including a reserved one)

**Symptom:** "archive Bob, I don't use him anymore" — or a user tries to "delete" Ei or
Emmet and needs redirecting to the reversible option.

**Steps:**

1. `ei --id <id>` → read the full record.
2. Set `is_archived: true` (and, if the shape calls for it, `archived_at` to the current
   timestamp — otherwise leave managed timestamp fields as Ei set them). Change nothing
   else.
3. `ei update persona <id> --json '<full record with is_archived: true>'`.
4. Verify: re-read, confirm `is_archived` is now `true`.
5. Tell the user the persona is archived, not deleted — it can be brought back later by
   setting `is_archived: false` the same way.

Unarchiving is the same recipe in reverse: read, set `is_archived: false`, write, verify.

---

## Recipe H — Delete a persona (non-reserved only)

**Symptom:** "delete the persona I made by accident."

**Steps:**

1. **Check whether it's reserved first.** If the target is `ei` or `emmet`, stop — this
   recipe doesn't apply. Route to Recipe G (archive) and tell the user why: deleting a
   reserved persona is rejected outright (`Cannot delete reserved persona "<id>". Use
   archive instead.`), checked before the request is even queued.
2. For a non-reserved persona: confirm with the user that they want it **permanently
   gone**, not hidden — mention archive (Recipe G) as the reversible alternative, since
   `remove` has no undo.
3. `ei remove persona <id>`.
4. Verify: `ei --id <id>` (or a search) no longer finds it.
5. Tell the user it's gone, and that recreating a persona with the same name later gets a
   **new** id — it will not be "the same" persona as far as anything that referenced the
   old id is concerned.

---

## If a write looks wrong afterward

There's no undo, but the data isn't stuck — you fix a bad write with another write:
- Wrong trait/topic value → `update` again with the correct full record.
- Added the wrong trait → `update` again with it removed (Recipe C).
- Removed something you shouldn't have → for a non-reserved persona, re-`create` it (note:
  new id, and any prior references to the old id are gone). For a reserved persona this
  never applies — you couldn't have deleted it in the first place.
- Archived by mistake → set `is_archived: false` and write again.

Inspect `~/.local/share/ei/corrections.json` (or `$EI_DATA_PATH/corrections.json`) to see
the exact log of what you recorded. Then re-verify and re-report.
