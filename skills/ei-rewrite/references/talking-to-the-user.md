# reference: confirming and reporting a rewrite in plain language

The person you're helping thinks in **people and topics they recognize**, not
records, ids, or JSON. Talk to them in those terms — same discipline
`ei-curate` uses, adapted to this skill's different operation.

## Core rules

1. **Never show raw records, JSON, ids, or embeddings** to confirm or report.
2. **Describe the outcome, not the mechanism.** They care what will be true
   about their memory afterward, not which `ei update` calls you'll run.
3. **Confirm before every write**, in their language, with a real yes.
4. **Name your judgment calls.** If you decided something was "just trivia"
   and dropped it, or merged into an existing record on a partial match, say
   so — don't silently make the call and only mention it if asked.
5. **Report as human outcomes**, and tell them how to spot-check it.

## Confirming a plan — translate before you ask

> **Don't say:** "I'll scan the description, extract 3 subject phrases,
> search `searchHumanData` equivalents, `update` two existing topics, `create`
> one new topic, and recompute `rewrite_length_floor` on everything."
>
> **Say:** "Abinet's profile has grown to include a lot of project detail that
> doesn't really describe *him* — it describes what you've been building
> together. I'd like to: keep his profile focused on who he is and how you
> work together (sharp technical judgment, ships fast, iterates well on
> feedback), and move the Critique Crews and Agent Commons project details
> into their own topics — Critique Crews already has one, so I'll fold the
> new detail in there; Agent Commons doesn't, so I'll create one. Sound
> good?"

Lead with what's wrong (too much of the wrong kind of content), what you'll
make true (a slim profile + the right homes for the rest), then ask. No ids,
no field names.

## Surfacing a recon ambiguity

When a search turned up something plausible but you're not confident it's a
real match, hand the user the actual choice rather than guessing:

> "There's an existing topic called 'Mobile AI SDLC' that might be where the
> translation-workflow detail belongs, but it reads more like a process doc
> than what Abinet actually said — I don't want to force a merge if it's not
> really the same thing. Should I fold it in there, or give it its own
> topic?"

## Reporting the result

> "Done. Abinet's profile is now focused on the relationship — his role,
> how he works, his communication style. The project details moved to two
> topics: **Critique Crews** (added to the existing one) and a new
> **Agent Commons contributions** topic. You can check by searching
> 'Abinet' — his profile should read shorter and more personal now."

If something had to be dropped as not worth keeping, say so plainly:

> "One line about a scheduling conflict from a sick day didn't seem worth
> keeping anywhere on its own — I dropped it rather than forcing it into a
> topic. Let me know if you disagree."

## Being honest about limits

- **No undo:** same framing as `ei-curate` — confirm first, and a mistake is
  fixed with another edit, not a rollback.
- **Recon came up empty or ambiguous:** say so rather than picking silently
  — "I searched a couple of ways and didn't find anything close, so this is
  going to be a new topic unless you know of one I'm missing."

## Tone

Same as `ei-curate`: calm, plain, precise. A careful librarian re-shelving
things correctly, not a database admin running a migration.
