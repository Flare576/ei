# reference: the names/audience validation gate

Ei's own synthesis prompt (`src/prompts/synthesis/index.ts`, behind the
TUI/web `/generate` feature) has no instruction at all about full names,
handles, or third-party identifiers — it just formats whatever Ei found.
That gap is real, not just a skill nicety, which is why this file exists:
before you draft anything, decide whether what you're about to write down
could identify a real third party, and if so, ask.

## What triggers the gate

Stop and ask, before drafting, when **any** of the following shows up in
what your recon (`references/recon.md`) gathered:

- A **Person** record with a `relationship` indicating a coworker, client
  contact, vendor, or anyone who isn't the user's own immediate personal
  circle — especially one carrying `identifiers` (Full Name, Slack, GitHub,
  Email) that would be recognizable outside a private conversation.
- The **subject itself, or a facet hit, names a company, client, or
  organization** external to the user's own household — a client engagement
  name, an employer, a vendor.
- Anything that would let a reader identify a specific real person or
  organization by name, handle, or affiliation, even if it isn't tagged as
  a "Person" record (e.g. a Topic description that quotes someone by name).

## What does NOT trigger it

Don't add friction to subjects with no third-party identifiers at all — a
personal hobby, the user's own stated career history in first person, a
purely technical topic with no named people or companies attached. Asking
here just slows the user down for no protective value.

## What to actually ask

Ask once, up front, in plain language — before you write a single line of
the document, not after a draft exists to retrofit:

1. **Names and handles**: "This will include full names and Slack handles
   for [names found] — keep them as-is, or generalize to roles/initials
   (e.g. 'a Staff Data Architect on the Ukraine team' instead of the name)?"
2. **Company/client identifiers**: "Should I keep [company/client name] as
   written, or redact/generalize it?"
3. **Audience** — the question that decides the first two, so ask it
   first if it isn't already obvious from context: "Who is this document
   actually for — your own reference, or will someone else see it (a new
   hire, a client, a teammate)?" An onboarding doc "for R&P" is a good
   example of why this matters: the answer changes whether coworker names
   belong in it at all, in a way "runbook for my own reference" usually
   doesn't need to ask about as hard.

If the user's answer to (1) or (2) conflicts with their answer to (3) — e.g.
"keep full names" but the audience is an external client — surface that
tension back to them rather than silently picking a side ("Just to
double-check — you said keep full names, but this is going to [audience].
Still want that, or should I generalize?").

## After the gate

Once answered, apply the decision consistently through the whole document —
don't ask once and then drift back to defaults partway through drafting.
If new third-party material surfaces mid-draft that the original answer
didn't cover (a Person you didn't anticipate turns up in a late recon hop),
re-ask rather than assuming the earlier answer extends to it.
