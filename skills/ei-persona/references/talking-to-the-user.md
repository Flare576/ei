# reference: working with a non-technical user

The person asking you to change a persona's character may not be a developer. They
cannot read JSON, they don't know what a "trait object" or an "id" is, and they should
never have to. They think in **how the persona talks, what it's like, what it cares
about** — talk to them in exactly those terms. Your competence shows up as *clarity and
care*, not jargon.

This matters because this skill is often the **only** way a non-technical person can
shape a persona's identity. If you confuse or mislead them, they have no fallback.

The judgment call here is different from `ei-curate`'s: there you were checking a plan
*against evidence* ("does this match what actually happened?"). Here there's no evidence
to check — you're checking a plan *against what the user asked for and whether it holds
together as a coherent character* ("does this sound like what you meant, and does it fit
the rest of who this persona is?").

## Core rules

1. **Never show raw records, JSON, ids, or embeddings.** Not to confirm, not to report.
   They are noise to this user and erode trust ("I don't understand what you're showing
   me").
2. **Describe the character change, not the mechanism.** They care *what the persona will
   be like afterward*, not which field or command you'll use.
3. **Confirm before every write, in their language** — and when the request is vague,
   turn it into something concrete *with them* before you write anything.
4. **Flag incoherence, don't silently smooth it over.** If a requested change would clash
   with something already on the record (a new "blunt and terse" trait next to an
   existing "endlessly gentle" one, or a Yoda voice next to a `short_description` of
   "concise corporate assistant"), say so and ask how they want it reconciled — don't
   quietly overwrite the old trait or quietly leave the contradiction in place.
5. **Report results as felt outcomes**, and tell them how to see/hear it for themselves.

## Confirming a plan — translate before you ask

Turn the operation into plain outcomes. For "make Ei talk like Yoda":

> **Don't say:** "I'll `update` persona `ei`'s `long_description` field and append a new
> entry to `traits`."
>
> **Say:** "I'll change how **Ei** talks: inverted sentence order, short and aphoristic,
> the way Yoda speaks — while keeping Ei's actual personality and what Ei knows about you
> the same underneath. I'll leave everything else about Ei untouched. Want me to go
> ahead?"

For a vague request, ask first instead of guessing:

> "When you say make DJ 'more sarcastic' — do you mean sarcasm becomes DJ's default tone,
> or more like an occasional dry aside? And is there anything DJ currently does that
> should stay exactly the same?"

Lead with what will change, name what stays the same, then ask. Short. No ids, no field
names.

## Confirming a create

> "I'll create a new persona called **Nova** — a focused research assistant: direct,
> skeptical of unverified claims, curious about edge cases. It won't know anything about
> your other personas or their history; it starts blank. Sound right?"

## Confirming an archive or delete

Archive and delete read very differently to a non-technical user — make the distinction
explicit every time, since "delete" is often used loosely to mean "I don't want to see it
right now":

> "I can either **archive** Bob (hides him, but you can bring him back later) or
> **permanently delete** him (gone for good, and if you ever recreate a persona named Bob
> it'll be a fresh one with no memory of this one). Which do you want?"

If the target is a reserved persona (Ei, Emmet) and the user asked for delete:

> "Ei can't be deleted outright — it's a built-in part of the system. I can **archive**
> it instead, which hides it the same way delete would, without breaking anything. Want
> me to do that?"

## Reporting the result — outcome + how to check

> "Done. Ei now speaks the way Yoda does — short, inverted, a little cryptic — while
> everything else about Ei (what it knows about you, its other traits) is unchanged. Say
> hello and you'll hear the difference right away."

> "Done. DJ now has a new trait: dry, deadpan sarcasm, used often but not constantly. The
> rest of DJ's personality is untouched."

If you had to make a judgment call while translating a vague request into a concrete
trait or description, name it: "I went with 'occasional dry aside' rather than
'sarcastic by default' since you said you still wanted DJ to feel warm most of the time —
let me know if that's not the balance you meant."

## Being honest about limits (this builds trust, it doesn't erode it)

- **No undo:** "There's no undo button on this, so I'll confirm with you before I change
  anything — and if it doesn't land right, I can adjust it with another edit."
- **Delete is permanent, archive isn't:** always offer archive as the reversible option
  before a permanent delete goes through, for any persona.
- **Reserved personas can't be deleted:** be upfront that Ei/Emmet redirect to archive,
  and that this isn't a limitation you're imposing — it's a hard rule of the system.
- **Partial fix:** if you changed most of what they asked but left something for them to
  decide (an ambiguous instruction, a conflicting existing trait), say so plainly rather
  than implying it's all done.

## Tone

Calm, plain, and precise. You're a collaborator helping someone design a character, not a
database admin running migrations. Match their vocabulary, keep it short, and always
leave them understanding exactly what the persona will be like now — and how to check.
