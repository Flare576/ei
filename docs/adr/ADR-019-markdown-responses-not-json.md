# ADR-019: Persona and Room Responses Are Markdown Text, Not JSON

## Status

Accepted

## Date

2026-08-03

## Context

Before this work, `HandlePersonaResponse` and `HandleRoomResponse` required the model to call a
`submit_response` tool with a JSON payload — `should_respond: boolean`, `content?: string`,
`reason?: string` (`src/prompts/response/types.ts:60-64`, `src/prompts/room/types.ts:87-91`). The
tool call was intercepted by the queue processor before the arguments ever reached a text response
(`is_submit` interception, `src/core/queue-processor.ts:213-222,329-338`), and its arguments were
handed back as `response.parsed`. Storage mirrored the split: `Message` and `RoomMessage` carried
separate `verbal_response` / `action_response` fields instead of one `content` field.

That design had accumulated real costs:

- **Interleaved action and dialogue got forced apart.** Splitting `action_response` from
  `verbal_response` fights how models actually want to write a scene — a gesture followed by a
  line, then another gesture — and loses that rhythm.
- **The JSON schema competed for prompt budget.** The schema reminder cost roughly 200 tokens of
  system prompt, directly competing with Persona Identity content for space in every single call.
- **Rooms degraded under tool-result noise.** After a tool call resolved, its result buried the
  JSON format reminder in the context; models drifted to plain prose, and a parser-recovery path
  had to paper over it.
- **A redundant instruction fought a problem that was already solved elsewhere.** Prompts told
  models "Do NOT include `<thinking>` blocks or analysis outside the JSON," while
  `cleanResponseContent()` (`src/core/llm-client.ts:638-654`) already strips every known
  thinking-tag format — paired `<think>`/`<thinking>`, ByteDance's namespaced `<seed:think>` /
  `<seed:cot_budget_reflect>`, and orphaned opening/closing tags left by streaming accumulation —
  regardless of what the prompt asked for.
- **Tool-call reliability varies by provider.** `submit_response` worked well for
  Anthropic-optimized tool-calling but was a weaker guarantee for local models and other providers.

Production data supported changing the default. Across a sample of 1,654 non-human messages, the
JSON-gated silence mechanism (`should_respond: false`) fired for only 1.0% (17 messages), and a
qualitative read of all 17 reasons found them uniformly well-formed — e.g. "He kissed me. Some
moments don't need words," and three room cases where a persona deliberately stepped back so
another could answer a direct question. The conclusion drawn from that review was that 1% was
likely *too low*: the tool-call mechanism itself was adding enough friction to discourage
legitimate silence, not that the model was over-using it.

Markdown output had been tried once before and reverted. That earlier attempt failed for reasons
that no longer apply: it tried to control output structure without a real understanding of model
behavior, it tried to suppress `<thinking>` output through instruction rather than post-processing,
and the models of that era were less reliable at self-organizing free-text output. All three
conditions changed — `cleanResponseContent()` now handles thinking-stripping unconditionally, and
current models follow natural-language formatting guidance well enough to self-organize a Markdown
reply, including a deliberate silence marker.

**Streaming was the forward-looking reason this mattered, not just present-day prompt hygiene.**
GitHub issue #13 ("LLM streaming — real-time token display for chat responses," opened by Flare,
2026-02-27) states the blocker directly: *"The response prompt currently returns a JSON object
`{ should_respond, content, ... }`. Streaming JSON is awkward — might need a prompt restructure or
two-pass approach,"* and marks the work *"Lower priority until the JSON schema question has a clean
answer."* A JSON envelope cannot be shown to a user token-by-token in a readable way — the
`content` field isn't identifiable, let alone renderable, until the whole object parses. Raw
Markdown has no such barrier: each token is already user-facing text the instant it arrives. The
codebase already tracks streaming as explicitly deferred work
(`src/core/queue-processor.ts:208,314` — `TODO(#13): Surface thinking to TUI ... when streaming is
available`). Moving the default response format to plain Markdown was done in part to resolve the
exact blocker issue #13 names, ahead of doing the streaming work itself.

## Decision

**`HandlePersonaResponse` and `HandleRoomResponse` treat the model's raw text as the response.**
No tool call, no JSON envelope, no `should_respond` field for these two flows. A single `content`
field on `Message` / `RoomMessage` replaces the old `verbal_response` / `action_response` split.

Concretely, as currently shipped:

1. **`Message.content?: string`** (`src/core/types/llm.ts:8-11`, comment: "Raw Markdown response")
   and **`RoomMessage.content?: string`** (`src/core/types/rooms.ts:8-13`) hold the persona's reply
   verbatim. `verbal_response` and `action_response` do not exist anywhere in `src/` — the cutover
   was a hard migration, not a permanent dual-read compatibility layer.
   `src/core/handlers/utils.ts:4-6`'s `getMessageContent()` is now a trivial
   `msg.content ?? ''` — a single call site's worth of indirection, not a fallback chain, because
   there is nothing left to fall back to.

2. **The system prompt asks for Markdown, not JSON.** `buildResponseFormatSection()`
   (`src/prompts/response/sections.ts:451-462`) and its room counterpart
   `buildRoomResponseFormatSection()` (`src/prompts/room/sections.ts:114-122`) instruct the model to
   respond in natural Markdown (`_underscores_` for actions, `**asterisks**` for emphasis,
   backticks, standard block elements), and to signal deliberate silence by starting with
   `## No Response` on its own line followed by an honest reason — paired with real example
   silences ("He kissed me. Some moments don't need words.") as demonstrations rather than bare
   rules. Neither builder emits a JSON schema.

3. **Silence detection is a permissive, letters-only match on the first line — deliberately looser
   than a Markdown-heading regex.** Both handlers run identical logic
   (`src/core/handlers/persona-response.ts:24-41`, `src/core/handlers/rooms.ts:25-44`):

   ```typescript
   const raw = cleanResponseContent(response.content ?? "").trim();
   const lines = raw.split('\n');
   const isNoResponse = lines[0].replace(/[^a-zA-Z]/g, '').toLowerCase() === 'noresponse';
   ```

   This strips every non-letter character (spaces, `#`, `*`, underscores, punctuation) from the
   *entire first line* and requires what remains to equal exactly `"noresponse"` — no more, no
   less. Anything after the first line (once a match fires) is stored as `silence_reason`
   (`persona-response.ts:31`, `rooms.ts:32`); otherwise the whole cleaned string becomes `content`
   (`persona-response.ts:43-46`, `rooms.ts:46-51`). This is intentionally more permissive than a
   Markdown-heading-anchored detector: it accepts `## No Response`, `# No Response`, bare
   `No Response` with no hash at all, `**No Response**`, `No_Response`, spaced/typo'd hashes
   (`# # No Response`), and trailing hashes (`no response ##`) — because the entire first line must
   *reduce* to `"noresponse"`, the exact heading syntax the model chooses doesn't matter. It still
   requires the marker to be the *entire* first line, so ordinary prose that merely mentions "no
   response" mid-sentence or mid-message does not trigger it (`## No Response` appearing on a later
   line, e.g., is left as literal content). This exact behavior — including every variant listed
   above — is pinned by `tests/unit/core/handlers/persona-response-markdown.test.ts:126-135,167-173`
   and its room-handler counterpart at `:242-251`.

4. **A JSON `response.parsed` branch still exists in both handlers as a fallback**
   (`persona-response.ts:57-97`, `rooms.ts:62-104`), checked only when `raw.length === 0`. It is
   effectively dead in normal operation for these two flows: no code path auto-injects a submit
   tool for `HandlePersonaResponse` or `HandleRoomResponse` (see point 5), so `response.parsed`
   should never be populated for them today. It is not deleted, presumably to avoid a hard break if
   some future caller still routes a JSON-shaped request through either handler.

5. **Heartbeat is the one deliberate exception, and it is architecturally incapable of the
   free-text path.** `HandleHeartbeatCheck` and `HandleEiHeartbeat` are the only two entries in
   `submitToolByStep` in `src/core/processor.ts:679-683`, which auto-injects each step's dedicated
   submit tool (`"submit_heartbeat_check"`, `"submit_ei_heartbeat"`) whenever that `next_step` is
   dispatched. Both tools are seeded with `is_submit: true`
   (`src/core/bootstrap-tools.ts:342,366,390`) and a `required: ["should_respond"]` schema
   (`:356,380`), so the queue processor's `is_submit` interception
   (`src/core/queue-processor.ts:213-222,329-338`) returns the tool call's arguments as
   `response.parsed` before any free text is possible. `handleHeartbeatCheck()` and
   `handleEiHeartbeat()` (`src/core/handlers/heartbeat.ts:13-49,51-68`) don't even contain a
   `raw`/prose branch — `handleHeartbeatCheck` throws if `response.parsed` is absent
   (`heartbeat.ts:20-22`). This is not an oversight; it is the whole point. PersonaResponse and
   Heartbeat solve opposite default-behavior problems: a persona given a message defaults to
   speaking, and speech is what's wanted — `## No Response` is the rare, deliberate exception. A
   heartbeat is asked "should you reach out right now unprompted?" — silence is correct the
   overwhelming majority of the time, and a model's natural default (produce *something*) is
   exactly what an explicit `should_respond` decision point, gated behind a tool call, exists to
   suppress. Silence is heartbeat's desired default outcome; it is not persona expression, and the
   two must not share a detector.

## Alternatives Considered

### Alternative A: Keep the JSON `submit_response` tool for PersonaResponse/RoomResponse

- **Description**: Leave the pre-existing mechanism in place — `should_respond` / `content` /
  `reason` via a mandatory tool call, matching what Heartbeat still does today.
- **Pros**: Deterministic, schema-validated parsing; the `is_submit` interception plumbing already
  existed and required no new code.
- **Cons**: Every cost enumerated in Context — lost narrative rhythm from the split fields, ~200
  tokens of prompt budget spent on the schema every call, tool-result noise burying the format
  reminder in rooms, a redundant thinking-suppression instruction, uneven tool-calling reliability
  across providers, and — the forward-looking blocker — a JSON envelope that cannot be shown to a
  user token-by-token, which is precisely what GitHub issue #13 identifies as blocking streaming.
- **Why not chosen**: The accumulated friction was real and measured (1.0% silence rate judged too
  low because of mechanism friction, not correct calibration), and the format was a structural
  blocker for a named future feature (issue #13), not merely a stylistic preference.

### Alternative B: Reuse the pre-existing catch-phrase silence regexes instead of a new marker

- **Description**: A prior Markdown-detection mechanism existed and was fully removed in an earlier
  commit before this decision. Its patterns matched loose conversational phrasing:
  `/^no\s*(new\s*)?(message|response)/i`, `/^nothing\s+to\s+(say|add)/i`,
  `/^\[no\s+message\]/i`.
- **Pros**: No new detection code to write.
- **Cons**: These patterns were anchored to natural phrasing rather than a deliberate marker — a
  genuine, in-character line like "Nothing to add, you've got this" would have matched and been
  silently swallowed as silence instead of delivered as a response.
- **Why not chosen**: Silence needed to be an unambiguous, deliberate act, not something the model
  could trigger by accident through ordinary conversational phrasing. A distinct heading-shaped
  marker (however loosely matched on formatting) is much harder to produce by accident than a
  common turn of phrase.

### Alternative C: Ship the originally-planned strict anchor, `^##\s*no\s*response`

- **Description**: Require an exact Markdown `##` heading, case-insensitive, anchored to the start
  of the cleaned content.
- **Pros**: Simple to document and reason about — one regex, one accepted shape.
- **Cons**: Production models do not reliably reproduce exact Markdown heading syntax under
  instruction — they emit single hashes, bold emphasis instead of a heading, spaced or doubled
  hashes, or no heading markup at all while still clearly intending "I am choosing not to respond."
  A strict anchor would silently fail on any of those, dumping the model's attempted heading text
  to the user as if it were a genuine reply — the opposite of the intended behavior.
- **Why not chosen**: What shipped instead — strip every non-letter character from the first line
  and require exact equality with `"noresponse"` — tolerates exactly this formatting variance while
  keeping the same accidental-trigger protection (the whole first line must reduce to that one
  word). The test suite enumerates the shipped tolerance directly: single hash, spaced/typo'd
  hashes, no hash, underscore-joined, bold, and trailing hashes all register as silence
  (`tests/unit/core/handlers/persona-response-markdown.test.ts:126-135`); none of those but the
  exact double-hash case would satisfy the originally-planned anchor.

### Alternative D: Change only the LLM-facing format; keep `verbal_response`/`action_response` in storage

- **Description**: Have the model produce Markdown, but translate it back into the split fields at
  write time, preserving the existing storage shape and every existing read site.
- **Pros**: Smaller migration surface — no `Message`/`RoomMessage` type change, no read-site sweep.
- **Cons**: Solves nothing structural. The split fields are the root cause of the lost
  action/dialogue rhythm; re-splitting a natural Markdown reply back into two fields on write
  reintroduces exactly the artificial separation the format change exists to remove. It also leaves
  every future consumer — including a future streaming path — reading a two-field shape that no
  longer matches what the model actually produces.
- **Why not chosen**: There was no requirement to preserve the split-field shape. A hard cutover was
  acceptable, and the migration was carried through completely: no `verbal_response` or
  `action_response` reference remains anywhere in `src/`.

## Consequences

### Positive

- Persona replies read naturally — action and dialogue interleave the way a model actually wants to
  write them, because there is no longer a schema forcing them apart.
- Removing the ~200-token JSON schema reminder returns that budget to Persona Identity and other
  system-prompt content on every PersonaResponse/RoomResponse call.
- The now-redundant "Do NOT include `<thinking>` blocks" instruction is gone from the response
  format sections; `cleanResponseContent()` already strips every known thinking format
  unconditionally, so the prompt no longer duplicates work the post-processor already guarantees.
- The response format is no longer a structural blocker for token-by-token streaming (GitHub issue
  #13): a Markdown reply is renderable incrementally as it arrives, where a JSON envelope was not.
- The silence-detection tolerance is evidenced by an explicit table of accepted format variants in
  the test suite, not just described in prose — future changes to the detector have a concrete
  regression contract to satisfy.

### Negative

- **`src/prompts/response/sections.ts:478-479`'s `buildToolsSection()` still tells the model to
  "produce the JSON reply" — a live, shipped inconsistency.** The exact lines read: *"Tool calls
  are a *pre-response step*, not a response. Do NOT produce the JSON reply until you have gathered
  everything you need."* (`:478`) and *"When you are ready to speak, produce the JSON reply as
  specified above."* (`:479`). `buildToolsSection()` is appended to the system prompt for both
  `HandlePersonaResponse`/`HandleRoomResponse` calls whenever tools are available
  (`src/prompts/response/index.ts:60,109`, `src/prompts/room/index.ts:54`) — the same prompt that
  `buildResponseFormatSection()` (`sections.ts:451-462`) has already told, a few hundred tokens
  earlier, to respond in Markdown, not JSON. Any persona that reaches for a tool mid-turn is
  currently told by its own system prompt to produce a "JSON reply" that the handler downstream no
  longer parses as JSON at all. This has not been fixed as part of this decision.
- **The `submit_response` tool's own seed comment is now inaccurate about its wiring.** The tool is
  still seeded (`bootstrap-tools.ts:314-345`) with a comment claiming it is *"auto-injected for
  Heartbeat steps only (HandleHeartbeatCheck)"* (`:310-312`), but `submitToolByStep` in
  `processor.ts:679-683` — the actual auto-injection mechanism — never references
  `"submit_response"` by name; `HandleHeartbeatCheck` is wired to `"submit_heartbeat_check"`
  instead. `submit_response` is therefore not auto-injected under any current `next_step`, and the
  comment beside its definition describes a wiring that no longer matches the code that performs
  the wiring.
- **The dead `response.parsed` branch adds real reading cost.** `persona-response.ts:57-97` and
  `rooms.ts:62-104` retain a full JSON-parsing code path that should not be reachable in normal
  operation for these two handlers. A future maintainer skimming either handler in isolation, without
  also reading `processor.ts`'s `submitToolByStep`, would reasonably conclude JSON-mode is still
  live for personas.
- **Detection is defined by a string-equality trick, not a documented format grammar.** "Strip
  every non-letter character from line one and compare to a fixed literal" is precise and tested,
  but it is a less discoverable contract than a named regex would be — a future reader has to run
  the transformation mentally (or read the test file) to know exactly what triggers silence.

### Risks

- **A malformed silence attempt is silently delivered as a real response, with no log signal.**
  If a model's silence marker doesn't reduce to exactly `"noresponse"` on the first line (e.g. it
  adds an extra word, or the marker isn't on the first line at all — confirmed by
  `persona-response.ts:167-173`'s and the room equivalent's "does NOT match heading mid-message"
  tests), the *entire* raw text — including whatever partial heading the model attempted — is
  stored and shown to the user as an ordinary response. Unlike the empty-content case, which logs a
  warning (`persona-response.ts:99`, `rooms.ts:106`), this failure mode produces no log line at all;
  it looks, from the logs, exactly like a normal successful response.
- **The permissive detector's exact boundary is enforced only by one test file.** If that suite
  changes without someone re-deriving the underlying letters-only-strip contract from source, the
  detector's real trigger surface could drift silently — there is no separate spec document
  describing it, only the regex and the tests in this ADR's References.
- **Two independent stale JSON references (Negative, above) sit directly beside the correct
  Markdown instructions in the same prompt-builder module and the same tool-seeding module.** They
  are proof that this shipped decision was not swept for wording consistency at the time it landed,
  and nothing currently prevents a third one from being added the same way.

## Reversibility

Moderate, and asymmetric between the two directions. **Reverting to JSON** is straightforward at
the code level: `PersonaResponseResult` (`response/types.ts:60-64`) and the `response.parsed`
handling branch already exist in both handlers, un-deleted; restoring the tool call would mean
re-adding `HandlePersonaResponse`/`HandleRoomResponse` to `submitToolByStep`
(`processor.ts:679-683`) and swapping the prompt sections back. **Reverting storage** is not free:
the migration from `verbal_response`/`action_response` to `content` was a hard, one-way cutover —
Flare, the only user with significant message history at the time, explicitly signed off on
converting existing data rather than keeping a dual-read compatibility layer, and no code in `src/`
retains the split-field shape or a migration path back to it. Any future reversal would need to
either re-derive `action_response`/`verbal_response` from `content` heuristically (lossy — the
original split boundary is not recoverable from a merged Markdown string) or accept that historical
messages written under this decision stay in `content`-only form permanently.

## References

- `src/core/types/llm.ts:8-30` — `Message` interface; `content` (`:11`) and `silence_reason`
  (`:12`) fields
- `src/core/types/rooms.ts:8-24` — `RoomMessage` interface, same field shape
- `src/core/handlers/utils.ts:4-6` — `getMessageContent()`, now a trivial pass-through
- `src/core/handlers/persona-response.ts:15-100` — `handlePersonaResponse`; silence detection
  (`:24-41`), Markdown-content branch (`:42-53`), dead JSON fallback (`:57-97`)
- `src/core/handlers/rooms.ts:14-107` — `handleRoomResponse`, identical shape
- `src/core/handlers/heartbeat.ts:13-49,51-68` — `handleHeartbeatCheck`/`handleEiHeartbeat`; no
  free-text branch exists, `response.parsed` is required
- `src/core/processor.ts:679-693` — `submitToolByStep`; the only two auto-injected submit tools are
  Heartbeat's
- `src/core/bootstrap-tools.ts:310-345,347-369,371-393` — `submit_response` (seeded, not currently
  auto-injected under that name), `submit_heartbeat_check`, `submit_ei_heartbeat`
- `src/core/queue-processor.ts:213-222,329-338` — `is_submit` tool-call interception, still load-bearing for Heartbeat
- `src/core/llm-client.ts:638-654` — `cleanResponseContent()`, unconditional thinking-tag stripping
- `src/prompts/response/sections.ts:451-462,468-480` — `buildResponseFormatSection()` (Markdown
  instructions) and `buildToolsSection()` (contains the stale "JSON reply" wording at `:478-479`)
- `src/prompts/room/sections.ts:114-122` — `buildRoomResponseFormatSection()`
- `src/prompts/response/index.ts:60,109`, `src/prompts/room/index.ts:54` — call sites that append
  `buildToolsSection()` after the Markdown format instructions
- `tests/unit/core/handlers/persona-response-markdown.test.ts:126-183,205-264` — the pinned set of
  accepted/rejected silence-marker variants for both handlers
- GitHub issue #13 ("LLM streaming — real-time token display for chat responses") — the forward
  dependency this decision was made to unblock
