# ADR-040: Tool Calls and Thinking Are Persisted With the Message for Human Display Only

## Status

Accepted

## Date

2026-10-13

## Context

ADR-039 gave a Persona native tools that write to its own identity (`edit_trait`, `edit_topic`,
`update_description`, `add_note`, `clear_note`, `resolve_signal`) and justified omitting an oversight
gate on one premise: the human is present, so they will see what happened. That premise had no
mechanism behind it. A native tool call left no trace in either UI. A Persona that called `remove_trait`
when it meant `update_trait` was invisible to the person it was talking to.

Two adjacent facts shaped the answer. Ei already read model reasoning ("thinking") from providers that
return it, but only logged it. And every turn is not one model call: a turn is a chain of
`HandleToolContinuation` re-enqueues that ends in one message answering the human. Any design that
treated a single call as the unit would show the human a fragment.

The decision is therefore not only "show tool calls." It is where this data lives, when it is written,
how much of it is kept, who is allowed to read it, and what it must never touch.

## Decision

### 1. The data is saved on the final message of the turn, once, and shown only after the turn completes

`Message` (1:1) and `RoomMessage` (Rooms) each gain optional `tool_calls: ToolCallRecord[]` and
`thinking: string`. A "round" is the whole conversational turn, however many model and tool calls it
takes. The accumulator rides the continuation requests (`request.data.turnCapture`); the handler that
already builds the final row writes the complete value once. Nothing is written mid-turn and nothing is
streamed. Delivery reuses the existing `onMessageAdded`/`onRoomMessageAdded` notification and the
frontends' existing re-fetch; no new `Ei_Interface` event exists. A field is omitted when empty, never
stored as `[]` or `""`, so "has tool calls" is "field non-empty" on every consumer.

### 2. A tool-call record is `{name, arguments, result, error, kind}`; output is truncated at the write, input never

`result` is stored cut to 150 UTF-16 code units with the literal suffix `... (truncated)`, backing up
rather than splitting a surrogate pair. `arguments` are never truncated: seeing the full input is what
lets a human tell the Persona edited the wrong trait. Truncation happens only at the final persistence
write. The in-flight accumulator and the tool results fed to the model's next round stay complete, so
the display cap cannot degrade the model's own reasoning. `error` forwards today's raw flag unchanged,
including its known under-reporting; fixing error classification is separate work.

### 3. Thinking is the concatenation of every round, uncapped, and its volume is accepted

Thinking from each round is joined in order with a blank line. Last-round-only would silently drop the
reasoning behind a write that was "thought about" in one round and executed in a later one, which is
exactly the oversight content this exists to preserve. This is explicitly a V1 choice to be revisited
once observed in practice. No size cap or truncation applies: a reasoning-heavy model's thinking can run
many times the size of its reply, and that cost is accepted because the actual driver of `state.json`
growth is the storage format, which is its own future work. The reasoning of an extra LLM call made only
to repair a malformed response (a formatting retry, not a round of the Persona's turn) is not included.
A Room judge's verdict message, which is a Room message with a reason, does carry the judge turn's
thinking.

### 4. These fields are for human display only and never enter an LLM request

The persisted fields are excluded from the next conversational-response request built from message
history, for 1:1 and Room, and the guard is a test that puts distinct sentinels in content, thinking,
an argument and a result and fails if any but the content reaches the prompt. History builders project
fields explicitly, so the guard is mostly a regression trap. Display-only is the whole point: feeding
tool history back as conversation would change Persona behavior and double-count tokens. The guarantee
is deliberately scoped to the conversational path this feature interacts with; an exhaustive guarantee
over every prompt route (extraction, heartbeat, judge, any future builder) was not required and is
tracked separately.

### 5. Every tool is classified read or write, for display only

`ToolDefinition.kind: 'read' | 'write'`, using ADR-039 item 4's criterion: a tool that authors or
persists something on the Persona's behalf is write; one that only reads or looks something up is read.
Exactly `resolve_signal`, `edit_trait`, `edit_topic`, `update_description`, `add_note` and `clear_note`
are write. A definition with no `kind` (including an unclassified custom tool) defaults to write so a
forgotten tag is noticed, not hidden; a custom tool that carries an explicit `kind` keeps it. The
classification describes what a tool is capable of, not what a call achieved: an icon marking a write
does not mean a write succeeded or even executed (see item 13). The
kind is stamped into each persisted record at execution time from the resolved definition, not looked up
at render time, so a later rename or deletion cannot recolor an old message. `kind` is not an
authorization mechanism: heartbeat eligibility remains `ToolDefinition.heartbeat_eligible`, and the two
are allowed to diverge. A backup made before `kind` existed restores built-ins without it; import and
restore fill in only a missing `kind` and leave every other restored field alone.

### 6. Thinking visibility is a per-Persona setting, default on, hidden from the external surface

`PersonaEntity.show_thinking` (absent means true). Any message with thinking shows a 💭 control
regardless of the setting; the setting decides whether the text itself is shown, for every message of
that Persona at once. There is no per-message expand/collapse and no "thinking unavailable" state:
absence is normal because models differ and even thinking-capable models do not always think. Under
ADR-031's two tests this is a display-only setting with no external meaning and nothing an external
caller can usefully reason from, so it is System Hidden: absent from `ei --id` and MCP lookup output
and not writable through `ei update persona`.

### 7. Tool-call content is never shown inline; each platform keeps its own interaction model

Web shows an icon in the message action row (🔧 when every call is read, 🧧 when any is write) that
opens an accessible modal; the TUI shows a static icon and opens detail with `/toolcalls [N]`. The
divergence is deliberate: the TUI's message rows are not interactive and making them so is an overhaul
nobody asked for. `/thinking` toggles thinking in the TUI. Both platforms render unredacted: no masking
of arguments or thinking.

### 8. Rooms persist the data but do not display it; heartbeats write only when the Persona reaches out

Room rows persist the same fields so a future Room display starts with the data present. Displaying them
is separate work because Room rendering is structurally separate from 1:1 and raises a multi-Persona
visibility question this decision does not answer. A heartbeat that leads the Persona to reach out
writes a message carrying its tool calls and thinking; a heartbeat where the Persona passes writes
nothing, as before, because a heartbeat fires every 30 minutes by default and surfacing each would be
noise.

### 9. A 1:1 turn that ran tools and ended with no reply still writes a row, with its own marker

If the turn executed tool calls and the cleaned output is empty with no `NoResponse` sentinel, a row
with empty content and a dedicated `silence_reason` constant is written so the data has somewhere to
attach, and both frontends render it as "ran tools but sent no reply," not as a chosen silence. A
no-tool empty turn still writes nothing, and a genuine `NoResponse` is unchanged. Rooms get no equivalent
fallback: reaching that state means the model called a tool and then ignored the response contract
entirely.

### 10. `is_submit` tool calls are not listed; some data loss is accepted

A call that delivers the Persona's reply becomes the message itself, so the message is its display. A
non-submit call batched with it is not executed and is not shown. Calls dropped at the hard per-turn tool
limit get no representation: an entry exists only for a call that received a result. No recovery is
built for a turn that fails permanently before a row is written, or for an in-flight continuation a
human send, recall or clear removed after its tools ran.

### 11. Capture is generic and unconditional, and its cost is accepted

The accumulator is attached to every queue request, whether or not a handler consumes it, and carried
across continuations. There is no allow-list of request types that capture. Capture is a property of the
queue, not something each handler opts into, so a new handler that writes a turn's final row cannot
forget to ask for it. The price is an unused copy on requests that never write a row and a roughly
doubled in-flight payload for a running turn; both are accepted. No cap on the number of continuation
rounds is added here. The existing per-turn tool-execution limit (item 10) and the uncapped thinking size
(item 3) are separate matters, and the continuation chain is otherwise unbounded as it was before.

### 12. Records are assembled losslessly, in request order, matched by tool-call id

A record is built from a request's own tool calls in the order the model made them, each matched to its
result by call id. Provider call ids are consumed in order rather than assumed unique, so two calls that
share an id each pair with their own result instead of one overwriting the other. A call with no result
gets no record (item 10).

### 13. Classification boundaries, and what the icon does and does not claim

Built-in tags are held by convention and a completeness test over the built-in set. The TypeScript
definition keeps `kind` optional, and no creation-time validation is added, because there is no custom
tool authoring roadmap that would justify one. The display kind and the other `kind` literals in the
codebase stay separate types with no shared public alias, and the fallback-reason constant stays in its
own leaf module.

The icon reports classification only. A record exists for any call that received a result, and the
result may be an unknown-tool error, a blocked call, a missing-executor error or a thrown error; such a
call is saved with the kind resolved for it (write when unclassified) and so can show the write icon
without anything having been written. This is accepted: a more accurate success claim would need an error
classifier that does not exist, and the raw `error` flag is forwarded unchanged (item 2). Two fallback
boundaries are also deliberate. Later LLM-visible history still describes a tools-ran-no-reply row
with the same wording as a chosen silence. And a `NoResponse` sentinel, with or without a reason, keeps
writing the silence row it always did, now carrying whatever capture the turn produced; it is never given
the tools-ran-no-reply marker, which belongs only to empty output with no sentinel.

### 14. Display and accessibility choices

A persisted record is shown whole when it arrives. No client simulates progressive reveal (typewriter,
staggered rows) of content that is already complete, which keeps the shipped behavior distinct from the
deferred real streaming work. Closing the Web detail dialog restores focus to whatever held it before,
not unconditionally to the icon, because the icon may have been activated by pointer. The thinking
control's accessibility parity with the tool-call control is a recorded fast-follow, not part of this
decision. A new message that carries tool calls uses the existing passive unread notification; no
tool-specific announcement is added.

### 15. Test and recovery limits accepted at release

Processor wiring of the capture path is exercised through a copy of the fetcher in a test fixture, which
proves the fixture's behavior and the capture module, but not independently the Processor's own wiring;
this indirection is accepted rather than reopened. Full tool output is lost to truncation unless the
opt-in debug network log was on, and that log does not exist in the browser. Always-on logging of the
original output, the original intent for recovery, is deferred, not abandoned, and the opt-in log is a
release shortcut rather than its resolution.

## Alternatives Considered

### Alternative A: Stream tool calls and thinking as they happen

- **Description**: Surface each call and thinking delta live as the turn runs.
- **Cons**: High lift across transport, both frontends and per-provider thinking-delta support; shows the
  human fragments of a turn that may not be coherent until it ends.
- **Why not chosen**: Deliberately split out as its own effort. Waiting for the whole turn is the
  intended experience: the human sees the Persona's whole effort at once.

### Alternative B: Show only the last round's thinking

- **Why not chosen**: Loses the reasoning behind a write that was considered in an earlier round, the
  content this feature exists to keep.

### Alternative C: Truncate output where the tool runs

- **Why not chosen**: It would compound the loss into the model's own next-round reasoning. Truncating
  only at the final persistence write keeps the display cap from touching model behavior.

### Alternative D: Keep the data in a separate store keyed by message id

- **Why not chosen**: A second lifecycle to keep consistent with message delete, clear, recall and sync
  for no benefit; the message is the thing the human reopens, so the data lives on it.

### Alternative E: A new event to deliver the data

- **Why not chosen**: Persistence already precedes the existing notification, and the frontends already
  re-fetch on it, so the data arrives with no new transport and no ordering contract.

### Alternative F: Cap or summarize thinking to protect `state.json`

- **Why not chosen**: Its value to the human outweighs the storage cost, and the real growth driver is
  the storage format. Capping here would trade away the feature to postpone work that is needed anyway.

### Alternative G (chosen): Persist whole-turn data on the final message, display-only, classified by kind

Described above.

## Consequences

### Positive

- ADR-039's premise now has a mechanism: the human can see that a write happened and exactly what it was.
- No new event, transport or store; the feature rides existing persistence and notification.
- Display-only data cannot change Persona behavior.

### Negative

- `state.json` grows with every thinking-bearing message and thinking is uncapped. This is expected to be
  noticeable with reasoning-heavy models and is accepted until the storage format changes.
- A truncated tool result cannot be recovered from the saved message; the only recovery is the opt-in
  debug network log, which does not exist in the browser.
- The Web and TUI interaction models differ on purpose, so documentation must describe both.

### Risks

- Any new prompt-construction route that spreads a whole `Message` would silently start sending the
  display fields to a model. The guard test covers the conversational path only.
- The TUI and Web each decide their own icon rule; both follow "any call not read counts as write," and a
  future change to one has to be mirrored in the other.

## Reversibility

Moderate. Every field is optional, so removing the display leaves existing messages valid and the fields
become inert. Truncated results already persisted cannot be restored. The thinking-concatenation rule
(item 3) is flagged to be revisited from real usage and can change without a migration, because it
only affects how new messages are written.

## References

- ADR-039: the premise this makes true; item 4's read/write criterion.
- ADR-031: the field-visibility categories `show_thinking` is classified under.
- First hands-on use of the TUI build found the volume of saved thinking text surprising even after it
  was forecast. The storage-size concern in item 3 is real and should be measured against `state.json`
  growth over time.
