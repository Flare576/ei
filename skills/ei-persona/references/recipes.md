# reference: persona-authoring recipes

Pick the recipe that matches the task. Every recipe assumes you have already **found and
read** the persona's current record, and that you will **confirm with the user**
(`references/talking-to-the-user.md`) before writing and **verify** after. `update` is a
merge patch (RFC 7396, ADR-029) — build a small object with only the field(s) you mean to
change, per `references/cli.md`. The one thing that hasn't changed: `traits`/`topics`, when
you include them at all, still replace **wholesale** — send every entry you want to keep,
not just the new/changed one.

Command mechanics live in `references/cli.md`; this file is the *sequence and judgment*
for each operation.

---

## Recipe A — Add a trait

**Symptom:** "give [persona] a new trait about being sarcastic" / "make Ei more playful"
translated into a concrete new character trait.

**Steps:**

1. `ei --id <persona-id>` → read. Look at the existing `traits[]` so the new one doesn't
   duplicate or contradict one that's already there.
2. Turn the request into a concrete trait: a short `name`, a `description` of what it
   looks like in behavior (not just a label), a `sentiment` (-1..1, how the persona feels
   about having it), and optionally a `strength` (0..1, how consistently it shows up). If
   the user's request is vague ("sarcastic"), propose the concrete wording and get their
   yes before writing — don't silently decide how sarcastic is "sarcastic."
3. Build the patch's `traits` array: a copy of every existing trait, plus the new one
   appended — **don't invent an `id`** for the new one, it's auto-assigned. `traits` is the
   only field in this patch.
4. `ei update persona <persona-id> --json '{"traits":[...]}'` — the whole `traits` array,
   nothing else.
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
3. Build the patch's `traits` array: a copy of every trait, with just that one entry
   edited — `traits` is still the whole array, even though only one entry changed.
4. `ei update persona <persona-id> --json '{"traits":[...]}'`.
5. Verify the read-back shows the new value and every other trait unchanged.

---

## Recipe C — Remove a trait

**Symptom:** "[persona] shouldn't be so formal anymore" meaning a trait should go away
entirely, not just weaken.

**Steps:**

1. `ei --id <persona-id>` → read.
2. Build the new `traits[]` array with that one entry filtered out — every other entry
   unchanged.
3. `ei update persona <persona-id> --json '{"traits":[...]}'` — the filtered array; every
   other field on the record is untouched because this patch never mentions it.
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
3. Build the patch's `topics` array: a copy of every existing topic, plus the new one
   appended.
4. `ei update persona <persona-id> --json '{"topics":[...]}'`.
5. Verify.

**Adjust:** same shape as Recipe B, applied to the matching entry in `topics[]` — change
only the field(s) that need to change (commonly `sentiment`, `exposure_desired`, or the
prose fields), preserve `id`, send the whole `topics` array back.

**Remove:** same shape as Recipe C, applied to `topics[]`.

---

## Recipe E — Rewrite short/long description

**Symptom:** "make Ei talk like Yoda" and similar — a request that changes *how the
persona presents itself* at the character level, not just one trait.

This is the recipe for the acceptance case of this skill: a broad character directive
that mostly lands in `long_description` (and sometimes `short_description`), possibly
alongside a trait or two.

**Steps:**

1. `ei --id <persona-id>` → read the current record, including `short_description`/
   `long_description` and existing `traits[]`/`topics[]` (for context, and in case the
   directive also implies a trait edit — see below).
2. Translate the directive into a concrete rewrite:
   - "talk like Yoda" is primarily a **voice/manner** instruction — it belongs in
     `long_description` ("speaks with inverted syntax, object before subject; sparse,
     aphoristic; calls the user 'young padawan' or similar"), not a fabricated backstory.
     Don't invent unrelated character facts (age, home planet, opinions) the user didn't
     ask for.
   - If the directive also implies a durable trait (e.g. "speaks in riddles" is arguably
     a trait, not just a description line), you may propose adding one — but say so
     explicitly when confirming, don't fold it in silently. If you do, that trait edit
     follows Recipe A/B and becomes part of the same patch.
   - Keep `short_description` a short label-level summary consistent with the new
     `long_description`; update it too if the old one now reads as inconsistent (e.g. a
     `short_description` of "concise and formal" contradicts a Yoda voice).
3. Draft the new field value(s) and confirm with the user in plain language *before*
   writing — this is a visible, felt change to how the persona talks, and it deserves a
   clear description of the new voice, not raw text to approve blind.
4. `ei update persona <persona-id> --json '{"long_description":"...","short_description":"..."}'`
   — only the description field(s) that actually changed; nothing else in the patch.
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
   `short_description`, `long_description`, `traits`, `topics`, `external_reflection_only`
   the user wants set at creation. Omit `id` on every trait/topic — auto-assigned. `model`,
   `group_primary`, `groups_visible`, and `tools` are no longer part of this payload at all
   (ADR-031) — the persona starts with system defaults for all of them, and none of them
   are settable through `create` either; if the user wants those configured, that's a TUI
   task, not this one.
3. Confirm the plan in plain language (name + character summary) before writing.
4. `ei create persona --json '<payload>'` → **capture the returned `id`.**
5. Verify: `ei --id <new-id>` and confirm the record matches what you intended. Tell the
   user the persona now exists and how to reach it (e.g. `/persona <name>` if that's how
   personas are selected in their client).

---

## Recipe G — Archiving is a TUI action now, not this skill's

**Symptom:** "archive Bob, I don't use him anymore" — or a user tries to "delete" Ei or
Emmet and needs redirecting to the reversible option.

`is_archived` left the external write contract entirely (ADR-031) — there is no `ei
update persona` payload, for a reserved persona or any other, that can archive or unarchive
one anymore. This recipe is no longer "read → set the flag → write" — it's a redirect:

1. Tell the user archiving (and unarchiving) is done in the TUI now — the `/archive`
   command — not something this skill can do on their behalf.
2. If the persona is reserved (`ei`/`emmet`) and the user asked to "delete" it: explain
   that delete is rejected outright for reserved personas (see Recipe H), and archiving via
   `/archive` in the TUI is the reversible alternative they actually want.
3. Don't attempt any JSON write for this — there is no field to send.

---

## Recipe H — Delete a persona (non-reserved only)

**Symptom:** "delete the persona I made by accident."

**Steps:**

1. **Check whether it's reserved first.** If the target is `ei` or `emmet`, stop — this
   recipe doesn't apply. Route to Recipe G (archive, in the TUI) and tell the user why:
   deleting a reserved persona is rejected outright (`Cannot delete reserved persona
   "<id>" — reserved personas can't be deleted via this CLI/MCP path at all; use the TUI's
   /archive command instead.`), checked before the request is even queued.
2. For a non-reserved persona: confirm with the user that they want it **permanently
   gone**, not hidden — mention the TUI's `/archive` command as the reversible alternative,
   since `remove` has no undo and this skill can't archive on their behalf either.
3. `ei remove persona <id>`.
4. Verify: `ei --id <id>` (or a search) no longer finds it.
5. Tell the user it's gone, and that recreating a persona with the same name later gets a
   **new** id — it will not be "the same" persona as far as anything that referenced the
   old id is concerned.

---

## Recipe I — Tool grants are a TUI action now, not this skill's

**Symptom:** "give DJ Spotify access so she can answer what she's listening to" / "let Ei
search the web" / "[persona] shouldn't be able to read my files anymore."

`tools` left the external write contract entirely (ADR-031: it only affects in-harness
behavior, not the knowledge base this CLI/MCP surface manages). `ei --id <persona-id>` still
shows the current grants as the same `{ "<Provider>": { "<Tool>": true|false } }` map, so
you can still tell the user what's currently granted — but there is no `ei update persona`
payload that can flip a boolean in it anymore.

1. `ei --id <persona-id>` → read, and answer any "what does X have access to right now"
   question directly from the `tools` map.
2. For an actual grant/revoke request: tell the user this is done in the TUI's persona
   editor now, not through this skill. Point them there rather than attempting a write.

---

## If a write looks wrong afterward

There's no undo, but the data isn't stuck — you fix a bad write with another write:
- Wrong trait/topic value → `update` again with a corrected patch for that field.
- Added the wrong trait → `update` again with a `traits` patch that has it removed
  (Recipe C).
- Removed something you shouldn't have → for a non-reserved persona, re-`create` it (note:
  new id, and any prior references to the old id are gone). For a reserved persona this
  never applies — you couldn't have deleted it in the first place.
- Archived by mistake → tell the user to use the TUI's `/archive` command; this skill has
  no write of its own to undo an archive with.

Re-read the persona with `ei persona "<name>" --id <id>` (or `ei --id <id>`) to verify what
actually landed — don't rely on `corrections.json`. In the common case (no live Ei instance
running), the write applies straight to `state.json` and `corrections.json` is immediately
reset to `[]`, so it will often already be empty even after a fully successful write.
