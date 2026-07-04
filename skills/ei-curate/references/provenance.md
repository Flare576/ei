# reference: attributing a quote by its provenance

Fixing a bad merge comes down to one question, asked once per quote: **who really said or
meant this?** You answer it from the quote's stored provenance. Do **not** answer it from
the (possibly wrong) name on the record you're fixing.

Every quote carries three provenance fields:
- `speaker` — who uttered it (a person's name, `"human"`, or a persona/agent name)
- `channel` — the human-readable place it happened
- `message_id` — a machine pointer whose **prefix names the origin system**

## Read the `message_id` prefix first

| Prefix | Origin | Externally re-checkable? |
|---|---|---|
| `slack:TEAM:CHANNEL:TS` | a Slack message | **Yes** — channel + speaker are strong signal; live lookup possible if you have a Slack tool |
| `opencode:…` `cursor:…` `codex:…` `pi:…` | a coding-assistant session | **No** — you cannot re-derive a canonical identity from a transcript |
| `ei:…` | Ei-internal (persona-authored) | n/a — not about an external person |

The prefix decides your method and your confidence ceiling.

---

## § Slack-sourced quotes

The stored `channel` and `speaker` usually settle attribution on their own:

- **`speaker`** tells you who talked. If the speaker *is* the person you're sorting (e.g. a
  quote spoken by "Jeff Kirk"), that's a strong direct signal.
- **`channel`** tells you the context. A quote in `#akrochem-qa` about "Jeff's explanation"
  is about the Jeff who lives in the Akrochem work — even if a *different* person said it.
- **The text** disambiguates topic vs. person: "candidate… Fortune 500 IT landscape" is a
  hiring context; "AS400 resync… inventory event" is an integration context. Two different
  people can share a first name and live in different channels — the channel + text is how
  you tell them apart.

**Optional live verification (only if you have a Slack tool and are still unsure):** resolve
the `channel`/user ids to real names and, crucially, **email domains** — the domain reveals
the org (e.g. `@company.com` vs a vendor's `@vendor.com`), which is often the cleanest way to
separate two same-named people across organizations. If you don't have a Slack tool, that's
fine — the stored fields are usually enough. **Never block on a tool you don't have.**

If, after channel + speaker + text, a Slack quote is *still* genuinely ambiguous → it's a
question for the user, not a guess for you.

---

## § Code-session quotes (`opencode:` / `cursor:` / `codex:` / `pi:`)

**Provenance here is not externally verifiable.** The `message_id` points at a session
transcript, not at a person directory. The `speaker` is typically `"human"` or an
assistant/persona name, and the actual *person being discussed* is buried in the text. There
is no channel-to-org mapping and no way to "look up" who was meant.

So:
- Attribute **only** from the quote's own text and whatever the user tells you.
- If the text doesn't make the person unambiguous, **stop and ask the user** — describe the
  quote and ask "does this belong to <A> or <B>?" Do not pick one to keep moving.
- This is the single most common place a confident model will fabricate. Don't.

---

## Turning attribution into a decision

For each quote on the record you're fixing:

1. Note `message_id` prefix → method + confidence ceiling (table above).
2. Gather `speaker` + `channel` + `text`.
3. Assign it to a candidate person **only if the evidence is clear**.
4. If not clear → add it to a short "need your call" list for the user.

You now have three buckets: **stays** (correctly attributed), **moves** (belongs to a
different/new person — re-point it), and **ask** (ambiguous). Take the "ask" bucket to the
user before writing anything.

---

## Why this also governs the `sources` field

A record's `sources` are the same provenance, aggregated. That's why:
- **Slack-origin `sources` self-heal** — as the user keeps talking in those channels, Ei
  re-ingests and re-populates them. You don't need to hand-fix them.
- **Code-session `sources` cannot be reconstructed** — the ids are opaque and tied to
  specific past sessions. You **cannot** hand-craft a valid one.

Therefore, when you create or clean a record, **leave `sources` empty rather than inventing
entries.** A missing source is normal and (for Slack) temporary; a fabricated one is a lie
in the data. See `references/cli.md` → "Don't fabricate sources."
