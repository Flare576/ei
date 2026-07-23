# reference: the two record contracts

These are the exact tests Ei's own Rewrite ceremony applies (see
`src/prompts/ceremony/people-rewrite.ts` and `topic-rewrite.ts` in the Ei
source — read them directly if you want the literal prompt text). Apply the
same standard by hand. If a piece of content passes the test, it stays. If it
fails, it's a candidate for redistribution (→ `references/recon.md`).

---

## Person contract — relationship profile

> A Person record is a **relationship profile** — who this person IS, how
> they relate to the human user, their character and communication style, and
> anything that makes them recognizable across time and context.
>
> It is NOT:
> - A project status log (ticket numbers, PR references, sprint assignments)
> - A record of shared interests that could stand alone as a Topic
> - Personal biography unrelated to the relationship (commute, hobbies, hometown)
> - Technical knowledge attributed to them rather than about them
>
> **The test**: Would this detail still be true and useful if you ran into
> this person at a coffee shop, unrelated to any current project, in six
> months?

### KEEP in a Person description
- Role, expertise, and *why* the user works with them — their operational
  function in the relationship.
- How they communicate, character traits, how the user knows them.
- The *insight* behind a specific event, stripped of the event's identifiers.

### REMOVE from a Person description (redistribute, don't discard the meaning)
- Current project/sprint status, ticket or PR numbers.
- Shared interests that could stand alone → becomes a Topic.
- City, commute, hobbies, lifestyle trivia with no relationship value →
  usually just discarded (see "worth a standalone record?" below), not
  redistributed anywhere.

### The distinction that trips people up
- *"Data Lake bucket owner responsible for access provisioning"* → **KEEP**
  (operational role in the relationship).
- *"Currently owns 4 tickets in Sprint 86"* → **REMOVE** (current status, not
  who they are).
- *"Left detailed comments on PR #1644 identifying architectural concerns
  around concurrency"* → keep the **insight**, drop the **reference**:
  "Flags architectural concerns around concurrency and queue isolation"
  belongs in the description; "PR #1644" does not, anywhere.

After slimming, a Person description should read as 2-4 sentences of pure
relationship profile. If it still mentions a city, a commute, or a hobby with
no bearing on the relationship, that's a sign the slim pass isn't done.

---

## Topic contract — one cohesive subject

> A single Topic record has grown too large because unrelated information was
> repeatedly added over time. The record's Name suggests its intended
> subject, but its Description now covers additional, unrelated subjects.
>
> Identify the **extra subjects** buried in the record that do NOT belong
> under the record's Name. Do not flag the record's primary subject itself —
> only the additions.

### The Technical exemption
A Topic with `category: "Technical"` is a **knowledge base for a specific
technology/platform/tool**, and is *allowed* to be dense and detailed — depth
is the point, not a symptom. Only flag content about a genuinely **different**
technology or workflow than the one named in the record:

- A "Uniform" topic containing Turborepo monorepo setup details → **flag**
  ("Turborepo monorepo setup" — different tool).
- A "Uniform" topic containing Vercel preview-deploy gotchas → **do not flag**
  (that's core Uniform knowledge, on-topic even if detailed).
- An "AWS Bedrock" topic containing Twilio integration details → **flag**.

For non-Technical topics, hold a tighter bar: if the record is cohesive and
on-topic despite its length, leave it alone — length alone is not the
problem, mixed subjects are.

### Splitting Technical topics
When a Technical topic genuinely does need splitting, split by **distinct
technical concept**, not just by keyword — e.g. "Uniform Composition Model"
vs. "Uniform Preview Setup" are two different topics even though both say
"Uniform." Preserve specificity over brevity when redistributing technical
detail; a Technical topic's redistributed content can run longer (target
under ~600 characters, never over ~900) than a non-Technical one (~300,
never over ~500) — these are knowledge bases, not summaries.

---

## "Is this worth a standalone record?"

Not everything that fails a contract test deserves a new Topic or Person.
Genuine throwaway trivia — a hobby mentioned once, a commute detail, a
one-off aside with no recurring relevance — should simply be **dropped**, not
redistributed. Only create (or fold into) a record for content that:

- Has standalone value on its own subject (someone would plausibly search
  for it later), or
- Is substantial enough that discarding it would lose real information about
  the relationship or subject.

When genuinely unsure whether something is throwaway or worth keeping, that's
a question for the user (see `references/talking-to-the-user.md`), not a
coin flip.
